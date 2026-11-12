import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
const executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe';

test('language invitation, direct switch, persisted later, English override and personal default', {skip:!fs.existsSync(executablePath)}, async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{SalonLanguagePreferences,LanguageSetting,LanguageNotifications}from'./components/salon-language-preferences';
 import{WorkspaceLanguageProvider,WorkspaceText}from'./components/workspace-language';
 import{PERSONAL_LANGUAGE}from'./lib/salon-language';
 const activation='00000000-0000-4000-8000-000000000099';
 const offer={code:'vi',activation,expiresAt:'2099-01-01T00:00:00Z'};
 const initial=location.search.includes('personal')?PERSONAL_LANGUAGE:{...PERSONAL_LANGUAGE,salonId:'salon-b',salonName:'Salon B',offers:[offer],notices:[{code:'vi',activation,seen:false,accepted:false}]};
 const stored=sessionStorage.getItem('state');window.state=stored?JSON.parse(stored):initial;
 window.calls=[];window.fail=false;window.refreshes=0;
 function App(){const[scope,setScope]=useState('salon-b');const[snapshot,setSnapshot]=useState(window.state);window.renderSnapshot=setSnapshot;return <><button onClick={()=>setScope('personal')}>Personal workspace</button><SalonLanguagePreferences key={scope} initial={scope==='personal'?PERSONAL_LANGUAGE:snapshot}><WorkspaceLanguageProvider enabled={false} portableEnabled={false} expiresAt={null}><h1><WorkspaceText text="Payroll"/></h1><LanguageSetting/><LanguageNotifications/></WorkspaceLanguageProvider></SalonLanguagePreferences></>};
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'server-stubs',setup(b){
  b.onResolve({filter:/^(next\/navigation|.*language-actions)$/},a=>({path:a.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({resolveDir:process.cwd(),loader:'js',contents:a.path.includes('navigation')?`import{useState,useEffect}from'react';export function usePathname(){const[p,setP]=useState(location.pathname);useEffect(()=>{const update=()=>setP(location.pathname);window.addEventListener('navigation',update);return()=>window.removeEventListener('navigation',update)},[]);return p;}export const useRouter=()=>({refresh(){window.refreshes++}});`:`
   export async function languageAction(salon,action,code,activation){
    window.calls.push({salon,action,code,activation});
    if(window.deny&&action==='load')return{error:'Your workspace changed. Refresh and try again.',accessDenied:true};
    if(window.fail&&action==='choose')return{error:'Could not change language. Please try again.'};
    if(window.delay&&action==='choose')await new Promise(r=>window.release=r);
    const state=JSON.parse(JSON.stringify(window.state));
    if(window.delayLoad&&action==='load')await new Promise(r=>window.releaseLoad=r);
    if(action==='choose'){state.choiceRevision=String(BigInt(state.choiceRevision??'0')+1n);state.selected=code;state.selectedActivation=code==='en'?null:state.offers[0].activation;state.effective=code;state.notices=state.notices.map(n=>({...n,seen:true,accepted:n.code===code}));}
    if(action==='seen')state.notices=state.notices.map(n=>({...n,seen:true}));
    if(action!=='load'){window.state=state;sessionStorage.setItem('state',JSON.stringify(state));}return{state};
   }` }));
 }}]});
 const stylePath='.next/dev/static/css/app/layout.css';
 const appStyles=fs.existsSync(stylePath)?fs.readFileSync(stylePath,'utf8'):'';
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${appStyles}body{font:16px Arial;margin:16px}button,select{min-height:44px}h1{font-size:24px;margin:16px 0}</style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath,headless:true});
 fs.mkdirSync('artifacts/salon-language-choice-20261110/screenshots',{recursive:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}/settings`;
  await page.goto(url);
  const popup=page.getByRole('dialog');await popup.waitFor();
  assert.equal(await page.getByRole('heading',{name:'Payroll',exact:true}).count(),1,'activation does not change language');
  await page.screenshot({path:'artifacts/salon-language-choice-20261110/screenshots/invitation-mobile.png'});
  await popup.getByRole('button',{name:/Để sau/}).click();
  await page.reload();await page.getByRole('combobox').waitFor();
  assert.equal(await page.getByRole('dialog').count(),0,'seen invitation does not reopen');
  const staleInitial=await page.evaluate(()=>JSON.parse(JSON.stringify(window.state)));
  await page.getByRole('region',{name:'Language updates'}).getByRole('button',{name:'Chuyển sang Tiếng Việt',exact:true}).click();
  await page.getByRole('heading',{name:'Lương',exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox').inputValue(),'vi');
  assert.equal(await page.locator('html').getAttribute('lang'),'vi');
  assert.ok(await page.evaluate(()=>window.refreshes>0),'server labels refreshed');
  await page.evaluate(stale=>window.renderSnapshot(stale),staleInitial);
  await page.waitForTimeout(50);
  assert.equal(await page.getByRole('combobox').inputValue(),'vi','stale server render cannot undo a newer saved choice');
  await page.getByRole('combobox').selectOption('en');
  await page.getByRole('heading',{name:'Payroll',exact:true}).waitFor();
  await page.reload();await page.getByRole('combobox').waitFor();assert.equal(await page.getByRole('combobox').inputValue(),'en');
  await page.getByRole('button',{name:'Language information'}).click();
  const info=page.getByText(/Additional languages are available/);await info.waitFor();
  assert.equal((await info.textContent()).includes('Vietnamese'),false,'information is package-neutral');
  await page.evaluate(()=>{window.delayLoad=true;window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>typeof window.releaseLoad==='function');
  await page.getByRole('combobox').selectOption('vi');
  await page.getByRole('heading',{name:'Lương',exact:true}).waitFor();
  await page.evaluate(()=>{window.delayLoad=false;window.releaseLoad();});
  await page.waitForTimeout(50);
  assert.equal(await page.getByRole('combobox').inputValue(),'vi','old background response cannot undo a newer choice');
  await page.getByRole('combobox').selectOption('en');
  await page.getByRole('heading',{name:'Payroll',exact:true}).waitFor();
  for(const width of [390,820,1440]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'artifacts/salon-language-choice-20261110/screenshots/settings-'+width+'.png'});
  }
  await page.evaluate(()=>window.fail=true);await page.getByRole('combobox').selectOption('vi');
  await page.getByRole('alert').first().waitFor();assert.equal(await page.getByRole('combobox').inputValue(),'en','failed save cannot change UI');
  await page.evaluate(()=>{window.fail=false;window.delay=true;});
  await page.getByRole('combobox').selectOption('vi');
  await page.waitForFunction(()=>typeof window.release==='function');
  await page.getByRole('button',{name:'Personal workspace'}).click();
  await page.evaluate(()=>window.release());
  assert.equal(await page.getByRole('combobox').inputValue(),'en');
  assert.equal(await page.locator('option[value=vi]').isDisabled(),true);
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>sessionStorage.clear());await page.goto(url+'?personal');
  await page.getByRole('combobox').waitFor();assert.equal(await page.getByRole('combobox').inputValue(),'en');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>sessionStorage.clear());await page.goto(url);await page.getByRole('dialog').waitFor();
  await page.evaluate(()=>{history.pushState(null,'','/explore');window.dispatchEvent(new Event('navigation'));});
  await page.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await page.getByRole('dialog').count(),0,'invitation closes on personal route');
  await page.evaluate(()=>sessionStorage.clear());await page.goto(url);await page.getByRole('dialog').waitFor();
  await page.evaluate(()=>{window.state={...window.state,offers:[],notices:[]};window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await page.locator('option[value=vi]').isDisabled(),true,'revoked offer closes popup and disables language');
  assert.equal(await page.getByRole('region',{name:'Language updates'}).count(),0);
  await page.evaluate(()=>sessionStorage.clear());await page.goto(url);await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'Chuyển sang Tiếng Việt',exact:true}).click();
  await page.getByRole('heading',{name:'Lương',exact:true}).waitFor();
  await page.evaluate(()=>{window.deny=true;window.dispatchEvent(new Event('focus'));});
  await page.getByRole('heading',{name:'Payroll',exact:true}).waitFor();
  assert.equal(await page.locator('option[value=vi]').isDisabled(),true,'revoked session stops applying language');
  await page.getByRole('alert').waitFor();
  assert.deepEqual(errors,[]);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
});
