import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
const built=await build({entryPoints:['lib/social-text-reports.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.resolve('.')},plugins:[{name:'server-only',setup(api){api.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:''}));}}]});
const {submitSocialTextReport}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const id='20000000-0000-4000-8000-000000000001',salon='20000000-0000-4000-8000-000000000002',request='20000000-0000-4000-8000-000000000003',report='20000000-0000-4000-8000-000000000004';
function fixture({visible=true,source='experience',reply=false,providerError=false}={}) {
  const calls=[];
  const query={select(columns){calls.push({select:columns});return this;},eq(...args){calls.push({eq:args});return this;},async maybeSingle(){return {data:visible?{id,salon_id:salon,status:'published'}:null};}};
  return {calls,client:{from(table){calls.push({table});return query;},async rpc(name,args){calls.push({name,args});return name==='get_public_salon_profile_experiences'?{data:visible?[{id:reply?request:id,source,reply_id:reply?id:null,reply_body:reply?'Public reply':null}]:[]}:{data:providerError?null:report,error:providerError?{message:'private provider details'}:null};}}};
}
test('invalid targets and reasons cannot create support records',async()=>{
  const {client,calls}=fixture();
  for(const target of [{kind:'unknown',id},{kind:'comment',id:[id]},{kind:'comment',id:'invalid'}])
    await assert.rejects(submitSocialTextReport(client,{target,requestId:request,reason:'Harassment'}));
  await assert.rejects(submitSocialTextReport(client,{target:{kind:'comment',id},requestId:request,reason:'x'}));
  assert.equal(calls.length,0);
});
test('comments use an authenticated published-row read and report only a visible canonical target',async()=>{
  for(const visible of [false,true]) {
    const {client,calls}=fixture({visible});
    const operation=submitSocialTextReport(client,{target:{kind:'comment',id,salonId:request},requestId:request,reason:'Harassment'});
    if(!visible){await assert.rejects(operation,/unavailable/);assert(!calls.some(x=>x.name==='submit_user_support_case'));}
    else {assert.equal((await operation).supportHref,'/support/'+report);const c=calls.find(x=>x.name==='submit_user_support_case');assert(c.args.p_context.path.includes(salon));assert.equal(c.args.p_context.content_id,id);assert(!JSON.stringify(c).includes('Public reply'));}
  }
});
test('each review/experience/reply uses the visibility-aware projection, exact source and reply identity',async()=>{
  for(const kind of ['review','experience','review_reply','experience_reply']) {
    const source=kind.startsWith('review')?'legacy_review':'experience',reply=kind.endsWith('_reply');
    const {client,calls}=fixture({source,reply});
    await submitSocialTextReport(client,{target:{kind,id,salonId:salon},requestId:request,reason:'Abusive content'});
    assert.equal(calls[0].name,'get_public_salon_profile_experiences');
    assert.equal(calls[0].args.target_salon_id,salon);
    assert.equal(calls[1].args.p_request_id,request);
    const hidden=fixture({visible:false,source,reply});
    await assert.rejects(submitSocialTextReport(hidden.client,{target:{kind,id,salonId:salon},requestId:request,reason:'Abusive content'}),/unavailable/);
    assert.equal(hidden.calls.length,1);
  }
});
test('wrong parent/source/reply IDs are rejected and provider errors never disclose provider details',async()=>{
  const wrong=fixture({source:'legacy_review',reply:false});
  await assert.rejects(submitSocialTextReport(wrong.client,{target:{kind:'experience_reply',id,salonId:salon},requestId:request,reason:'Abusive content'}),/unavailable/);
  const failed=fixture({providerError:true});
  await assert.rejects(submitSocialTextReport(failed.client,{target:{kind:'comment',id},requestId:request,reason:'Abusive content'}),/could not be sent/);
});
test('a salon reply in private customer history is reportable only through the actor-scoped history RPC',async()=>{
  for(const kind of ['own_review_reply','own_experience_reply']) {
    const source=kind==='own_review_reply'?'legacy_review':'experience';
    for(const visible of [false,true]) {
      const calls=[];const client={async rpc(name,args){calls.push({name,args});return name==='get_my_visit_experiences'?{data:visible?[{id,source,reply_body:'Salon reply'}]:[]}:{data:report};},from(){throw Error('Private reply table must not be queried directly');}};
      const pending=submitSocialTextReport(client,{target:{kind,id},requestId:request,reason:'Abusive salon reply'});
      if(!visible){await assert.rejects(pending,/unavailable/);assert.equal(calls.length,1);}
      else {await pending;assert.equal(calls[0].args.p_experience,id);assert.equal(calls[1].args.p_context.path,`/more/reviews?experience=${id}`);assert.equal(calls[1].args.p_summary,'Report salon reply');}
    }
  }
});
