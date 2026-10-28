import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result=await build({stdin:{contents:'export {loadCustomerHistoryRead} from "./lib/customer-history-client";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'history-boundaries',setup(b){
  const fixtures={
    'app-local-host':'export const getAppLocalHost=()=>globalThis.historyFixture.host;',
    'app-local-command-client':'export const getAppLocalCommandScope=()=>globalThis.historyFixture.scope;',
    'experience-resource-cache':'export const experienceResourceCache={load:async(key,loader)=>{globalThis.historyFixture.webLoads++;return (await loader({})).data;}};',
    'fetch-live-experience-resource':'export const fetchLiveExperienceResource=(endpoint,scope)=>async()=>{globalThis.historyFixture.webRequests.push({endpoint,scope});return {data:{data:{kind:"history",result:{booking:null,receipt:null}}}};};',
  };
  b.onResolve({filter:/\/(app-local-host|app-local-command-client|experience-resource-cache|fetch-live-experience-resource)$/},a=>({path:a.path.split('/').at(-1),namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'js'}));
}}]});
const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {loadCustomerHistoryRead}=module.exports;
function fixture(){
  const f={scope:'viewer-A',reads:[],webLoads:0,webRequests:[]};
  f.host={isNative:true,read:async(name,args,options)=>{f.reads.push({name,args,options});return{status:200,scope:f.scope,data:{kind:'history',result:{booking:{id:'qa-booking'},receipt:null}}};}};
  globalThis.historyFixture=f;return f;
}
test('native Details uses the existing fresh scoped named read without web fetch',async()=>{
  const f=fixture();const value=await loadCustomerHistoryRead(f.scope,{bookingId:'qa-booking'});
  assert.equal(value.booking.id,'qa-booking');assert.equal(value.error,null);
  assert.equal(f.webLoads,0);assert.deepEqual(f.reads,[{name:'customer.history',args:{bookingId:'qa-booking'},options:{scope:'viewer-A',fresh:true}}]);
});
test('native receipt details forwards ticket ID through the same guarded read',async()=>{
  const f=fixture();await loadCustomerHistoryRead(f.scope,{ticketId:'qa-ticket'});
  assert.deepEqual(f.reads[0].args,{ticketId:'qa-ticket'});
});
test('stale initial identity cannot issue a history read',async()=>{
  const f=fixture();await assert.rejects(loadCustomerHistoryRead('viewer-old',{bookingId:'qa'}),/account has changed/i);assert.equal(f.reads.length,0);
});
test('identity change during read discards the old private details',async()=>{
  const f=fixture();f.host.read=async()=>{f.scope='viewer-B';return{status:200,scope:'viewer-A',data:{kind:'history',result:{booking:{id:'private-A'},receipt:null}}};};
  await assert.rejects(loadCustomerHistoryRead('viewer-A',{bookingId:'qa'}),/account has changed/i);
});
test('mismatched response scope and malformed payload do not reach the drawer',async()=>{
  const f=fixture();f.host.read=async()=>({status:200,scope:'viewer-B',data:{kind:'history',result:{}}});
  await assert.rejects(loadCustomerHistoryRead(f.scope,{bookingId:'qa'}),/account has changed/i);
  f.host.read=async()=>({status:200,scope:f.scope,data:{kind:'activity',result:{}}});
  await assert.rejects(loadCustomerHistoryRead(f.scope,{bookingId:'qa'}),/details/i);
});
test('server rejection propagates without alternate fetch or command retry',async()=>{
  const f=fixture();f.host.read=async()=>{throw Error('Access denied by server');};
  await assert.rejects(loadCustomerHistoryRead(f.scope,{bookingId:'qa'}),/Access denied/);assert.equal(f.webLoads,0);
});
test('web preserves live resource endpoint and cache behavior',async()=>{
  const f=fixture();f.host.isNative=false;await loadCustomerHistoryRead(f.scope,{ticketId:'qa-ticket'});
  assert.equal(f.reads.length,0);assert.equal(f.webLoads,1);assert.deepEqual(f.webRequests,[{endpoint:'/api/experience/customer?kind=history&ticketId=qa-ticket',scope:f.scope}]);
});
