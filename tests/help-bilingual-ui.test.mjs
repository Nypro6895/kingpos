import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

const output='artifacts/help-cleanup-20261025/qa';
fs.mkdirSync(output,{recursive:true});
fs.writeFileSync(`${output}/phase.json`,JSON.stringify({phase:"bundle",at:Date.now()}));
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';
import {HelpHome,HelpArticle} from './app/help/help-content';
import {findHelpGuide} from './lib/help-guides';
import SupportPage from './app/(app)/support/page';
import {WorkspaceLanguageProvider} from './components/workspace-language';
const root=createRoot(document.getElementById('root'));
window.show=async(kind='help',vi=false)=>{const language=new URL(location.href).searchParams.get('lang')==='vi'?'vi':'en';window.fixturePath=kind==='support'?'/support':kind==='article'?'/help/owner-tips':'/help';const content=kind==='support'?await SupportPage({searchParams:Promise.resolve({})}):kind==='article'?<HelpArticle guide={findHelpGuide('owner-tips')} language={language}/>:<HelpHome language={language}/>;root.render(<WorkspaceLanguageProvider enabled={vi} portableEnabled={false} expiresAt={null}>{content}</WorkspaceLanguageProvider>);};
window.show(location.pathname.startsWith('/help/')?'article':'help');`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'test-dependencies',setup(b){
 b.onResolve({filter:/^(server-only|next\/link|next\/navigation|next\/headers|@\/components\/experience-page|@\/lib\/support-cases|@\/lib\/guest-support)$/},a=>({path:a.path,namespace:'test'}));
 b.onResolve({filter:/^\.\/actions$/},a=>a.importer.replaceAll('\\','/').endsWith('/app/support/support-ui.tsx')?{path:'actions',namespace:'test'}:null);
 b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='server-only'?'':a.path==='next/link'?`export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,...props}){return <a {...props} onClick={event=>{if(props.href.startsWith('/help')){event.preventDefault();history.pushState({},'',props.href);window.dispatchEvent(new Event('fixture-route'));window.show(props.href.startsWith('/help/')?'article':'help');}}}/>}`:a.path==='next/navigation'?`import {useSyncExternalStore} from 'react';const subscribe=cb=>{window.addEventListener('fixture-route',cb);window.addEventListener('popstate',cb);return()=>{window.removeEventListener('fixture-route',cb);window.removeEventListener('popstate',cb)}};export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search,()=>''));export const usePathname=()=>window.fixturePath||'/help';export const useRouter=()=>({push(href){history.pushState({},'',href);window.dispatchEvent(new Event('fixture-route'));window.show(location.pathname.startsWith('/help/')?'article':'help')},refresh(){},replace(href){history.replaceState({},'',href);window.dispatchEvent(new Event('fixture-route'));window.show(location.pathname.startsWith('/help/')?'article':'help')}});`:a.path==='next/headers'?`export const cookies=async()=>({getAll:()=>[]});`:a.path.includes('experience-page')?`export const withExperiencePage=p=>p;`:a.path.includes('support-cases')?`export const supportRpc=async()=>[{id:'older',reference:'REQ-101',summary:'Previous test request',status:'resolved',updated_at:'2026-10-15T17:20:00Z'},{id:'newer',reference:'REQ-102',summary:'Staff not save button',status:'under_review',updated_at:'2026-10-17T20:15:00Z'}];`:a.path.includes('guest-support')?`export const getGuestSupport=async()=>null;`:`export const createSupportRequest=async()=>{throw Error('No submission allowed in UI test')};export const sendSupportMessage=()=>{};export const sendGuestSupportMessage=()=>{};export const uploadSupportEvidence=()=>{};export const reopenContentReportReview=()=>{};`}));
}}]});
fs.writeFileSync(`${output}/phase.json`,JSON.stringify({phase:'css',at:Date.now()}));
const globalCss=(await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "./support/support-ui.tsx";\n@source "./(app)/support/page.tsx";'),{from:path.resolve('app/globals.css')})).css;
fs.writeFileSync(`${output}/phase.json`,JSON.stringify({phase:'browser-ready',at:Date.now()}));
const native=fs.readFileSync('ios/Reylumi/AppViewport.js','utf8');

test('Help and Report remain readable in both languages on mobile, native viewport and desktop',{timeout:120000},async(t)=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 t.signal.addEventListener('abort',()=>void browser.close(),{once:true});
 const errors=[];const measurements=[];
 try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'vi-VN'});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('reylumi-help-language','vi'));
 await page.route('http://help.test/**',route=>{const name=new URL(route.request().url()).pathname;const asset=bundle.outputFiles.find(f=>f.path.endsWith(name==='/app.js'?'.js':'.css'));return route.fulfill({contentType:name==='/app.js'?'text/javascript':name==='/app.css'?'text/css':'text/html',body:name==='/app.js'?asset.text:name==='/app.css'?globalCss+'\n'+asset.text:`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`});});
 await page.goto('http://help.test/help');await page.getByRole('heading',{name:'Reylumi Help',exact:true}).waitFor();
 await page.locator('main[lang="en"]').waitFor();
 const guides=await page.locator('main a[href^="/help/"]').evaluateAll(links=>links.map(link=>link.getAttribute('href')));
 assert.equal(guides.length,13);assert.equal(new Set(guides).size,13,'Each guide appears once');
 assert(await page.getByRole('searchbox').isVisible());
 await page.screenshot({path:`${output}/home-en-390.png`});
 await page.evaluate(source=>{window.webkit={messageHandlers:{reylumi:{postMessage(){}}}};eval(source)},native);
 for(const width of [320,375,390,430,768,1280]){
  await page.setViewportSize({width,height:844});
  for(const language of ['en','vi']){
   await page.getByRole('button',{name:language==='en'?'English':'Tiếng Việt',exact:true}).click();
   await page.locator(`main[lang="${language}"]`).waitFor();
   const values=await page.locator('#help-results a').evaluateAll(links=>links.map(link=>{const title=link.querySelector('span[class*="guideTitle"]');const summary=link.querySelector('span[class*="summary"]');return {title:title.getBoundingClientRect().toJSON(),summary:summary.getBoundingClientRect().toJSON(),row:link.getBoundingClientRect().toJSON()}}));
   assert.equal(values.length,13);
   for(const v of values){assert(v.title.width>width*.5,`Narrow title at ${width}/${language}: ${v.title.width}`);assert(v.summary.y>=v.title.bottom-1,'Summary must sit below its title');assert(v.row.right<=width+1,'Row overflow');}
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
   measurements.push({width,language,minimumTitleWidth:Math.min(...values.map(v=>v.title.width))});
   if(width===390){await page.locator('#all-guides-heading').evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:`${output}/help-${language}-390.png`});}
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();
 assert((await page.locator('#help-results a').first().getAttribute('href')).endsWith('?lang=vi'));
 await page.getByRole('searchbox').fill('hoa hong');assert(await page.locator('#help-results a[href="/help/payroll-and-tax?lang=vi"]').count());
 await page.getByRole('searchbox').fill('');
 await page.getByRole('button',{name:'Nhân viên',exact:true}).click();assert((await page.locator('#help-results a').count())<13);
 await page.getByRole('button',{name:'Mọi vai trò',exact:true}).click();
 await page.locator('#help-results a[href="/help/owner-tips?lang=vi"]').click();
 await page.locator('main[lang="vi"]').waitFor();assert.match(await page.locator('h1').innerText(),/Mẹo/);
 await page.locator('main > a[href="/help?lang=vi"]').click();
 await page.getByRole('searchbox').waitFor();await page.locator('main[lang="vi"]').waitFor();
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'All roles',exact:true}).click();assert.equal(await page.locator('#help-results a').count(),13);
 await page.evaluate(()=>window.show('article'));await page.getByRole('heading',{name:'Owner Tips: run your first salon day',exact:true}).waitFor();
 const walkthroughs=page.locator('details[class*="walkthrough"]');assert.equal(await walkthroughs.count(),8);
 assert.equal(await page.locator('details[class*="walkthrough"][open]').count(),0);
 await walkthroughs.first().locator(':scope > summary').click();
 assert.equal(await page.locator('details[class*="walkthrough"][open]').count(),1);
 assert(await walkthroughs.first().locator('ol').isVisible());
 await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();await page.locator('main[lang="vi"]').waitFor();assert.match(await page.locator('h1').innerText(),/Mẹo/);
 await page.screenshot({path:`${output}/article-vi-390.png`});
 await page.reload();await page.locator('main[lang="vi"]').waitFor();
 await page.getByRole('button',{name:'English',exact:true}).click();await page.reload();await page.locator('main[lang="en"]').waitFor();
 await page.goto('http://help.test/help?lang=invalid');await page.locator('main[lang="en"]').waitFor();
 await page.goto('http://help.test/help?lang=vi');await page.locator('main[lang="vi"]').waitFor();
 await page.goto('http://help.test/help');await page.locator('main[lang="en"]').waitFor();
 for(const vi of [false,true]){
  await page.evaluate(vi=>window.show('support',vi),vi);
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
  await page.screenshot({path:`${output}/report-${vi?'vi':'en'}-390.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(`${output}/measurements.json`,JSON.stringify(measurements,null,2));
 }finally{await browser.close()}
});
