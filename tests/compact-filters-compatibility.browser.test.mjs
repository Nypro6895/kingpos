import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

let browser, server, origin;
const evidence=process.env.COMPACT_FILTER_QA_DIR, observations=[], requests=[], boxes={};
before(async()=>{
  if(evidence)fs.mkdirSync(evidence,{recursive:true});
  const source=`import React,{Activity,useEffect,useState}from'react';import{createRoot}from'react-dom/client';import{CompactFilters}from'./components/compact-filters';import{OfflineNetworkFormGuard}from'./components/offline-network-form-guard';
window.fixture={submits:[],blocked:0,cancelClicks:0,mode:'accepted'};
function App(){const[hidden,setHidden]=useState(false);window.hideActivity=()=>setHidden(true);window.showActivity=()=>setHidden(false);useEffect(()=>{window.fixtureReady=true;const accepted=event=>{if(window.fixture.mode==='document-helper'&&event.target instanceof HTMLFormElement){event.preventDefault();window.fixture.documentAccepted=true}};document.addEventListener('submit',accepted);return()=>document.removeEventListener('submit',accepted)},[]);
const fields=<><label>Criterion <input name="criterion" defaultValue="initial"/></label><button type="submit" name="action" value="apply">Apply</button><button type="button" onClick={()=>window.fixture.cancelClicks++}>Cancel</button></>;
const submit=event=>{if(window.fixture.mode==='stopped'){event.preventDefault();event.stopPropagation();window.fixture.blocked++;return}window.fixture.submits.push([...new FormData(event.currentTarget,event.nativeEvent.submitter).entries()]);if(window.fixture.mode!=='native')event.preventDefault()};
const panel=new URLSearchParams(location.search).get('form')==='inner'?<CompactFilters label="Audit filters"><form id="inner-owner" onSubmit={submit}><input name="scope" type="hidden" value="synthetic-A"/>{fields}</form></CompactFilters>:<form id="outer-owner" onSubmit={submit}><input name="scope" type="hidden" value="synthetic-A"/><button type="submit" name="action" value="outside-default">Outer default</button><CompactFilters label="Audit filters">{fields}</CompactFilters></form>;
return <><OfflineNetworkFormGuard/><button id="outside" type="button">Outside target</button><Activity mode={hidden?'hidden':'visible'}><div style={{transform:'translateZ(0)',overflow:'hidden',height:60,padding:12,border:'1px solid #ddd'}}>{panel}</div></Activity></>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`;
  const navigation=`import{useSyncExternalStore}from'react';const sub=f=>{window.addEventListener('popstate',f);return()=>window.removeEventListener('popstate',f)};export function usePathname(){return useSyncExternalStore(sub,()=>location.pathname,()=>'/fixture')}export function useSearchParams(){return new URLSearchParams(useSyncExternalStore(sub,()=>location.search,()=>''))}`;
  const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'fixture.js',platform:'browser',format:'iife',target:['safari16'],jsx:'automatic',loader:{'.css':'local-css'},plugins:[{name:'controlled-router-context-only',setup(builder){builder.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'controlled-router'}));builder.onLoad({filter:/.*/,namespace:'controlled-router'},()=>({contents:navigation,loader:'js',resolveDir:process.cwd()}));}}]});
  const js=compiled.outputFiles.find(x=>x.path.endsWith('.js')).text,css=compiled.outputFiles.find(x=>x.path.endsWith('.css')).text;
  server=createServer((req,res)=>{requests.push({method:req.method,path:new URL(req.url,'http://fixture.invalid').pathname});if(req.method!=='GET'){res.writeHead(405);res.end();return}if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);return}if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);return}res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'none'; object-src 'none'; base-uri 'none'");res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><main id="root" style="font:16px Arial;padding:20px"></main><script src="/fixture.js"></script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));assert.ok(requests.every(x=>x.method==='GET'));if(evidence){fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(path.join(evidence,'fixture-result.json'),JSON.stringify({observations,requests,actualComponentAndCSS:true,onlyRouterContextStubbed:true,capabilitySimulationNotNativeIOS16:true,providerOrDeviceAcceptance:false},null,2)+'\n');}});
async function open(mode,form='outer'){
  const context=await browser.newContext({viewport:{width:430,height:700},serviceWorkers:'block'});
  await context.route('**/*',route=>route.request().method()==='GET'&&new URL(route.request().url()).origin===origin?route.continue():route.abort());
  if(mode==='fallback')await context.addInitScript(()=>{for(const key of ['hidePopover','showPopover','togglePopover'])Object.defineProperty(HTMLElement.prototype,key,{value:undefined,configurable:true});});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/fixture?form='+form);await page.waitForFunction(()=>window.fixtureReady);await page.waitForTimeout(30);
  const panel=page.locator(mode==='fallback'?'dialog[data-compact-dialog]':'div[popover]'),trigger=page.getByRole('button',{name:'Audit filters',exact:true});
  assert.equal(await panel.count(),1);assert.equal(await panel.isVisible(),false);assert.deepEqual(errors,[]);
  await trigger.click();await panel.waitFor({state:'visible'});await page.evaluate(()=>{window.initialInput=document.querySelector('[name=criterion]');});
  return{context,page,panel,trigger,errors};
}
for(const mode of ['native','fallback']){
  test(`${mode}: same panel visual/top layer, retained controls, Cancel and Escape focus`,async()=>{
    const{context,page,panel,trigger,errors}=await open(mode);try{
      await page.locator('[name=criterion]').fill('retained QA');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await panel.isVisible(),true);assert.equal(await page.evaluate(()=>window.fixture.cancelClicks),1);
      boxes[mode]=await panel.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{left:r.left,top:r.top,width:r.width,height:r.height,padding:s.padding,border:s.border,borderRadius:s.borderRadius,background:s.backgroundColor,clipped:r.bottom>el.parentElement.getBoundingClientRect().bottom}});assert.equal(boxes[mode].clipped,true);
      if(evidence)await page.screenshot({path:path.join(evidence,`${mode}-same-panel.png`)});
      await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>document.activeElement===el),true);await trigger.click();
      assert.deepEqual(await page.evaluate(()=>({same:window.initialInput===document.querySelector('[name=criterion]'),value:document.querySelector('[name=criterion]').value,form:document.querySelector('[name=criterion]').form.id})),{same:true,value:'retained QA',form:'outer-owner'});assert.deepEqual(errors,[]);observations.push({mode,case:'visual-retained-escape',box:boxes[mode]});
    }finally{await context.close();}
  });
  for(const form of ['inner','outer'])test(`${mode}: accepted same-query ${form} JS submit closes and preserves submitter`,async()=>{
    const{context,page,panel,errors}=await open(mode,form);try{await page.locator('[name=criterion]').fill('same-query QA');await page.getByRole('button',{name:'Apply',exact:true}).click();await panel.waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>window.fixture.submits),[[['scope','synthetic-A'],['criterion','same-query QA'],['action','apply']]]);assert.deepEqual(errors,[]);observations.push({mode,form,case:'accepted-same-query'});}finally{await context.close();}
  });
  test(`${mode}: document accepted JS and captured/React guards retain ownership`,async()=>{
    const{context,page,panel,trigger,errors}=await open(mode);try{
      await page.evaluate(()=>window.fixture.mode='document-helper');await page.getByRole('button',{name:'Apply',exact:true}).click();await panel.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.fixture.documentAccepted),true);
      await trigger.click();await page.locator('[name=criterion]').fill('guarded draft');await page.evaluate(()=>window.fixture.mode='stopped');await page.getByRole('button',{name:'Apply',exact:true}).click();assert.equal(await panel.isVisible(),true);assert.equal(await page.evaluate(()=>window.fixture.blocked),1);
      await page.evaluate(()=>{window.fixture.mode='accepted';Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});});await page.getByRole('button',{name:'Apply',exact:true}).click();assert.equal(await panel.isVisible(),true);assert.equal(await page.locator('[name=criterion]').inputValue(),'guarded draft');assert.equal(await page.evaluate(()=>window.fixture.submits.length),1);assert.deepEqual(errors,[]);observations.push({mode,case:'document-and-original-guards'});
    }finally{await context.close();}
  });
  test(`${mode}: outside, route, scope reset and Activity close without losing draft`,async()=>{
    const{context,page,panel,trigger,errors}=await open(mode);try{
      await page.locator('[name=criterion]').fill('activity draft');const outside=await page.locator('#outside').boundingBox();await page.mouse.click(outside.x+outside.width/2,outside.y+outside.height/2);await panel.waitFor({state:'hidden'});await trigger.click();
      await page.evaluate(()=>{history.pushState({},'','/fixture?changed=1');dispatchEvent(new PopStateEvent('popstate'));});await panel.waitFor({state:'hidden'});await trigger.click();await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));await panel.waitFor({state:'hidden'});await trigger.click();
      await page.evaluate(()=>window.hideActivity());await page.waitForFunction(()=>!document.querySelector('dialog[open],:popover-open'));await page.evaluate(()=>window.showActivity());await trigger.waitFor({state:'visible'});assert.equal(await panel.isVisible(),false);await trigger.click();assert.equal(await page.locator('[name=criterion]').inputValue(),'activity draft');assert.equal(await page.evaluate(()=>window.initialInput===document.querySelector('[name=criterion]')),true);assert.deepEqual(errors,[]);observations.push({mode,case:'dismiss-and-activity'});
    }finally{await context.close();}
  });
}
test('fallback rapid reopen ignores a queued old close event',async()=>{
  const{context,page,panel,errors}=await open('fallback');try{await page.locator('[name=criterion]').fill('rapid retained');await page.evaluate(()=>{const dialog=document.querySelector('dialog[data-compact-dialog]');document.querySelector('button[aria-label="Close Audit filters"]').click();document.querySelector('button[aria-label="Audit filters"]').click();dialog.dispatchEvent(new Event('close'));});await page.waitForTimeout(30);assert.equal(await panel.isVisible(),true);assert.deepEqual(await panel.evaluate(el=>({open:el.open,hidden:el.hidden})),{open:true,hidden:false});assert.equal(await page.locator('[name=criterion]').inputValue(),'rapid retained');assert.deepEqual(errors,[]);observations.push({mode:'fallback',case:'rapid-reopen'});}finally{await context.close();}
});
for(const mode of ['native','fallback'])test(`${mode}: outer-form Enter keeps the browser-selected submitter`,async()=>{
  const{context,page,panel,errors}=await open(mode);
  try{
    await page.locator('[name=criterion]').fill('Enter QA');
    await page.locator('[name=criterion]').press('Enter');
    await page.waitForTimeout(60);
    const submits=await page.evaluate(()=>window.fixture.submits);
    const focused=await page.evaluate(()=>({tag:document.activeElement?.tagName,name:document.activeElement?.getAttribute('name'),value:document.activeElement?.getAttribute('value')}));
    assert.deepEqual(submits,[[['scope','synthetic-A'],['action','outside-default'],['criterion','Enter QA']]]);
    // An implicit Enter can select the form's default button outside the
    // panel. Observe browser focus/dismissal without substituting an Apply
    // button or changing the native branch's light-dismiss behavior.
    assert.equal(await page.locator('[name=criterion]').inputValue(),'Enter QA');
    assert.deepEqual(errors,[]);
    observations.push({mode,case:'outer-enter',submitted:submits.length,submitter:'outside-default',focused,panelVisible:await panel.isVisible()});
  }finally{await context.close();}
});
test('fallback matches native panel geometry and established style',()=>{const a={...boxes.native},b={...boxes.fallback};assert.ok(a.width&&b.width);for(const key of ['left','top','width','height'])assert.ok(Math.abs(a[key]-b[key])<=1,`${key} must match`);for(const key of ['padding','border','borderRadius','background'])assert.equal(a[key],b[key]);});
