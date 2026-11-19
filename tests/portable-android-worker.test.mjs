import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

const built=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:"export {getExperienceOfflineWorker,prepareExperienceOfflinePath} from './lib/experience-offline-client';"},bundle:true,write:false,format:'cjs',platform:'browser',plugins:[{name:'worker-only-fixture',setup(b){
 b.onResolve({filter:/experience-persistent-cache$|bounded-get$|experience-trace$|experience-authorized-read$/},({path})=>({path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('experience-persistent-cache')?
  "export const getExperienceDeviceGeneration=()=>'synthetic-device-generation';export const acceptExperienceOfflineGrant=async()=>false;export const clearExperienceSnapshots=async()=>{};export const getExperienceOfflineGrant=()=>null;export const getExperienceOfflineGrantForPath=()=>null;export const loadExperienceOfflineGrant=async()=>null;export const markExperienceScopeOnlineValidated=()=>{};":path.endsWith('bounded-get')?
  "export const fetchBoundedGet=()=>{throw Error('Business network forbidden in worker fixture')};":path.endsWith('experience-trace')?
  'export const recordExperienceTrace=()=>{};export const nextExperienceTraceOperation=()=>1;':
  'export const createExperienceAuthorizedReads=()=>({read:(_key,run)=>run(new AbortController().signal),reset(){}});'}));
}}]});

function fixture(userAgent){
 const calls={lookups:0,registrations:[],messages:[]},window=new EventTarget();window.isSecureContext=true;
 const location={origin:'http://localhost:3121',pathname:'/pos/portable',search:'',href:'http://localhost:3121/pos/portable'};
 const worker={scriptURL:location.origin+'/portable-sw.js',postMessage(message,ports){calls.messages.push(message);ports[0].reply({ok:false});}};
 const serviceWorker={getRegistrations:async()=>{calls.lookups++;return[];},register:async(script,options)=>{calls.registrations.push({script,...options});return{scope:location.origin+'/pos/',active:worker};},addEventListener(){}};
 class Channel{constructor(){this.port1={onmessage:null,close(){}};this.port2={reply:data=>queueMicrotask(()=>this.port1.onmessage?.({data}))};}}
 const module={exports:{}};vm.runInNewContext(built.outputFiles[0].text,{module,exports:module.exports,window,location,navigator:{userAgent,onLine:true,serviceWorker},
  URL,URLSearchParams,Event,CustomEvent,MessageChannel:Channel,performance:{now:()=>0,getEntriesByType:()=>[]},setTimeout,clearTimeout,queueMicrotask,AbortController,console});
 return{api:module.exports,calls,worker};
}

test('dedicated Android POS never registers, discovers or prepares a browser private HTML worker',async()=>{
 const f=fixture('Mozilla/5.0 (Android 17; wv) ReylumiAndroid/1.0 ReylumiAndroidPOS/1.0');
 assert.equal(await f.api.getExperienceOfflineWorker('/pos/portable'),null);
 assert.equal(await f.api.prepareExperienceOfflinePath('/pos/portable'),null);
 assert.equal(f.calls.lookups,0);assert.deepEqual(f.calls.registrations,[]);assert.deepEqual(f.calls.messages,[]);
});

test('web, general Android WebView, Windows and iOS retain their existing worker preparation',async()=>{
 for(const agent of ['Mozilla/5.0 Chrome Windows','Mozilla/5.0 (Android 17; wv)','ReylumiAndroid/1.0','ReylumiIOS/1.0']){
  const f=fixture(agent);assert.equal(await f.api.getExperienceOfflineWorker('/pos/portable'),f.worker,agent);
  assert.equal(f.calls.lookups,1);assert.deepEqual(f.calls.registrations,[{script:'/portable-sw.js',scope:'/pos/',updateViaCache:'none'}]);
 }
});
