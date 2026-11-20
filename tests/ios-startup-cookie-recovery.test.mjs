import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const script=readFileSync('ios/Reylumi/AppLocalBridge.js','utf8');
const old={version:1,nonce:'old',scopeEpoch:0,generation:'old-generation'};
const fresh={version:1,nonce:'new',scopeEpoch:1,generation:'new-generation'};
function fixture(respond){
 const calls=[],events=[];
 const window={__reylumiAppLocalContext:{...old},webkit:{messageHandlers:{appLocal:{postMessage:async input=>{calls.push(input);return respond(input,calls.length);}}}},addEventListener(){},dispatchEvent(e){events.push(e);}};
 window.top=window;
 vm.runInNewContext(script,{window,location:{protocol:'reylumi-app:',hostname:'bundle'},document:{addEventListener(){}},MutationObserver:class{observe(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
 return {window,calls,events,request:window.__reylumiAppLocalTransport.request};
}
const stale=()=>({__hostError:{status:409,reason:'stale-host'},host:{...fresh}});
test('lost startup reset resynchronizes and obtains a fresh context once',async()=>{
 const f=fixture((_,n)=>n===1?stale():{host:fresh,context:{viewerId:'fresh-viewer'}});
 const result=await f.request({kind:'context',name:'context',id:'request',args:{path:'/explore'}});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0].nonce,old.nonce);assert.equal(f.calls[1].nonce,fresh.nonce);
 assert.equal(f.calls[1].args.fresh,true);assert.equal(f.calls[1].args.path,'/explore');
 assert.equal(result.context.viewerId,'fresh-viewer');assert.equal(result.__hostResynced,true);
 assert.equal(f.events[0].type,'reylumi:app-local-reset');assert.equal(f.events[0].detail.reason,'context');
});
test('a second stale reply stops instead of looping',async()=>{
 const f=fixture(stale);await assert.rejects(f.request({kind:'context'}),e=>e.status===409);assert.equal(f.calls.length,2);
});
test('commands and resource reads never replay across a reset',async()=>{
 for(const kind of ['command','read','cache','online']){const f=fixture(stale);await assert.rejects(f.request({kind}),e=>e.status===409);assert.equal(f.calls.length,1);assert.equal(f.window.__reylumiAppLocalContext.nonce,old.nonce);}
});
test('real permission denial remains denied and is not retried',async()=>{
 const f=fixture(()=>({__hostError:{status:403,message:'denied'}}));await assert.rejects(f.request({kind:'context'}),e=>e.status===403);assert.equal(f.calls.length,1);
});
test('older metadata cannot roll back a newer host',async()=>{
 const f=fixture(stale);f.window.__reylumiAppLocalContext={...fresh,scopeEpoch:2};await assert.rejects(f.request({kind:'context'}),e=>e.status===409);assert.equal(f.calls.length,1);assert.equal(f.window.__reylumiAppLocalContext.scopeEpoch,2);
});

test('permission denial after resync is preserved without another retry',async()=>{
 const f=fixture((_,n)=>n===1?stale():{__hostError:{status:403,message:'denied'}});
 await assert.rejects(f.request({kind:'context',args:{path:'/explore'}}),e=>e.status===403);
 assert.equal(f.calls.length,2);
});

test('invalid or non-advancing recovery metadata never retries',async()=>{
 for(const host of [{...fresh,version:2},{...fresh,scopeEpoch:0},{...fresh,scopeEpoch:1.5},{...fresh,nonce:null},{...fresh,generation:null}]){
  const f=fixture(()=>({__hostError:{status:409,reason:'stale-host'},host}));
  await assert.rejects(f.request({kind:'context'}),e=>e.status===409);assert.equal(f.calls.length,1);
 }
});

test('a reset during recovery cannot make an older successful reply current',async()=>{
 let f;
 f=fixture((_,n)=>{if(n===1)return stale();f.window.__reylumiAppLocalContext={...fresh,scopeEpoch:2,generation:'newest'};return {host:fresh};});
 await f.request({kind:'context'});
 assert.equal(f.window.__reylumiAppLocalContext.scopeEpoch,2);
 assert.equal(f.window.__reylumiAppLocalContext.generation,'newest');
});
test('host caller accepts only a newly read matching context after generation reset',async()=>{
 const bundled=await build({entryPoints:['lib/app-local-host.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Host',plugins:[{name:'isolate',setup(b){b.onResolve({filter:/^\.\//},({path,importer})=>importer.endsWith('app-local-host.ts')?{path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const fetchBoundedGet=()=>{},fetchWithDeadline=()=>{},acceptExperienceOfflineGrant=()=>{},clearExperienceSnapshots=()=>{},getExperienceDeviceGeneration=()=>{},captureAppLocalReadTrace=x=>x,newReadRequestId=()=>null,responseReadTrace=()=>null,APP_LOCAL_READ_REQUEST_ID="trace";'}));}}]});
 for(const marked of [true,false]){
  const window={__reylumiAppLocalContext:{...old},__reylumiAppLocalTransport:{request:async()=>{window.__reylumiAppLocalContext={...fresh};return {host:fresh,__hostResynced:marked};}}};
  const sandbox={window,crypto:{randomUUID:()=> 'request'},setTimeout,clearTimeout,AbortController,DOMException,URL};vm.createContext(sandbox);vm.runInContext(bundled.outputFiles[0].text,sandbox);
  const result=sandbox.Host.getAppLocalHost().context('/explore');
  if(marked)assert.equal((await result).host.generation,fresh.generation);else await assert.rejects(result,/account has changed/);
 }
});
