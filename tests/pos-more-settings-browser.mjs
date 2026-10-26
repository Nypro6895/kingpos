import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const out = 'artifacts/pos-more-settings-20261025';
const files = ['app/pos/owner-pos-tabs.tsx', 'components/role-more-content.tsx', 'app/settings/settings-hub-client.tsx'];
const hashes = Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));
const fixture = `import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
import{OwnerPosTabs}from'./app/pos/owner-pos-tabs';import{SettingsHubClient}from'./app/settings/settings-hub-client';
window.qa={checks:[],errors:[],source:${JSON.stringify(hashes)}};
window.addEventListener('error',e=>window.qa.errors.push(e.message));
window.qaPath='/pos';window.go=p=>{window.qaPath=p;window.dispatchEvent(new Event('qa-route'));window.dispatchEvent(new Event('scroll'));window.dispatchEvent(new Event('resize'))};
function App(){const[path,setPath]=useState('/pos');React.useEffect(()=>{const fn=()=>setPath(window.qaPath);window.addEventListener('qa-route',fn);return()=>window.removeEventListener('qa-route',fn)},[]);return <><Activity mode={path==='/pos'?'visible':'hidden'}><OwnerPosTabs active="pos"/></Activity><Activity mode={path==='/settings'?'visible':'hidden'}><SettingsHubClient user={{email:'fixture@example.test'}} createdAtLabel="Today" index={{managed:[{id:'one',name:'Fixture Salon',owner:true,role:'Owner',status:'active',permissions:{},owners:[]}],staff:[],accounts:[]}}/></Activity><p id="status"/></>}
createRoot(document.getElementById('root')).render(<App/>);
const pause=()=>new Promise(r=>setTimeout(r,150));
const check=(value,label)=>{if(!value)throw Error(label);window.qa.checks.push(label)};
const button=text=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);
const more=()=>document.querySelector('.owner-more-button');
const link=text=>[...document.querySelectorAll('[data-owner-more-popover] a')].find(e=>e.textContent.trim()===text);
(async()=>{await pause();
 more().click();await pause();check(!!link('View all settings'),'Settings action exists');check(link('View all settings').getAttribute('href')==='/settings','Settings action targets all-settings hub');
 link('View all settings').click();await pause();check(window.qaPath==='/settings','All Settings navigation');check(!document.querySelector('[data-owner-more-popover]'),'Portal closes despite immediate scroll and resize');check(document.querySelector('.settings-hub').dataset.settingsView==='home','Initial Settings shows account and salon hub');
 [...document.querySelectorAll('.settings-account-link')].find(e=>e.textContent.includes('Fixture Salon')).click();await pause();check(document.querySelector('.settings-hub').dataset.settingsView==='group','Salon settings group can be selected');
 window.go('/pos');await pause();check(!document.querySelector('[data-owner-more-popover]'),'Returning to POS keeps More closed');more().click();await pause();link('View all settings').click();await pause();check(document.querySelector('.settings-hub').dataset.settingsView==='home','Reopening All Settings resets previous salon editor');
 window.go('/pos');await pause();more().click();await pause();window.go('/other');await pause();check(!document.querySelector('[data-owner-more-popover]'),'Activity hide removes portal even without link click');
 window.go('/pos');await pause();more().click();await pause();link('All').click();await pause();check(window.qaPath==='/pos/more'&&!document.querySelector('[data-owner-more-popover]'),'All closes More and navigates');
 window.go('/pos');await pause();more().click();await pause();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await pause();check(!document.querySelector('[data-owner-more-popover]'),'Escape closes menu');
 more().click();await pause();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await pause();check(!document.querySelector('[data-owner-more-popover]'),'Outside tap closes menu');
 check(window.qa.errors.length===0,'No JavaScript errors');window.qa.passed=true;
})().catch(e=>{window.qa.errors.push(e.stack);window.qa.passed=false}).finally(()=>{window.qa.done=true;document.getElementById('status').textContent=JSON.stringify(window.qa)});`;
const stubs = {
 language: `import React from 'react';export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`,
 navigation: `import React from 'react';export const usePathname=()=>React.useSyncExternalStore(fn=>{window.addEventListener('qa-route',fn);return()=>window.removeEventListener('qa-route',fn)},()=>window.qaPath);`,
 link: `import React from 'react';export const useLinkStatus=()=>({pending:false});export default function Link({href,onClick,onNavigate,children,...props}){return <a {...props} href={href} onClick={e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();onNavigate?.({preventDefault(){}});window.go(href)}}}>{children}</a>}`,
};
const result = await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'qa-fixtures',setup(b){
 b.onResolve({filter:/next\/navigation$/},()=>({path:'navigation',namespace:'stub'}));
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'stub'}));
 b.onResolve({filter:/components\/workspace-language$/},()=>({path:'language',namespace:'stub'}));
 b.onResolve({filter:/^\.\//},a=>{
  if(!a.importer.endsWith('settings-hub-client.tsx'))return;
  if(a.path.endsWith('.css'))return;
  return {path:a.path,namespace:'panel'};
 });
 b.onResolve({filter:/app\/account\/account-profile-editor$/},()=>({path:'account-profile-editor',namespace:'panel'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:process.cwd()}));
 b.onLoad({filter:/.*/,namespace:'panel'},()=>({contents:'export const AccountProfileEditor=()=>null,PersonalPublicProfilePanel=()=>null,DeferredPersonalSection=()=>null,NotificationPreferencesPanel=()=>null,ConnectionsPanel=()=>null,SalonListPanel=()=>null,DirectSettingsPanel=()=>null,BlockedUsersPanel=()=>null;export async function loadSettingsHub(){throw Error("Unexpected server action")}',loader:'tsx'}));
}}]});
mkdirSync(out+'/static',{recursive:true});
writeFileSync(out+'/static/index.html',`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${result.outputFiles.find(f=>f.path.endsWith('.css'))?.text||''}</style><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script')}</script>`);
writeFileSync(out+'/source-hashes.json',JSON.stringify(hashes,null,2));
if(!process.argv.includes('--generate-only')){
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{for(const width of [393,1280]){
  const page=await browser.newPage({viewport:{width,height:852}});
  page.on('pageerror',e=>console.error(e.stack));
  await page.route('http://fixture.test/**',r=>r.fulfill({contentType:'text/html',body:readFileSync(out+'/static/index.html','utf8')}));
  await page.goto('http://fixture.test/');
  await page.waitForFunction(()=>window.qa?.done);
  const qa=await page.evaluate(()=>window.qa);writeFileSync(out+'/chromium-'+width+'.json',JSON.stringify(qa,null,2));assert.equal(qa.passed,true,JSON.stringify(qa));console.log(width+': '+qa.checks.length+' checks passed');await page.close();
 }}finally{await browser.close()}
}
