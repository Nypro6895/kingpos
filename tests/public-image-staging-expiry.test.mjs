import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';

const U='00000000-0000-4000-8000-000000000001';
const V='00000000-0000-4000-8000-000000000002';
const S='10000000-0000-4000-8000-000000000001';
const I='20000000-0000-4000-8000-000000000001';
const J='20000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-11-16T18:00:00.000Z');
const DAY=86400000;
const iso=n=>new Date(n).toISOString();
const load=async options=>{
  const result=await build({bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.resolve('.')},...options});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
};
const worker=await load({entryPoints:['lib/public-image-staging-expiry.ts'],plugins:[{name:'no-provider',setup(api){
  api.onResolve({filter:/^(server-only|\.\/public-image-safety)$/},a=>({path:a.path,namespace:'stub'}));
  api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function publicImageServiceClient(){throw Error("No provider calls in this test");}'}));
}}]});
const {processExpiredPublicImageStaging:processJob,runPublicImageStagingExpiry:run}=worker;

function job(changes={}){
  const item={bucket:'beauty-profile-media',object_path:`${U}/beauty/image/${I}.webp`,
    uploaded_by_user_id:U,salon_id:null,purpose:'image',status:'cancelled',
    created_at:iso(NOW-7*DAY),private_removed_at:null,cleanup_claimed_until:iso(NOW+300000),...changes};
  item.quarantine_path??=`${item.bucket}/${item.object_path}`;
  return item;
}
function client({items=[],remove='ok',finish='ok',claim='ok'}={}){
  const calls=[];
  return {calls,
    storage:{from(bucket){return {async remove(paths){
      calls.push({kind:'remove',bucket,paths});
      if(remove==='throw')throw Error('storage unavailable');
      return {error:remove==='error'?{message:'unavailable'}:null};
    }};}},
    async rpc(name,args){
      calls.push({kind:'rpc',name,args});
      if(name==='claim_expired_public_image_staging'){
        if(claim==='throw')throw Error('queue unavailable');
        return {data:claim==='invalid'?null:items,error:claim==='error'?{message:'unavailable'}:null};
      }
      assert.equal(name,'finish_public_image_staging_expiry');
      if(finish==='throw')throw Error('checkpoint unavailable');
      return {data:finish!=='false',error:finish==='error'?{message:'not verified'}:null};
    },
  };
}

test('expired cancelled/rejected/approved sources use only the private bucket and exact scoped paths',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const items=['image','before','after'].map(purpose=>job({purpose,object_path:`${U}/beauty/${purpose}/${I}.webp`}))
    .concat(job({bucket:'salon-profile-media',salon_id:S,purpose:'look',object_path:`${S}/looks/${I}/${J}.webp`,status:'approved'}),
      job({bucket:'salon-profile-media',salon_id:S,purpose:'update',object_path:`${S}/updates/${I}.webp`,status:'rejected'}));
  for(const item of items){
    const originalStatus=item.status;
    const c=client();
    assert.equal(await processJob(c,item,NOW+10000),true);
    assert.deepEqual(c.calls,[
      {kind:'remove',bucket:'public-image-quarantine',paths:[`${item.bucket}/${item.object_path}`]},
      {kind:'rpc',name:'finish_public_image_staging_expiry',args:{p_bucket:item.bucket,p_path:item.object_path}},
    ]);
    assert.equal(item.status,originalStatus);
  }
});

test('malformed, cross-scope, identity, legacy and uncancelled staging jobs never reach Storage',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const invalid=[null,{},[],job({bucket:'tax-documents'}),job({quarantine_path:`salon-profile-media/${U}/beauty/image/${I}.webp`}),
    job({object_path:`${U}/beauty/image/../${I}.webp`}),job({object_path:`${U}/beauty/image%2F${I}.webp`}),
    job({object_path:`${U}/beauty/image/${I}.webp/other`}),job({uploaded_by_user_id:V}),job({purpose:'before'}),job({purpose:'avatar'}),
    job({salon_id:S}),job({uploaded_by_user_id:null}),job({status:'staged'}),job({status:'legacy'}),job({status:'unknown'}),
    job({private_removed_at:iso(NOW-1000)}),job({bucket:'salon-profile-media',salon_id:S,purpose:'cover',object_path:`${S}/cover/${I}.webp`}),
    job({bucket:'salon-profile-media',salon_id:V,purpose:'update',object_path:`${S}/updates/${I}.webp`}),
    job({bucket:'salon-profile-media',salon_id:null,purpose:'update',object_path:`${S}/updates/${I}.webp`}),
    job({bucket:'salon-profile-media',salon_id:S,purpose:'look',object_path:`${S}/looks/${I}.webp`}),
  ];
  for(const item of invalid){const c=client();assert.equal(await processJob(c,item,NOW+10000),false);assert.deepEqual(c.calls,[]);}
});

test('seven-day age, active claim and worker deadline are checked before deletion',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const invalid=[job({created_at:iso(NOW-7*DAY+1)}),job({created_at:iso(NOW+DAY)}),job({created_at:'invalid'}),
    job({cleanup_claimed_until:iso(NOW)}),job({cleanup_claimed_until:null}),job({cleanup_claimed_until:'invalid'})];
  for(const item of invalid){const c=client();assert.equal(await processJob(c,item,NOW+10000),false);assert.deepEqual(c.calls,[]);}
  for(const deadline of [NOW,NaN,Infinity]){const c=client();assert.equal(await processJob(c,job(),deadline),false);assert.deepEqual(c.calls,[]);}
  assert.equal(await processJob(client(),job(),NOW+1),true);
});

test('storage or checkpoint failure does not report deletion; a missing-object retry can finish',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  for(const remove of ['error','throw']){
    const c=client({remove});assert.equal(await processJob(c,job(),NOW+10000),false);
    assert.deepEqual(c.calls.map(x=>x.kind),['remove']);
  }
  for(const finish of ['error','false','throw']){
    const c=client({finish});assert.equal(await processJob(c,job(),NOW+10000),false);
    assert.deepEqual(c.calls.map(x=>x.kind),['remove','rpc']);
  }
  let present=true,checkpointed=false,failCheckpoint=true;const calls=[];
  const c={storage:{from(bucket){assert.equal(bucket,'public-image-quarantine');return {async remove(){
    calls.push(present?'remove-existing':'remove-already-absent');present=false;return {error:null};
  }};}},async rpc(){calls.push('verify-absent');if(failCheckpoint)return {error:{message:'retry'}};
    assert.equal(present,false);checkpointed=true;return {data:true,error:null};}};
  assert.equal(await processJob(c,job(),NOW+10000),false);assert.equal(checkpointed,false);
  failCheckpoint=false;
  assert.equal(await processJob(c,job({cleanup_claimed_until:iso(NOW+300000)}),NOW+10000),true);
  assert.equal(checkpointed,true);assert.deepEqual(calls,['remove-existing','verify-absent','remove-already-absent','verify-absent']);
});

test('bounded queue returns only counts, rejects queue failure and never constructs a live client',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const c=client({items:[job(),job({status:'legacy'}),job({purpose:'before',object_path:`${U}/beauty/before/${J}.webp`})]});
  assert.deepEqual(await run(c),{removed:2,failed:1});
  assert.deepEqual(c.calls[0],{kind:'rpc',name:'claim_expired_public_image_staging',args:{p_limit:10}});
  for(const claim of ['invalid','error','throw']){
    const c=client({claim});await assert.rejects(run(c));assert.equal(c.calls.length,1);
  }
  const tooMany=client({items:Array.from({length:11},()=>job())});
  await assert.rejects(run(tooMany));assert.equal(tooMany.calls.length,1);
  await assert.rejects(run(),/No provider calls/);
});

test('spent maintenance budget checkpoints a completed removal but defers later rows for retry',async t=>{
  let now=NOW,removals=0,finishes=0;t.mock.method(Date,'now',()=>now);
  const c={storage:{from(){return {async remove(){removals++;now=NOW+10001;return {error:null};}};}},
    async rpc(name){
      if(name==='claim_expired_public_image_staging')return {error:null,data:[job(),job({purpose:'before',object_path:`${U}/beauty/before/${J}.webp`})]};
      assert.equal(name,'finish_public_image_staging_expiry');finishes++;return {error:null,data:true};
    }};
  assert.deepEqual(await run(c),{removed:1,failed:1});assert.equal(removals,1);assert.equal(finishes,1);
});

test('existing erase-due auth and background guard precede all workers; cleanup errors stay retryable',async()=>{
  const route=await load({entryPoints:['app/api/account/erase-due/route.ts'],plugins:[{name:'mock-maintenance',setup(api){
    api.onResolve({filter:/^(server-only|@\/lib\/(account-erasure-worker|lifecycle-export-expiry|public-image-staging-expiry|public-post-media-deletion|rights-evidence-worker))$/},a=>({path:a.path,namespace:'maintenance'}));
    api.onLoad({filter:/.*/,namespace:'maintenance'},args=>{
      if(args.path==='server-only')return{contents:''};
      if(args.path.endsWith('rights-evidence-worker'))return{contents:`export async function runRightsImageEvidence(){return {claimed:0,captured:0,removed:0,purged:0,failed:0,deferred:0,blocked:0};}`};
      const name=args.path.endsWith('account-erasure-worker')?'runAccountErasures':args.path.endsWith('lifecycle-export-expiry')?'runLifecycleExportExpiry':args.path.endsWith('public-post-media-deletion')?'runPublicPostMediaDeletions':'runPublicImageStagingExpiry';
      return {contents:`export async function ${name}(){return globalThis.__imageExpiryMaintenance.${name}();}`};
    });
  }}]});
  const priorSecret=process.env.CRON_SECRET,priorDisabled=process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;
  const calls=[];
  const rightsZero=()=>({claimed:0,captured:0,removed:0,purged:0,failed:0,deferred:0,blocked:0});
  const rightsEvidence={capture:rightsZero(),removeOrigin:rightsZero(),purge:rightsZero()};
  globalThis.__imageExpiryMaintenance={
    runAccountErasures:async()=>{calls.push('account');return {completed:1,failed:0};},
    runLifecycleExportExpiry:async()=>{calls.push('export');return {removed:2,failed:0};},
    runPublicImageStagingExpiry:async()=>{calls.push('image');throw Error('private queue detail must not leave route');},
    runPublicPostMediaDeletions:async()=>{calls.push('postMedia');return {claimed:1,removed:1,failed:0,deferred:0};},
  };
  try{
    process.env.CRON_SECRET='fixture-only-not-a-real-secret';delete process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;
    const request=authorized=>new Request('http://localhost/api/account/erase-due',{headers:authorized?{authorization:'Bearer fixture-only-not-a-real-secret'}:{}});
    assert.equal((await route.GET(request(false))).status,401);assert.deepEqual(calls,[]);
    process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH='1';
    assert.equal((await route.GET(request(true))).status,503);assert.deepEqual(calls,[]);
    delete process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;
    const response=await route.GET(request(true));assert.equal(response.status,503);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{completed:1,failed:0,exports:{removed:2,failed:0},imageStaging:{removed:0,failed:1},postMedia:{claimed:1,removed:1,failed:0,deferred:0},rightsEvidence});
    assert.deepEqual(calls,['export','image','postMedia','account']);
  }finally{
    if(priorSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=priorSecret;
    if(priorDisabled===undefined)delete process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;else process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH=priorDisabled;
    delete globalThis.__imageExpiryMaintenance;
  }
});
