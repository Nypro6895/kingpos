import test from 'node:test';
import assert from 'node:assert/strict';import fs from 'node:fs';import{build,transformSync}from'esbuild';import{chromium}from'playwright-core';
// Compile the actual component bodies with fixture-only transports; no backend, provider or production data is contacted.
const s=fs.readFileSync('app/salon-profile/salon-profile-view.tsx','utf8'),components=s.slice(s.indexOf('function PendingSalonPostCard('),s.indexOf('function Avatar('));
const receiptHelpers=s.slice(s.indexOf('function salonPostReceiptScope('),s.indexOf('type PendingSalonPost'));
test('targeted posting preserves an owner working in Staff mode for the same salon', async () => {
  const actions=fs.readFileSync('app/salon-profile/actions.ts','utf8');
  const helper=actions.slice(actions.indexOf('async function withSalonContentTarget'),actions.indexOf('export type SalonProfileUploadSession'));
  const calls=[]; let context={currentSalon:{id:'a'},salonMode:'staff'};
  const load=new Function('getCurrentBusinessContext','withSettingsTarget',transformSync(helper,{loader:'ts',format:'cjs'}).code+'return withSalonContentTarget;');
  const run=load(async()=>context,async(id,action,mode)=>{calls.push([id,mode]);return action();});
  assert.equal(await run('a',async()=>42),42);assert.deepEqual(calls.pop(),['a','staff']);
  context={currentSalon:{id:'a'},salonMode:'manage'};
  await run('a',async()=>null);assert.deepEqual(calls.pop(),['a','manage']);
  await run('b',async()=>null);assert.deepEqual(calls.pop(),['b','auto']);
  await run(undefined,async()=>null);assert.equal(calls.length,0);
});

test('saved Salon confirmation rejects a mismatched or malformed frozen input without replacing it', () => {
  let saved={requestId:'request-a',input:{requestId:'request-a',salonId:'s',caption:'Draft',imagePath:'s/looks/staged.webp',contentType:'look'}};
  const restore=new Function('readPublicPostReceipt',transformSync(receiptHelpers,{loader:'ts',format:'cjs'}).code+'return readSalonPostReceipt;')(
    scope=>{assert.equal(scope,'salon:a:s');return saved;});
  assert.equal(restore('a','s'),saved);
  saved={...saved,input:{...saved.input,salonId:'other'}};assert.throws(()=>restore('a','s'),/saved post confirmation/);
  saved={...saved,input:{...saved.input,salonId:'s',additionalServiceIds:'invalid'}};assert.throws(()=>restore('a','s'),/saved post confirmation/);
  saved={...saved,input:{...saved.input,additionalServiceIds:[],requestId:'different'}};assert.throws(()=>restore('a','s'),/saved post confirmation/);
});
test('pending Salon preview is restricted to its author, salon and posting permission', () => {
const guard=new Function('pendingPost','capabilities','profile',s.match(/const visiblePendingPost = pendingPost[\s\S]*?\? pendingPost : null;/)[0]+'return visiblePendingPost;'),p={authorUserId:'a',salonId:'s'};
for(const[c,profile]of[[{canCreateContent:true,currentUserId:'b'},{salonId:'s'}],[{canCreateContent:true,currentUserId:'a'},{salonId:'x'}],[{canCreateContent:false,currentUserId:'a'},{salonId:'s'}]])assert.equal(guard(p,c,profile),null);
assert.equal(guard(p,{canCreateContent:true,currentUserId:'a'},{salonId:'s'}),p);
});

test('Salon upload sends bytes to quarantine while reserving and returning the logical post path', async () => {
  const body=s.slice(s.indexOf('async function processAndUploadImage('),s.indexOf('function EmptyState('));
  const calls=[];let reserved;
  const load=new Function('acceptedMimeTypes','SALON_PROFILE_IMAGE_LIMITS','processImage','getSalonProfileMediaUploadSessionAction','uploadToSupabase',
    transformSync(body,{loader:'ts',format:'cjs'}).code+'return processAndUploadImage;');
  const upload=load(new Set(['image/png']),{look:100,cover:100},async file=>file,
    async(...args)=>{calls.push({session:args});return args[0]==='identity'?{bucket:'salon-profile-media',path:'s/profile/cover.webp'}:
      {bucket:'public-image-quarantine',path:'salon-profile-media/s/looks/staged.webp',objectPath:'s/looks/staged.webp'};},
    async request=>{calls.push({bucket:request.bucket,path:request.path})});
  assert.equal(await upload({file:{type:'image/png',size:1},intent:'content',kind:'look',salonId:'s',onProgress(){},onReserved:path=>reserved=path}),'s/looks/staged.webp');
  assert.equal(reserved,'s/looks/staged.webp');assert.deepEqual(calls[0].session,['content','look',undefined,'s']);
  assert.deepEqual(calls[1],{bucket:'public-image-quarantine',path:'salon-profile-media/s/looks/staged.webp'});
  assert.equal(await upload({file:{type:'image/png',size:1},intent:'identity',kind:'cover',onProgress(){}}),'s/profile/cover.webp');
  assert.deepEqual(calls[3],{bucket:'salon-profile-media',path:'s/profile/cover.webp'});
});

const browserPath=process.env.TEST_BROWSER_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('actual Salon composer preserves rejected drafts and checks uncertain retries before publication', { timeout: 45000, skip: !fs.existsSync(browserPath) }, async () => {
const code=`import React,{useState,useRef,useId,useEffect}from'react';import{createRoot}from'react-dom/client';import{runPublicImageUploadBatch}from'./lib/public-image-upload-client';import{readPublicPostReceipt,writePublicPostReceipt,clearPublicPostReceipt}from'./lib/public-post-receipt';import{PublicPhotoProcessingPermission,usePublicPhotoProcessingPermission}from'./components/public-photo-processing-permission';import{PUBLIC_PHOTO_PROCESSING_DECLINE_NOTICE}from'./lib/public-photo-processing-consent';
${receiptHelpers}
window.readReceipt=scope=>readPublicPostReceipt(scope);
window.state={requests:[],uploads:0,cleanups:[],resolve:[],reject:[],scope:'a:s',published:0};window.addEventListener('reylumi:post-published',()=>window.state.published++);
const useWorkspaceTranslation=()=>v=>v,WorkspaceText=({text})=>text,SalonName=({name})=>name,Avatar=()=>null,PostPhotoIcon=()=>null,PostSuggestionField=()=>null,useTransientOverlay=()=>{},hashtagSuggestionsForServices=()=>null,SALON_PROFILE_ALLOWED_IMAGE_TYPES=['image/png'],acceptedMimeTypes=new Set(['image/png']),MediaUploadProgress=({phase})=><p>{phase}</p>,Modal=({children,footer,title})=><section role="dialog" aria-label={title}>{children}{footer}</section>;
async function processAndUploadImage(i){window.state.uploads++;i.onReserved?.('s/looks/stage.webp');i.onPhase?.('uploading');return new Promise(r=>window.state.uploadResolve=()=>{i.onProgress(100);r('s/looks/stage.webp')})}async function deleteSalonProfileMediaAction(p){window.state.cleanups.push(p)}async function createSalonProfileSocialPostAction(i){window.state.requests.push(structuredClone(i));return new Promise((r,j)=>{window.state.resolve.push(r);window.state.reject.push(j)})}
${components}
function Harness(){const[saved]=useState(()=>readSalonPostReceipt('a','s'));const[v,V]=useState(true),[p,P]=useState(null),[n,N]=useState(0);return <>{p&&<PendingSalonPostCard pending={p} onResume={()=>V(true)}/>}<output id="confirmed">{n}</output><ComposerModal data={{profile:{salonId:'s',name:'QA',logoImageUrl:null},services:[],staff:[]}} initialType="auto" initialReceipt={saved} viewerId="a" isCurrent={()=>window.state.scope==='a:s'} onClose={()=>V(false)} onPendingChange={p=>P(p)} onPresentedChange={V} onPosted={()=>N(n=>n+1)} presented={v}/></>};createRoot(document.getElementById('root')).render(<Harness/>);`;
const built=await build({stdin:{contents:code,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent',alias:{'@':process.cwd()}}),browser=await chromium.launch({executablePath:browserPath,headless:true});
try{const page=await browser.newPage(),errors=[];page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><script>'+built.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script>'}));await page.goto('http://localhost');
const consent={provider:'openai',noticeVersion:'public-photo-openai-20261118-v1',accepted:true};
const permission=()=>page.getByRole('checkbox',{name:'I agree to send the photos in this post to OpenAI for this safety check.'});
const chooseSamePhoto=()=>page.locator('input[type=file]').evaluate(input=>{const raw=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([raw],'qa.png',{type:'image/png',lastModified:1700000000000}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
const select=async()=>{await page.locator('textarea').fill('Preserved draft');await chooseSamePhoto();await permission().waitFor();assert.equal(await permission().isChecked(),false);assert.equal(await page.locator('button[type=submit]').isDisabled(),true);assert.equal(await page.locator('textarea').inputValue(),'Preserved draft');await permission().check();};
await select();await permission().uncheck();await page.locator('form').evaluate(form=>form.requestSubmit());assert.equal(await page.evaluate(()=>window.state.requests.length),0);assert.equal(await page.evaluate(()=>window.state.uploads),0);assert.equal(await page.locator('textarea').inputValue(),'Preserved draft');await permission().check();await page.locator('textarea').fill('Caption edited without changing the photo');assert.equal(await permission().isChecked(),true);await page.locator('textarea').fill('Preserved draft');await chooseSamePhoto();await page.waitForFunction(()=>!document.querySelector('input[aria-describedby]')?.checked);assert.equal(await permission().isChecked(),false);assert.equal(await page.locator('button[type=submit]').isDisabled(),true);await permission().check();await page.locator('button[type=submit]').click();await page.locator('[data-salon-post-request]').waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.evaluate(()=>window.state.requests.length),0);assert.equal(await page.locator('#confirmed').textContent(),'0');assert.match(await page.locator('[data-salon-post-request]').textContent(),/Only you/);
await page.evaluate(()=>window.state.uploadResolve());await page.waitForFunction(()=>window.state.requests.length===1);await page.evaluate(()=>window.state.resolve.shift()({error:'Unavailable',outcome:'rejected'}));await page.getByRole('dialog').waitFor();assert.equal(await page.locator('textarea').inputValue(),'Preserved draft');assert.equal(await page.locator('textarea').isDisabled(),false);assert.equal(await page.evaluate(()=>window.state.cleanups.length),0);
await page.locator('button[type=submit]').click();await page.waitForFunction(()=>window.state.requests.length===2);assert.equal(await page.evaluate(()=>window.state.requests[0].requestId===window.state.requests[1].requestId),true);assert.equal(await page.evaluate(()=>window.state.uploads),1);await page.evaluate(()=>window.state.reject.pop()(new Error('Transport interrupted')));await page.getByRole('dialog').waitFor();assert.equal(await page.locator('textarea').isDisabled(),true);assert.equal(await page.locator('#confirmed').textContent(),'0');assert.equal(await page.evaluate(()=>window.state.cleanups.length),0);
const frozenRequest=await page.evaluate(()=>window.state.requests[1]);
assert.deepEqual(frozenRequest.photoProcessingConsent,consent);
assert.deepEqual((await page.evaluate(()=>window.readReceipt('salon:a:s'))).input,frozenRequest);assert.equal(await page.evaluate(()=>window.readReceipt('salon:b:s')),null);
await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('Storage blocked')}});await page.locator('button[type=submit]').click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('textarea').isDisabled(),true);assert.equal(await page.evaluate(()=>window.state.requests.length),2);await page.evaluate(()=>{Storage.prototype.setItem=window.originalStorageSet});
await page.reload();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('textarea').isDisabled(),true);assert.equal(await page.locator('textarea').inputValue(),'Preserved draft');assert.match(await page.getByRole('dialog').textContent(),/preview is unavailable after reloading/);assert.equal(await page.evaluate(()=>window.state.uploads),0);assert.equal(await page.evaluate(()=>window.state.requests.length),0);assert.equal(await permission().count(),0,'unknown recovery must not offer or manufacture a new choice');
await page.locator('button[type=submit]').click();await page.waitForFunction(()=>window.state.requests.length===1);assert.deepEqual(await page.evaluate(()=>window.state.requests[0]),frozenRequest);assert.equal(await page.evaluate(()=>window.state.uploads),0);await page.evaluate(()=>window.state.resolve.pop()({error:null,post:{id:'confirmed'},look:null}));await page.waitForFunction(()=>document.querySelector('#confirmed').textContent==='1');assert.equal(await page.locator('[data-salon-post-request]').count(),0);assert.equal(await page.evaluate(()=>window.state.published),1);assert.equal(await page.evaluate(()=>window.state.cleanups.length),0);assert.equal(await page.evaluate(()=>window.readReceipt('salon:a:s')),null);
await page.reload();await page.locator('textarea').fill('Text-only Salon news');assert.equal(await permission().count(),0);assert.equal(await page.locator('button[type=submit]').isDisabled(),false);await page.locator('button[type=submit]').click();await page.waitForFunction(()=>window.state.requests.length===1);const textOnly=await page.evaluate(()=>window.state.requests[0]);assert.equal(textOnly.imagePath,null);assert.equal(Object.hasOwn(textOnly,'photoProcessingConsent'),false);await page.evaluate(()=>window.state.resolve.pop()({error:null,post:{id:'text-only'},look:null}));await page.waitForFunction(()=>document.querySelector('#confirmed').textContent==='1');
const legacy={requestId:'10000000-0000-4000-8000-000000000001',salonId:'s',caption:'Legacy photo confirmation',imagePath:'s/looks/legacy.webp',contentType:'look'};
await page.evaluate(input=>sessionStorage.setItem('reylumi:public-post:v1:salon:a:s',JSON.stringify({version:1,status:'unconfirmed',requestId:input.requestId,input})),legacy);await page.reload();await page.getByRole('dialog').waitFor();assert.equal(await permission().count(),0);await page.locator('button[type=submit]').click();await page.waitForFunction(()=>window.state.requests.length===1);assert.deepEqual(await page.evaluate(()=>window.state.requests[0]),legacy);await page.evaluate(()=>window.state.resolve.pop()({error:'Photo permission is required for new processing.',outcome:'rejected'}));await permission().waitFor();assert.equal(await permission().isChecked(),false);assert.equal(await page.locator('button[type=submit]').isDisabled(),true);await permission().check();await page.locator('button[type=submit]').click();await page.waitForFunction(()=>window.state.requests.length===2);const fresh=await page.evaluate(()=>window.state.requests[1]);assert.notEqual(fresh.requestId,legacy.requestId);assert.deepEqual(fresh.photoProcessingConsent,consent);assert.equal(await page.evaluate(()=>window.state.uploads),0);await page.evaluate(()=>window.state.resolve.pop()({error:null,post:{id:'legacy-recovered'},look:null}));await page.waitForFunction(()=>document.querySelector('#confirmed').textContent==='1');
await page.reload();await select();await page.locator('button[type=submit]').click();await page.waitForFunction(()=>Boolean(window.state.uploadResolve));await page.evaluate(()=>{window.state.scope='b:x';window.state.uploadResolve()});await page.waitForFunction(()=>window.state.cleanups.length===1);assert.equal(await page.evaluate(()=>window.state.requests.length),0);assert.equal(await page.evaluate(()=>window.state.published),0);assert.deepEqual(errors,[]);
}finally{await browser.close()}
});
