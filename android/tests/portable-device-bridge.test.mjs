import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../app/src/main/assets/PortableDeviceBridge.js',import.meta.url),'utf8');
const first='00000000-0000-4000-8000-000000000001',next='00000000-0000-4000-8000-000000000002';
function fixture({frame=false,channel=true,bootstrap=true}={}){
 const window=new EventTarget(),sent=[],timers=new Map(),prompts=[],events=[];let timer=0,native=input=>({ok:true});
 window.top=frame?{}:window;window.prompt=message=>{prompts.push(JSON.parse(message.slice('__reylumiPortableDevice:'.length)));return JSON.stringify({ok:true,value:'committed'})};
 if(channel)window.reylumiPortable={postMessage(raw){const input=JSON.parse(raw);sent.push(input);const reply=native(input);if(reply!==undefined)this.onmessage({data:JSON.stringify({id:input.id,reply})})}};
 if(bootstrap)window.__reylumiPortableHost={nonce:first,documentGeneration:0};
 window.addEventListener('kingpos:portable-native-ready',()=>events.push('ready'));
 Object.defineProperty(window,'localStorage',{get(){throw Error('Native must not use browser fallback')}});
 vm.runInNewContext(source,{window,location:{pathname:'/pos/portable',search:'',hash:''},Event,setTimeout(fn){const id=++timer;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},Map,Promise,JSON,Number,Object,Error});
 return {window,sent,prompts,events,setNative(fn){native=fn},reply(input,value){window.reylumiPortable.onmessage({data:JSON.stringify({id:input.id,reply:value})})}};
}
test('Android bridge is main-frame/native-channel only and fails closed until a valid host bind',async()=>{
 assert.equal(fixture({frame:true}).window.__reylumiPortableDevice,undefined);assert.equal(fixture({channel:false}).window.__reylumiPortableDevice,undefined);
 const f=fixture({bootstrap:false});assert.equal(f.window.__reylumiPortableDevice.platform,'android');
 await assert.rejects(f.window.__reylumiPortableDevice.request({action:'storage.prepare'}),e=>e.code==='stale-host');
 assert.throws(()=>f.window.__reylumiPortableDevice.storage.get('draft'),e=>e.code==='storage-locked');
 f.window.__reylumiPortableBindHost({nonce:first,documentGeneration:0});assert.deepEqual(f.events,['ready']);
 await f.window.__reylumiPortableDevice.request({action:'storage.prepare',scope:'scope'});assert.equal(f.sent[0].nonce,first);assert.equal(f.sent[0].documentGeneration,0);
 assert.equal(f.window.__reylumiPortableDevice.storage.get('draft'),'committed');assert.equal(f.prompts[0].nonce,first);assert.equal(f.prompts[0].documentGeneration,0);
});
test('sync draft commits carry the exact acquired writer and native refusal throws without fallback',async()=>{
 const f=fixture();f.setNative(input=>input.action==='writer.acquire'?{acquired:true,token:'exact-writer'}:{ok:true});const device=f.window.__reylumiPortableDevice;
 await device.request({action:'storage.prepare',scope:'scope'});await device.request({action:'writer.acquire',scope:'scope',key:'draft'});
 device.storage.set('draft','{"savedAt":1}');assert.equal(f.prompts.at(-1).writerToken,'exact-writer');
 await device.request({action:'operations.save',operation:{kind:'receipt',payload:{localDraftKey:'draft'}}});assert.equal(f.sent.at(-1).writerToken,'exact-writer');
 f.window.prompt=()=>'{"ok":false,"code":"storage-unavailable","error":"Disk refused"}';assert.throws(()=>device.storage.set('draft','{}'),e=>e.code==='storage-unavailable'&&e.message==='Disk refused');
 f.window.prompt=()=>null;assert.throws(()=>device.storage.remove('draft'),e=>e.code==='storage-unavailable');
});
test('document rebind rejects stale acquisition and releases only its exact token, preserving new writer',async()=>{
 const f=fixture();const device=f.window.__reylumiPortableDevice;let old;
 f.setNative(input=>{if(input.action==='writer.acquire'&&!old){old=input;return undefined}if(input.action==='writer.acquire')return{acquired:true,token:'new-writer'};return{ok:true}});
 await device.request({action:'storage.prepare',scope:'scope'});const stale=device.request({action:'writer.acquire',scope:'scope',key:'draft'});
 f.window.__reylumiPortableBindHost({nonce:next,documentGeneration:1});await device.request({action:'storage.prepare',scope:'scope'});await device.request({action:'writer.acquire',scope:'scope',key:'draft'});
 f.reply(old,{acquired:true,token:'old-writer'});await assert.rejects(stale,e=>e.code==='stale-host');
 const release=f.sent.find(input=>input.action==='writer.release');assert.equal(release.token,'old-writer');assert.equal(release.nonce,next);assert.equal(release.documentGeneration,1);
 device.storage.set('draft','{}');assert.equal(f.prompts.at(-1).writerToken,'new-writer');
 f.window.dispatchEvent(new Event('kingpos:native-portable-lock'));assert.throws(()=>device.storage.get('draft'),e=>e.code==='storage-locked');
});
