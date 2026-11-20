import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const scope='00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003';
const draftKey='kingpos:portable-draft:v1:'+scope+':native-device';
const androidUA='Mozilla/5.0 (Linux; Android 16; wv) ReylumiAndroid/1.0 ReylumiAndroidPOS/1.0';
const modules=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
 export * from './lib/portable-device-storage';export * from './lib/portable-native-platform';
 export * from './lib/portable-native-client';export * from './lib/portable-operations';export * from './lib/portable-recovery-key';
`},bundle:true,write:false,platform:'browser',format:'cjs'});
function fixture(userAgent=androidUA){
 const values=new Map(),browser=new Map(),calls=[],window=new EventTarget();let fail=false,idb=0,posts=0;
 const device={version:1,platform:'android',storage:{get:key=>values.get(key)??null,set(key,value){if(fail)throw Error('Native disk full');values.set(key,value);},remove:key=>values.delete(key)},async request(input){calls.push(structuredClone(input));if(fail)throw Error('Native disk full');return input.action==='operations.list'?[]:input.action==='operations.checkpoint'?0:{ok:true};}};
 window.__reylumiPortableDevice=device;
 const module={exports:{}},location={pathname:'/pos/portable'};
 const context={module,exports:module.exports,window,location,navigator:{userAgent,onLine:false},
  localStorage:{getItem:key=>browser.get(key)??null,setItem:(key,value)=>browser.set(key,value),removeItem:key=>browser.delete(key)},
  indexedDB:{open(){idb++;throw Error('Unexpected browser outbox');}},fetch(){posts++;throw Error('Unexpected API');},
  crypto:webcrypto,structuredClone,Event,CustomEvent,setTimeout,clearTimeout,AbortSignal,console};
 vm.runInNewContext(modules.outputFiles[0].text,context);
 return {api:module.exports,context,window,device,values,browser,calls,location,fail(){fail=true;},idb:()=>idb,posts:()=>posts};
}

test('Android native expectation requires both exact app/POS tokens; generic Android WebViews keep browser behavior',async()=>{
 const f=fixture();assert.equal(f.api.portableNativePlatform(androidUA),'android');
 for(const ua of ['Mozilla/5.0 (Linux; Android 16; wv)','ReylumiAndroid/1.0','ReylumiAndroidPOS/1.0','FakeReylumiAndroid/1.0 ReylumiAndroidPOS/1.0','ReylumiAndroid/1.0 ReylumiAndroidPOS/1.0evil'])assert.equal(f.api.portableNativePlatform(ua),null,ua);
 assert.equal(f.api.portableNativePlatform('ReylumiIOS/1.0'),'ios');assert.equal(f.api.iosPortableDevice(),undefined);assert.equal(f.api.androidPortableDevice(),f.device);assert.equal(f.api.desktopDevice(),undefined);
 delete f.window.__reylumiPortableDevice;
 await assert.rejects(f.api.preparePortableNativeStorage(scope),/Connect and unlock/);
 assert.throws(()=>f.api.portableDeviceStorage.setItem(draftKey,'must-not-fall-back'),/Connect and unlock/);
 await assert.rejects(f.api.savePortableOperation(scope,'receipt',{localDraftKey:draftKey}),/Connect and unlock/);
 assert.equal(f.browser.size,0);assert.equal(f.idb(),0);assert.equal(f.posts(),0);
 const browser=fixture('Mozilla/5.0 (Linux; Android 16; wv)');delete browser.window.__reylumiPortableDevice;
 assert.equal(await browser.api.preparePortableNativeStorage(scope),null);browser.api.portableDeviceStorage.setItem('browser-draft','retained');assert.equal(browser.browser.get('browser-draft'),'retained');
});

test('Android storage and queued receipts stay native, preserve legacy work, and fail without success or IndexedDB fallback',async()=>{
 const f=fixture();f.browser.set(draftKey,'{"legacy":true}');
 assert.equal(f.api.portableDeviceStorage.getItem(draftKey),'{"legacy":true}');assert.equal(f.values.get(draftKey),'{"legacy":true}');assert.equal(f.browser.get(draftKey),'{"legacy":true}');
 const key=f.api.portableRecoveryStorageKey({scope:'replaceable-view',operationScope:scope,tabId:'new-webview',desktop:false,native:true,durableNative:true,storage:f.api.portableDeviceStorage});assert.equal(key,draftKey);
 let failures=0,success=0;f.window.addEventListener(f.api.PORTABLE_NATIVE_STORAGE_FAILED,()=>failures++);f.window.addEventListener(f.api.PORTABLE_OPERATIONS_CHANGED,()=>success++);
 f.fail();assert.throws(()=>f.api.portableDeviceStorage.setItem(draftKey,'new-draft'),/Native disk full/);
 await assert.rejects(f.api.savePortableOperation(scope,'receipt',{localDraftKey:draftKey,total:125}),/Native disk full/);
 assert.equal(success,0);assert.equal(failures,2);assert.equal(f.idb(),0);assert.equal(f.posts(),0);assert.equal(f.values.get(draftKey),'{"legacy":true}');
 const missing=fixture();missing.device.platform='ios';assert.throws(()=>missing.api.portableDevice(),/Connect and unlock/);
 const malformed=fixture();malformed.device.version=2;assert.throws(()=>malformed.api.portableDevice(),/Connect and unlock/);
 f.location.pathname='/pos';assert.equal(f.api.portableDevice(),undefined,'Owner POS remains on its own storage path');
});

test('receipt replay strips only device print metadata without mutating durable financial identity, retry or acknowledgement',async()=>{
 const f=fixture(),requests=[];
 const operation={id:'00000000-0000-4000-8000-000000000060',scope,kind:'receipt',occurredAt:'2026-11-18T12:00:00Z',state:'pending',
  payload:{localDraftKey:draftKey,total:125,tip:5,lines:[{id:'line-id',staffId:'staff-id',amount:120}],printSnapshot:{displayOnly:'x'.repeat(150000)}}};
 const original=structuredClone(operation);let stored=structuredClone(operation),ack;
 f.context.navigator.onLine=true;
 f.device.request=async input=>{if(input.action==='operations.list')return[structuredClone(stored)];if(input.action==='operations.save'){ack=structuredClone(input.operation);stored=ack;return{ok:true};}throw Error('Unexpected queue request');};
 f.context.fetch=async(_url,init)=>{requests.push(init.body);return{status:200,ok:true,json:async()=>requests.length===1?{kind:'retry'}:{kind:'ok',data:{ticketId:'canonical-server-ticket'}}};};
 await f.api.syncPortableOperations(scope);assert.equal(ack,undefined);await f.api.syncPortableOperations(scope);
 assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.ok(Buffer.byteLength(requests[0])<128*1024);
 const posted=JSON.parse(requests[0]),expected=structuredClone(operation);delete expected.payload.printSnapshot;assert.deepEqual(posted,expected);
 assert.deepEqual(operation,original);assert.equal(ack.id,operation.id);assert.equal(ack.state,'synced');assert.deepEqual(ack.payload,original.payload);
});

const ui=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
 import{PortableNativeStorageBoundary}from'./app/pos/portable/portable-native-storage-boundary';
 import{PortableNativeModeSettings}from'./app/pos/portable/portable-native-mode-settings';
 import{usePortableDraft}from'./app/pos/portable/use-portable-draft';
 import{listPortableOperations}from'./lib/portable-operations';window.fixture.list=scope=>listPortableOperations(scope);
 function Editor(){const[amount,setAmount]=useState('125.00');const draft=usePortableDraft({scope:'display-scope',operationScope:'${scope}',version:0,recovery:{amount},restore:value=>setAmount(value.amount),onVersion:()=>{}});
 useEffect(()=>{window.fixture.mounts++;return()=>{window.fixture.unmounts++}},[]);
 return <main><label>Amount<input value={amount} disabled={!draft.ready} onChange={e=>setAmount(e.target.value)}/></label><button disabled={!draft.ready}>Submit receipt</button><output data-ready={String(draft.ready)}>{draft.status}</output><PortableNativeModeSettings/></main>}
 const root=createRoot(document.getElementById('root'));window.fixture.destroy=()=>root.unmount();
 root.render(<PortableNativeStorageBoundary scope='${scope}'><Editor/></PortableNativeStorageBoundary>);
`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'native-ui-language',setup(b){b.onResolve({filter:/workspace-language$|app-local-host$/},({path})=>({path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('workspace-language')?'export const WorkspaceText=({text})=>text;':'export const getAppLocalHost=()=>({isNative:false});'}));}}]});

async function inBrowser(options,work){
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?ui.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
 const context=await browser.newContext({userAgent:androidUA});
 await context.addInitScript(({options,scope})=>{
  Object.defineProperty(navigator,'onLine',{get:()=>false});
  const state=window.fixture={values:{},calls:[],mounts:0,unmounts:0,owner:null,nextWriter:0,mode:'personal',fail:false,hold:options.hold,admissions:[],posts:[],imported:[],receiptEvents:[]};
  window.addEventListener('kingpos:receipt-admission-changed',event=>state.receiptEvents.push(structuredClone(event.detail)));
  state.seed=()=>options.legacy?(state.seedPromise??=new Promise((resolve,reject)=>{const request=indexedDB.open('kingpos-portable-operations',1);request.onupgradeneeded=()=>{request.result.createObjectStore('operations',{keyPath:'sequence',autoIncrement:true});request.result.createObjectStore('meta');};request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['operations','meta'],'readwrite');tx.objectStore('operations').add(options.legacy);tx.objectStore('meta').put(123456,'receipt:'+scope+':'+options.legacy.payload.localDraftKey);tx.oncomplete=()=>{db.close();resolve();};};})):Promise.resolve();
  const readiness=()=>({ok:true,prepared:true,storage:'native',scope:options.wrongScope?'foreign':scope,offlineReady:false,expiresAt:new Date(Date.now()+(options.leaseMS??3600000)).toISOString()});
  state.allow=()=>state.admissions.shift()?.(readiness());
  const native={version:1,platform:options.wrongPlatform?'ios':'android',storage:{get:key=>state.values[key]??null,set(key,value){if(state.fail)throw Error('Native disk full');state.values[key]=value;},remove:key=>{delete state.values[key];}},async request(input){
   state.calls.push(structuredClone(input));
   if(input.action==='storage.prepare'){state.owner=null;await state.seed();return state.hold?new Promise(resolve=>state.admissions.push(resolve)):readiness();}
   if(input.action==='writer.acquire'){if(state.owner)return{acquired:false};state.owner='writer-'+ ++state.nextWriter;return{acquired:true,token:state.owner};}
   if(input.action==='writer.release'){if(state.owner===input.token)state.owner=null;return{released:true};}
   if(input.action==='operations.list'){if(input.scope!==scope||state.failList)throw Object.assign(Error('Scoped access changed'),{code:'storage-locked'});return state.imported;}if(input.action==='operations.checkpoint')return 0;
   if(input.action==='operations.import'){state.imported.push(input.operation);return{ok:true};}
   if(input.action==='offline.status')return readiness();if(input.action==='mode.get')return{mode:state.mode};if(input.action==='mode.set'){state.mode=input.mode;return{mode:state.mode};}
   throw Error('Unexpected native action');
  }};state.install=()=>{window.__reylumiPortableDevice=native;};if(!options.missing)state.install();
  const original=window.fetch.bind(window);window.fetch=(url,init)=>{if(String(url).includes('/api/')){state.posts.push(String(url));throw Error('Business requests forbidden');}return original(url,init);};
 },{options,scope});
 const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/pos/portable');await work(page);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixture.posts),[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}

test('real Android native boundary blocks absent/wrong-scope admission before mounting any editor',async()=>{
 for(const options of [{missing:true},{wrongScope:true},{wrongPlatform:true}])await inBrowser(options,async page=>{await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.fixture.mounts),0);assert.equal(await page.getByRole('button',{name:'Submit receipt'}).count(),0);});
});

test('late Android document-start host binding retries initial admission without browser fallback',async()=>{
 await inBrowser({missing:true},async page=>{
  await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>window.fixture.mounts),0);
  await page.evaluate(()=>{window.fixture.install();window.dispatchEvent(new Event('kingpos:portable-native-ready'));});
  await page.locator('output[data-ready=true]').waitFor();assert.equal(await page.evaluate(()=>window.fixture.mounts),1);
  await page.getByLabel('Amount').fill('188.00');
  await page.evaluate(()=>window.dispatchEvent(new Event('kingpos:portable-native-ready')));
  await page.locator('output[data-ready=true]').waitFor();assert.equal(await page.getByLabel('Amount').inputValue(),'188.00');
  assert.equal(await page.evaluate(()=>window.fixture.mounts),1);assert.equal(await page.evaluate(()=>window.fixture.unmounts),0);
 });
});

test('Android admission imports the original legacy receipt UUID/payload/checkpoint before mounting and retains its browser source',async()=>{
 const legacy={sequence:7,id:'00000000-0000-4000-8000-000000000050',scope,kind:'receipt',occurredAt:'2026-11-18T12:00:00Z',payload:{localDraftKey:'legacy-known-draft',total:125},state:'attention',error:'Uncertain upload'};
 await inBrowser({legacy},async page=>{
  await page.locator('output[data-ready=true]').waitFor();assert.deepEqual(await page.evaluate(()=>window.fixture.imported),[legacy]);
  const call=await page.evaluate(()=>window.fixture.calls.find(c=>c.action==='operations.import'));assert.equal(call.checkpointAt,123456);
  const source=await page.evaluate(async()=>{const request=indexedDB.open('kingpos-portable-operations');const db=await new Promise(resolve=>{request.onsuccess=()=>resolve(request.result);});const read=db.transaction('operations').objectStore('operations').getAll();const rows=await new Promise(resolve=>{read.onsuccess=()=>resolve(read.result);});db.close();return rows;});assert.deepEqual(source,[legacy]);
 });
});

test('Android disk failure hides/inerts retained editor and submit; readmission keeps latest input and reacquires native writer',async()=>{
 await inBrowser({},async page=>{
  await page.locator('output[data-ready=true]').waitFor();await page.getByLabel('Amount').fill('199.00');
  await page.waitForFunction(()=>Object.values(window.fixture.values).some(v=>v.includes('199.00')));
  const settings=page.getByRole('region',{name:'Device POS'});
  await settings.getByText('This app opens Portable POS when it starts.',{exact:true}).waitFor();
  assert.equal(await settings.getByRole('button',{name:'Turn on',exact:true}).count(),0);
  assert.equal(await settings.getByRole('button',{name:'Return to Reylumi',exact:true}).count(),0);
  assert.equal(await page.getByLabel('Amount').inputValue(),'199.00');
  await page.evaluate(()=>{window.fixture.fail=true;});await page.getByLabel('Amount').fill('250.00');
  await page.locator('[data-portable-native-storage=failed]').waitFor();
  const input=page.locator('input');assert.equal(await input.inputValue(),'250.00');assert.equal(await input.evaluate(e=>e.closest('[inert]')?.hidden),true);assert.equal(await page.getByRole('button',{name:'Submit receipt'}).count(),0);
  assert.equal(await page.evaluate(()=>window.fixture.mounts),1);assert.equal(await page.evaluate(()=>window.fixture.unmounts),0);
  await page.evaluate(()=>{window.fixture.fail=false;});await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.locator('output[data-ready=true]').waitFor();assert.equal(await page.getByLabel('Amount').inputValue(),'250.00');
  await page.waitForFunction(()=>Object.values(window.fixture.values).some(v=>v.includes('250.00')));
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.action==='writer.acquire').length),2);
  assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('kingpos:portable-draft:'))),[]);
 });
});

test('late prior-scope operation failures cannot revoke the current native editor; matching failures remain closed',async()=>{
 await inBrowser({},async page=>{
  await page.locator('output[data-ready=true]').waitFor();await page.getByLabel('Amount').fill('150.00');
  await page.evaluate(async()=>{await window.fixture.list('00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000099').catch(()=>{});});
  assert.equal(await page.locator('[data-portable-native-storage=failed]').count(),0);assert.equal(await page.getByRole('button',{name:'Submit receipt'}).isEnabled(),true);
  await page.evaluate(async scope=>{window.fixture.failList=true;await window.fixture.list(scope).catch(()=>{});},scope);
  await page.locator('[data-portable-native-storage=failed]').waitFor();assert.equal(await page.locator('input').inputValue(),'150.00');assert.equal(await page.getByRole('button',{name:'Submit receipt'}).count(),0);
 });
});

test('Android lock wins over a late native admission and later readiness/reset notifications',async()=>{
 await inBrowser({hold:true},async page=>{
  await page.waitForFunction(()=>window.fixture.admissions.length===1);
  await page.evaluate(()=>{window.dispatchEvent(new Event('kingpos:native-portable-lock'));window.fixture.allow();});
  await page.locator('[data-portable-native-storage=locked]').waitFor();
  await page.evaluate(()=>{for(const name of ['kingpos:native-readiness','reylumi:app-local-reset','kingpos:native-writer-reset','kingpos:portable-native-ready'])window.dispatchEvent(new Event(name));});
  assert.equal(await page.evaluate(()=>window.fixture.mounts),0);assert.equal(await page.getByRole('button',{name:'Submit receipt'}).count(),0);
 });
});

test('receipt portals receive actual admission, expiry and cleanup scope fences while retained draft stays inert',async()=>{
 await inBrowser({leaseMS:1500},async page=>{
  await page.locator('output[data-ready=true]').waitFor();await page.getByLabel('Amount').fill('315.00');
  await page.locator('[data-portable-native-storage=expired]').waitFor();
  assert.equal(await page.locator('input').inputValue(),'315.00');assert.equal(await page.locator('input').evaluate(e=>e.closest('[inert]')?.hidden),true);
  const events=await page.evaluate(()=>window.fixture.receiptEvents);assert.ok(events.some(e=>e.scope===scope&&e.state==='checking'));assert.ok(events.some(e=>e.scope===scope&&e.state==='ready'));assert.deepEqual(events.at(-1),{scope,state:'expired'});
  await page.evaluate(()=>window.fixture.destroy());assert.deepEqual(await page.evaluate(()=>window.fixture.receiptEvents.at(-1)),{scope,state:'checking'});
 });
});
