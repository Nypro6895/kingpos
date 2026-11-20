import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';

const U='00000000-0000-4000-8000-000000000001';
const V='00000000-0000-4000-8000-000000000002';
const S='10000000-0000-4000-8000-000000000001';
const I='20000000-0000-4000-8000-000000000001';
const J='20000000-0000-4000-8000-000000000002';
const NOW=Date.parse('2026-11-18T22:00:00.000Z');
const iso=n=>new Date(n).toISOString();
const built=await build({entryPoints:['lib/public-post-media-deletion.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
  name:'no-provider',setup(api){
    api.onResolve({filter:/^(server-only|\.\/public-image-safety)$/},a=>({path:a.path,namespace:'stub'}));
    api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export function publicImageServiceClient(){throw Error("Live service construction forbidden in this test");}'}));
  },
}]});
const {processPublicPostMediaDeletion:processJob,runPublicPostMediaDeletions:run}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

function job(changes={}){
  return {id:I,bucket:'beauty-profile-media',object_path:`${U}/beauty/image/${I}.webp`,uploaded_by_user_id:U,
    object_id:J,object_version:'version-1',object_etag:'etag-1',sha256:'a'.repeat(64),bytes:512000,
    lease_token:V,leased_until:iso(NOW+120000),...changes};
}
function client({items=[],claim='ok',remove='ok',finish='ok',onRemove,onFinish}={}){
  const calls=[];
  return {calls,storage:{from(bucket){return {async remove(paths){
    calls.push({kind:'remove',bucket,paths});
    if(onRemove)return onRemove(bucket,paths);
    if(remove==='throw')throw Error('private storage detail');
    return {error:remove==='error'?{message:'private storage detail'}:null};
  }};}},async rpc(name,args){
    calls.push({kind:'rpc',name,args});
    if(name==='claim_public_post_media_deletions'){
      if(claim==='throw')throw Error('private queue detail');
      return {data:claim==='invalid'?null:items,error:claim==='error'?{message:'private queue detail'}:null};
    }
    assert.equal(name,'finish_public_post_media_deletion');
    if(onFinish)return onFinish(args);
    if(finish==='throw')throw Error('private checkpoint detail');
    return {data:finish!=='false',error:finish==='error'?{message:'private checkpoint detail'}:null};
  }};
}

test('only exact pinned Beauty and Salon photo paths use a single-path Storage API removal',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const items=['image','before','after'].map(p=>job({object_path:`${U}/beauty/${p}/${I}.webp`}))
    .concat(job({bucket:'salon-profile-media',object_path:`${S}/looks/${I}/${J}.webp`,status:'processing'}),
      job({bucket:'salon-profile-media',object_path:`${S}/updates/${I}.webp`}));
  for(const item of items){
    const c=client();assert.equal(await processJob(c,item,NOW+10000),'removed');
    assert.deepEqual(c.calls,[{kind:'remove',bucket:item.bucket,paths:[item.object_path]},
      {kind:'rpc',name:'finish_public_post_media_deletion',args:{p_id:item.id,p_lease:item.lease_token,p_error:null}}]);
  }
});

test('legacy, identity, quarantine, cross-author, malformed and unpinned jobs never reach Storage',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const invalid=[null,{},[],job({bucket:'public-image-quarantine'}),job({bucket:'tax-documents'}),
    job({object_path:`${U}/beauty/avatar/${I}.webp`}),job({object_path:`${U}/beauty/image/../${I}.webp`}),
    job({object_path:`${U}/beauty/image%2F${I}.webp`}),job({object_path:`${U}/beauty/image/${I}.webp/extra`}),
    job({object_path:`${U}/beauty/image/${I}.jpg`}),job({uploaded_by_user_id:V}),job({status:'legacy'}),job({status:'review_evidence'}),
    job({bucket:'salon-profile-media',object_path:`${S}/cover/${I}.webp`}),
    job({bucket:'salon-profile-media',object_path:`${S}/looks/${I}.webp`}),
    job({bucket:'salon-profile-media',object_path:`${'x'.repeat(36)}/updates/${I}.webp`})];
  for(const key of ['id','uploaded_by_user_id','object_id','lease_token'])invalid.push(job({[key]:null}),job({[key]:'not-a-uuid'}));
  for(const key of ['object_version','object_etag'])invalid.push(job({[key]:null}),job({[key]:''}),job({[key]:' \t'}),job({[key]:'x\nprivate'}));
  for(const sha256 of [null,'A'.repeat(64),'a'.repeat(63)])invalid.push(job({sha256}));
  for(const bytes of [null,'12',0,-1,512001,1.5,NaN,Infinity])invalid.push(job({bytes}));
  for(const item of invalid){const c=client();assert.equal(await processJob(c,item,NOW+10000),'failed');assert.deepEqual(c.calls,[]);}
});

test('valid lease and a 12-second request margin are required before each request',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  for(const leased_until of [null,'invalid',iso(NOW),iso(NOW-1)]){
    const c=client();assert.equal(await processJob(c,job({leased_until}),NOW+10000),'failed');assert.deepEqual(c.calls,[]);
  }
  for(const leased_until of [iso(NOW+1),iso(NOW+12000)]){
    const c=client();assert.equal(await processJob(c,job({leased_until}),NOW+10000),'deferred');assert.deepEqual(c.calls,[]);
  }
  for(const deadline of [NOW,NOW-1]){const c=client();assert.equal(await processJob(c,job(),deadline),'deferred');assert.deepEqual(c.calls,[]);}
  for(const deadline of [NaN,Infinity]){const c=client();assert.equal(await processJob(c,job(),deadline),'failed');assert.deepEqual(c.calls,[]);}
  assert.equal(await processJob(client(),job({leased_until:iso(NOW+12001)}),NOW+1),'removed');
});

test('Storage failures release only this lease with a bounded error and do not complete it',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  for(const remove of ['error','throw'])for(const finish of ['ok','error','false','throw']){
    const c=client({remove,finish});assert.equal(await processJob(c,job(),NOW+10000),'failed');
    assert.deepEqual(c.calls,[{kind:'remove',bucket:'beauty-profile-media',paths:[job().object_path]},
      {kind:'rpc',name:'finish_public_post_media_deletion',args:{p_id:I,p_lease:V,p_error:'storage_remove_failed'}}]);
  }
});

test('checkpoint false, error or thrown response stays failed; absent-object retries preserve exact identity',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  for(const finish of ['false','error','throw']){
    const c=client({finish});assert.equal(await processJob(c,job(),NOW+10000),'failed');assert.equal(c.calls.length,2);
  }
  let present=true,failFinish=true,completed=false;
  const c=client({onRemove:()=>{present=false;return {error:null};},onFinish:args=>{
    assert.equal(args.p_error,null);assert.equal(present,false);
    if(failFinish)return {error:{message:'lost result'}};
    completed=true;return {data:true,error:null};
  }});
  assert.equal(await processJob(c,job(),NOW+10000),'failed');assert.equal(completed,false);
  failFinish=false;
  assert.equal(await processJob(c,job({lease_token:S}),NOW+10000),'removed');assert.equal(completed,true);
  assert.deepEqual(c.calls.filter(x=>x.kind==='remove').map(x=>x.paths),[[job().object_path],[job().object_path]]);
  assert.deepEqual(c.calls.filter(x=>x.kind==='rpc').map(x=>x.args.p_lease),[V,S]);
});

test('budget or lease spent during removal never starts a checkpoint or failure-release request',async t=>{
  let now=NOW;t.mock.method(Date,'now',()=>now);
  for(const mode of ['deadline','lease','error-deadline','throw-deadline']){
    now=NOW;
    const c=client({onRemove:()=>{
      now=mode==='lease'?NOW+108000:NOW+10000;
      if(mode==='throw-deadline')throw Error('private timeout detail');
      return {error:mode==='error-deadline'?{message:'private timeout detail'}:null};
    }});
    const deadline=mode==='lease'?NOW+200000:NOW+10000;
    assert.equal(await processJob(c,job(),deadline),mode.startsWith('error')||mode.startsWith('throw')?'failed':'deferred');
    assert.deepEqual(c.calls.map(x=>x.kind),['remove']);
  }
});

test('one malformed or failed job does not block other jobs; only aggregate counts leave the worker',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  let removes=0;
  const c=client({items:[job(),job({status:'legacy'}),job({id:J,object_path:`${U}/beauty/before/${J}.webp`})],
    onRemove:()=>({error:++removes===1?{message:'private detail'}:null})});
  assert.deepEqual(await run(c),{claimed:3,removed:1,failed:2,deferred:0});
  assert.deepEqual(c.calls[0],{kind:'rpc',name:'claim_public_post_media_deletions',args:{p_limit:5}});
  assert.equal(removes,2);
  assert.deepEqual(await run(client()),{claimed:0,removed:0,failed:0,deferred:0});
});

test('a slow claim or removal defers later rows without new network operations',async t=>{
  let now=NOW;t.mock.method(Date,'now',()=>now);
  const c=client({items:[job(),job({id:J})],onRemove:()=>{now=NOW+10001;return {error:null};}});
  assert.deepEqual(await run(c),{claimed:2,removed:0,failed:2,deferred:2});
  assert.deepEqual(c.calls.map(x=>x.kind),['rpc','remove']);
  now=NOW;
  const slow={calls:[],async rpc(name,args){this.calls.push({name,args});now=NOW+10001;return {data:[job()],error:null};},
    storage:{from(){assert.fail('spent claim budget must not start Storage');}}};
  assert.deepEqual(await run(slow),{claimed:1,removed:0,failed:1,deferred:1});assert.equal(slow.calls.length,1);
});

test('queue errors or oversized batches are sanitized and never launch Storage',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  for(const claim of ['error','throw','invalid']){
    const c=client({claim});await assert.rejects(run(c),{message:'Public photo deletion queue could not be read.'});assert.equal(c.calls.length,1);
  }
  const c=client({items:Array.from({length:6},()=>job())});
  await assert.rejects(run(c),{message:'Public photo deletion queue could not be read.'});assert.equal(c.calls.length,1);
  await assert.rejects(run(),/Live service construction forbidden/);
});

test('actual Supabase client serializes one exact Storage deletion and the leased finish over injected transport',async t=>{
  t.mock.method(Date,'now',()=>NOW);
  const calls=[],item=job();
  const c=createClient('http://127.0.0.1:54321','synthetic-service-role-not-a-real-key',{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:async(input,init)=>{
      const url=new URL(String(input)),body=JSON.parse(init.body);
      assert.equal(url.origin,'http://127.0.0.1:54321');
      calls.push({method:init.method,path:url.pathname,body});
      if(url.pathname==='/rest/v1/rpc/claim_public_post_media_deletions')return Response.json([item]);
      if(url.pathname==='/storage/v1/object/beauty-profile-media')return Response.json([{name:item.object_path}]);
      if(url.pathname==='/rest/v1/rpc/finish_public_post_media_deletion')return Response.json(true);
      assert.fail('unexpected request in injected transport');
    }},
  });
  assert.deepEqual(await run(c),{claimed:1,removed:1,failed:0,deferred:0});
  assert.deepEqual(calls,[
    {method:'POST',path:'/rest/v1/rpc/claim_public_post_media_deletions',body:{p_limit:5}},
    {method:'DELETE',path:'/storage/v1/object/beauty-profile-media',body:{prefixes:[item.object_path]}},
    {method:'POST',path:'/rest/v1/rpc/finish_public_post_media_deletion',body:{p_id:I,p_lease:V,p_error:null}},
  ]);
});
