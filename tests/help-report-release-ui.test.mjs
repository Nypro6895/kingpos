import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

const output='C:/Users/giuse/kingpos/artifacts/help-report-live-20261017/qa';
fs.mkdirSync(output,{recursive:true});
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {HelpHome,HelpArticle} from './app/help/help-content';
import {findHelpGuide} from './lib/help-guides';
import SupportPage from './app/(app)/support/page';
import {WorkspaceLanguageProvider} from './components/workspace-language';
import {AppLocalHelp} from './components/app-local-help';
import {AppLocalSupport} from './components/app-local-support';
const root=createRoot(document.getElementById('root'));
const cases=[{id:'older',reference:'REQ-101',summary:'Previous test request',status:'resolved',updated_at:'2026-10-15T17:20:00Z'},{id:'newer',reference:'REQ-102',summary:'Staff not save button',status:'under_review',updated_at:'2026-10-17T20:15:00Z'}];
window.navigateUrl=href=>{history.replaceState({},'',href);const u=new URL(location.href);window.show(window.kind,u.searchParams.get('lang')==='vi');};
window.show=async(kind='help',vi=false)=>{window.kind=kind;window.fixturePath=kind.includes('support')?'/support':'/help';const language=vi?'vi':'en';const content=kind==='support'?await SupportPage({searchParams:Promise.resolve({})}):kind==='native-guest-support'?<AppLocalHelp support language={language} navigate={window.navigateUrl}/>:kind==='native-support'?<AppLocalSupport data={{cases}}/>:kind==='native'?<AppLocalHelp language={language} navigate={window.navigateUrl}/>:kind==='native-article'?<AppLocalHelp slug="owner-tips" language={language} navigate={window.navigateUrl}/>:kind==='article'?<HelpArticle language={language} guide={findHelpGuide('owner-tips')}/>:<HelpHome language={language}/>;root.render(<WorkspaceLanguageProvider enabled={kind.includes('support')&&vi} portableEnabled={false} expiresAt={null}>{content}</WorkspaceLanguageProvider>);};
window.show();`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'test-dependencies',setup(b){
 b.onResolve({filter:/^(server-only|next\/link|next\/navigation|next\/headers|@\/components\/experience-page|@\/lib\/support-cases|@\/lib\/guest-support)$/},a=>({path:a.path,namespace:'test'}));
 b.onResolve({filter:/^\.\/actions$/},a=>a.importer.replaceAll('\\','/').endsWith('/app/support/support-ui.tsx')?{path:'actions',namespace:'test'}:null);
 b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='server-only'?'':a.path==='next/link'?`export default function Link({prefetch,...props}){return <a {...props}/>}`:a.path==='next/navigation'?`export const usePathname=()=>window.fixturePath||'/help';export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:href=>window.navigateUrl(href),replace:href=>window.navigateUrl(href),refresh(){}});`:a.path==='next/headers'?`export const cookies=async()=>({getAll:()=>[]});`:a.path.includes('experience-page')?`export const withExperiencePage=p=>p;`:a.path.includes('support-cases')?`export const supportRpc=async()=>[{id:'older',reference:'REQ-101',summary:'Previous test request',status:'resolved',updated_at:'2026-10-15T17:20:00Z'},{id:'newer',reference:'REQ-102',summary:'Staff not save button',status:'under_review',updated_at:'2026-10-17T20:15:00Z'}];`:a.path.includes('guest-support')?`export const getGuestSupport=async()=>null;`:`export const createSupportRequest=async()=>{throw Error('No submission allowed in UI test')};export const sendSupportMessage=()=>{};export const sendGuestSupportMessage=()=>{};export const uploadSupportEvidence=()=>{};export const reopenContentReportReview=()=>{};`}));
}}]});
const globalCss=(await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "./support/support-ui.tsx";\n@source "./(app)/support/page.tsx";\n@source "../components/app-local-support.tsx";'),{from:path.resolve('app/globals.css')})).css;
const native=fs.readFileSync('ios/Reylumi/AppViewport.js','utf8');

test('Help and Report remain readable in both languages on mobile, native viewport and desktop',{timeout:120000},async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const errors=[];const measurements=[];
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.on('pageerror',e=>{errors.push(e.message);console.error('UI runtime:',e.message);});
 await page.route('https://help.test/**',route=>{const name=new URL(route.request().url()).pathname;const asset=bundle.outputFiles.find(f=>f.path.endsWith(name==='/app.js'?'.js':'.css'));return route.fulfill({contentType:name==='/app.js'?'text/javascript':name==='/app.css'?'text/css':'text/html',body:name==='/app.js'?asset.text:name==='/app.css'?globalCss+'\n'+asset.text:`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`});});
 await page.goto('https://help.test/');await page.getByRole('heading',{name:'Reylumi Help',exact:true}).waitFor();
 await page.evaluate(source=>{window.webkit={messageHandlers:{reylumi:{postMessage(){}}}};eval(source)},native);
 for(const kind of ['help','native']){
 await page.evaluate(kind=>window.show(kind),kind);
 for(const width of [320,375,390,430,768,1280]){
  await page.setViewportSize({width,height:844});
  for(const language of ['en','vi']){
   await page.getByRole('button',{name:language==='en'?'English':'Tiếng Việt',exact:true}).click();
   await page.locator(`main[lang="${language}"]`).waitFor();
   const values=await page.locator('#help-results a').evaluateAll(links=>links.map(link=>{const title=link.querySelector('[class*="guideTitle"]');const summary=link.querySelector('span[class*="summary"]');return {title:title.getBoundingClientRect().toJSON(),summary:summary.getBoundingClientRect().toJSON(),row:link.getBoundingClientRect().toJSON()}}));
   assert.equal(values.length,13);
   for(const v of values){assert(v.title.width>width*.5,`Narrow title at ${width}/${language}: ${v.title.width}`);assert(v.summary.y>=v.title.bottom-1,'Summary must sit below its title');assert(v.row.right<=width+1,'Row overflow');}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
   measurements.push({kind,width,language,minimumTitleWidth:Math.min(...values.map(v=>v.title.width))});
   if(width===390){await page.locator('#help-results').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:`${output}/${kind}-${language}-390.png`});}
  }
 }
 }
 await page.evaluate(()=>window.show('help'));
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();
 await page.getByRole('searchbox').fill('hoa hong');assert(await page.locator('#help-results a[href^="/help/payroll-and-tax"]').count());
 await page.getByRole('searchbox').fill('');
 await page.getByRole('button',{name:'Nhân viên',exact:true}).click();assert((await page.locator('#help-results a').count())<13);
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'All roles',exact:true}).click();assert.equal(await page.locator('#help-results a').count(),13);
 await page.evaluate(()=>window.show('article'));await page.getByRole('heading',{name:'Owner Tips: run your first salon day',exact:true}).waitFor();
 await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();await page.locator('main[lang="vi"]').waitFor();assert.match(await page.locator('h1').innerText(),/Mẹo/);
 await page.screenshot({path:`${output}/article-vi-390.png`});
 assert.match(page.url(),/lang=vi/);
 await page.getByRole('button',{name:'English',exact:true}).click();await page.locator('main[lang="en"]').waitFor();
 for(const kind of ['support','native-support'])for(const vi of [false,true]){
  await page.evaluate(({kind,vi})=>window.show(kind,vi),{kind,vi});
  await page.getByRole('heading',{name:vi?'Yêu cầu của tôi':'My requests',exact:true}).waitFor();
  assert.equal(await page.locator('main a[href="/help"]').count(),0);
  const rows=page.locator('main a[href^="/support/"]');assert.equal(await rows.count(),2);assert.equal(await rows.first().getAttribute('href'),'/support/newer');
  assert.equal(await rows.locator('time').count(),2);
  assert.equal(await rows.first().locator('time').getAttribute('datetime'),'2026-10-17T20:15:00.000Z');
  assert.match(await page.locator('h1').innerText(),vi?/Báo lỗi/:/Report/);
  assert.equal(await page.locator('select option').first().innerText(),vi?'Chức năng ứng dụng':'App functionality');
  assert.match(await rows.first().locator('time').innerText(),vi?/Cập nhật lần cuối/:/Last updated/);
  assert.equal(await rows.first().evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
  assert.equal(await rows.first().evaluate(e=>getComputedStyle(e).borderRadius),'0px');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${output}/${kind}-${vi?'vi':'en'}-390.png`,fullPage:true});
 }
 for(const vi of [false,true]){
  await page.evaluate(vi=>window.show('native-guest-support',vi),vi);
  await page.getByRole('heading',{name:vi?'Báo lỗi / Liên hệ':'Report / Contact',exact:true}).waitFor();
  assert.equal(await page.locator('main a[href^="/help"]').count(),0);
  await page.getByRole('heading',{name:vi?'Gửi yêu cầu':'Send a request',exact:true}).waitFor();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(`${output}/measurements.json`,JSON.stringify(measurements,null,2));
 }finally{await browser.close()}
});
