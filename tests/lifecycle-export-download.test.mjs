import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';

const module=await build({
  entryPoints:['lib/lifecycle-export-storage.ts'],bundle:true,write:false,format:'esm',platform:'node',
  alias:{'@':path.resolve('.')},
  plugins:[{name:'export-boundaries',setup(api){
    api.onResolve({filter:/^(server-only|@\/lib\/supabase\/server|@\/lib\/users\/current-user|\.\/lifecycle-export-expiry)$/},a=>({path:a.path,namespace:'stub'}));
    api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`
      export const createAuthenticatedSupabaseServerClient=async()=>globalThis.__downloadFixture.client;
      export const getCurrentKingUser=async()=>globalThis.__downloadFixture.user;
      export const lifecycleExportServiceClient=()=>globalThis.__downloadFixture.service;
    `}));
  }}],
});
const {createStoredLifecycleExport}=await import('data:text/javascript;base64,'+Buffer.from(module.outputFiles[0].text).toString('base64'));
function fixture({expiry=Date.now()+2*86400000,override={},uploadError=false,user=true}={}){
  const state={calls:[],record:null,user:user?{id:'00000000-0000-4000-8000-000000000001'}:null};
  state.client={
    from(table){
      assert.equal(table,'lifecycle_exports');
      const q={
        insert(input){state.calls.push('insert');state.record={...input,expires_at:new Date(expiry).toISOString()};return this;},
        update(input){state.calls.push('update:'+input.status);state.record={...state.record,...input};return this;},
        eq(key,value){assert.equal(key,'id');assert.equal(value,state.record.id);return this;},
        select(){return this;},
        async single(){return {data:{...state.record,...(state.record.status==='stored'?override:{})},error:null};},
        then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject);},
      };
      return q;
    },
    storage:{from(bucket){assert.equal(bucket,'lifecycle-exports');return {
      async upload(file,blob,options){state.calls.push('upload');assert.equal(options.upsert,false);assert.equal(await blob.text(),JSON.stringify({sample:'private'},null,2));assert.equal(file,state.record.storage_path);return {error:uploadError?{message:'unavailable'}:null};},
      createSignedUrl(){throw Error('Authenticated signer must not be used');},
    };}},
  };
  state.service={storage:{from(bucket){assert.equal(bucket,'lifecycle-exports');return {
    async createSignedUrl(file,seconds){state.calls.push('service-sign');state.signed={file,seconds};return {data:{signedUrl:'https://storage.example.test/private-download'},error:null};},
  };}}};
  globalThis.__downloadFixture=state;
  return state;
}
const input={exportType:'account_deletion',filename:'sample.json',manifest:{purpose:'test'},payload:{sample:'private'}};

test('service signing is requester-bound and capped; UI receives distinct authoritative file and URL expiry',async()=>{
  const state=fixture();
  try{
    const before=Date.now(),result=await createStoredLifecycleExport(input);
    assert.deepEqual(state.calls,['insert','upload','update:stored','service-sign']);
    assert.equal(state.signed.seconds,900);
    assert.equal(result.expiresAt,state.record.expires_at);
    assert.ok(Date.parse(result.downloadExpiresAt)<=Date.now()+900000);
    assert.ok(Date.parse(result.downloadExpiresAt)>=before+899000);
    assert.ok(Date.parse(result.expiresAt)>Date.parse(result.downloadExpiresAt));
  }finally{delete globalThis.__downloadFixture;}
});

test('signer never extends a nearly expired record, signs an expired record or trusts altered returned metadata',async()=>{
  const state=fixture({expiry:Date.now()+5000});
  try{
    const result=await createStoredLifecycleExport(input);
    assert.ok(state.signed.seconds>=1&&state.signed.seconds<=5);
    assert.ok(Date.parse(result.downloadExpiresAt)<=Date.parse(result.expiresAt));
    for(const override of [
      {requested_by_user_id:'another-user'},{id:'another-export'},
      {storage_bucket:'payroll-paystubs'},{storage_path:'another/path'},{status:'created'},
    ]){
      const f=fixture({override});
      await assert.rejects(createStoredLifecycleExport(input),/could not be authorized/);
      assert.equal(f.calls.includes('service-sign'),false);
    }
    const expired=fixture({expiry:Date.now()-1000});
    await assert.rejects(createStoredLifecycleExport(input),/expired/);
    assert.equal(expired.calls.includes('service-sign'),false);
  }finally{delete globalThis.__downloadFixture;}
});

test('missing user and upload failure do not produce a bearer download',async()=>{
  const unauthorized=fixture({user:false});
  try{
    await assert.rejects(createStoredLifecycleExport(input),/Sign in/);
    assert.deepEqual(unauthorized.calls,[]);
    const failed=fixture({uploadError:true});
    const previous=console.error;console.error=()=>{};
    try{await assert.rejects(createStoredLifecycleExport(input),/unavailable/);}finally{console.error=previous;}
    assert.ok(failed.calls.includes('update:failed'));
    assert.equal(failed.calls.includes('service-sign'),false);
  }finally{delete globalThis.__downloadFixture;}
});
