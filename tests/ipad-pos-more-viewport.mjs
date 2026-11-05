import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const out = 'artifacts/ipad-pos-more-20261104';
mkdirSync(out, { recursive: true });
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';
import{OwnerPosTabs}from'./app/pos/owner-pos-tabs';
import{PortableDraftControls}from'./app/pos/portable/portable-draft-controls';
window.qaPath='/pos';window.go=p=>{window.qaPath=p;window.dispatchEvent(new Event('qa-route'))};
function App(){const[active,setActive]=React.useState(false);return <><h1>iPad POS menu preview</h1><p>Isolated UI fixture — no production data or payments.</p><OwnerPosTabs active="pos"/><div style={{position:'fixed',top:180,left:20}}><button onClick={()=>setActive(true)}>Test idle warning</button><PortableDraftControls scope="ipad-qa" active={active} activity="qa" value={{amount:40}} label="$40 QA draft" reset={async()=>{setActive(false);window.qaReset=true}} restore={()=>true} idleMinutes={0.05} warningSeconds={30}/><p>Draft: {active?'$40':'empty'}</p></div><div style={{height:2000}}/></>};createRoot(document.getElementById('root')).render(<App/>);if(location.search.includes('auto=1'))setTimeout(()=>{document.querySelector('.owner-device-nav .owner-more-button').click();setTimeout(()=>{const p=document.querySelector('[data-owner-more-popover]'),l=p.querySelector('[data-role-more-items]');l.scrollTop=l.scrollHeight;const r=p.getBoundingClientRect();const proof={insideViewport:r.top>=visualViewport.offsetTop&&r.bottom<=visualViewport.offsetTop+visualViewport.height,listScrolled:l.scrollTop>0,pageDidNotScroll:scrollY===0,viewport:innerWidth+'x'+innerHeight};window.qaProof=proof;const pre=document.createElement('pre');pre.textContent=JSON.stringify(proof,null,2);pre.style='position:fixed;left:20px;top:50px;background:white;z-index:110';document.body.append(pre)},300)},1000);`;
const stubs = {
  language: `export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`,
  navigation: `import React from'react';const params=new URLSearchParams();export const useSearchParams=()=>params;export const usePathname=()=>React.useSyncExternalStore(f=>{window.addEventListener('qa-route',f);return()=>window.removeEventListener('qa-route',f)},()=>window.qaPath);`,
  link: `import React from'react';export const useLinkStatus=()=>({pending:false});export default React.forwardRef(function Link({href,onClick,onNavigate,children,...p},ref){return <a {...p} ref={ref} href={href} onClick={e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.go(href)}}}>{children}</a>});`,
  sync: `export const PortableSyncIndicator=()=>null;`,
  storage: `export const portableDeviceStorage={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)};`,
};
const result = await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'isolated-services',setup(b){
  for (const [filter,path] of [[/next\/navigation$/,'navigation'],[/^next\/link$|components\/feedback-link$/,'link'],[/components\/workspace-language$/,'language'],[/portable-sync-indicator$/,'sync'],[/lib\/portable-device-storage$/,'storage']]) b.onResolve({filter},()=>({path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:process.cwd()}));
}}]});
const utilities = await postcss([tailwind()]).process('@import "tailwindcss";', {from:process.cwd()+'/ipad-fixture.css'});
const css = utilities.css + result.outputFiles.find(f=>f.path.endsWith('.css')).text + ':root{--border-subtle:#ddd;--surface-elevated:white;--text-primary:#222;--brand-orange:#f76d35;--brand-orange-soft:#fff0e8}body{margin:0;background:#fff;font-family:Arial}';
writeFileSync(out+'/index.html',`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${result.outputFiles.find(f=>f.path.endsWith('.js')).text.replaceAll('</script','<\\/script')}</script>`);
if(process.argv.includes('--generate-only')) process.exit(0);
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync(out+'/index.html'))}).listen(process.argv.includes('--serve')?4876:4877,'0.0.0.0');
if(process.argv.includes('--serve')) { console.log('Fixture http://0.0.0.0:4876'); await new Promise(()=>{}); }
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[];
try {
  for(const [width,height] of [[1194,834],[834,1194],[1376,1032],[1032,1376],[393,852]]){
    const page=await browser.newPage({viewport:{width,height},userAgent:width<700?'iPhone':'iPad'});
    await page.goto('http://localhost:4877');
    const trigger=page.locator('.owner-device-nav .owner-more-button');await trigger.click();
    const panel=page.locator('[data-owner-more-popover]');await panel.waitFor();
    const before=await panel.evaluate(p=>{const r=p.getBoundingClientRect(),l=p.querySelector('[data-role-more-items]');return {top:r.top,bottom:r.bottom,height:r.height,listHeight:l.clientHeight,overflow:l.scrollHeight>l.clientHeight}});
    assert(before.top>=0 && before.bottom<=height && before.listHeight>=100 && before.overflow,JSON.stringify(before));
    const list=panel.locator('[data-role-more-items]');await list.evaluate(l=>l.scrollTop=l.scrollHeight);
    assert(await list.evaluate(l=>l.scrollTop>0));
    assert.equal(await page.evaluate(()=>scrollY),0);
    await page.keyboard.press('Escape');await panel.waitFor({state:'detached'});
    await trigger.click();await page.locator('h1').click();await panel.waitFor({state:'detached'});
    await trigger.click();await page.setViewportSize({width:height,height:width});
    await page.waitForFunction(()=>document.querySelector("[data-owner-more-popover]")?.getBoundingClientRect().bottom<=innerHeight);
    await panel.getByRole('link',{name:'All',exact:true}).click();await panel.waitFor({state:'detached'});
    await page.getByRole('button',{name:'Test idle warning',exact:true}).click();await page.getByRole('dialog',{name:'Unfinished ticket'}).waitFor();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.getByRole('dialog',{name:'Unfinished ticket'}).count(),0);
    assert.equal(await page.evaluate(()=>!!window.qaReset),false);
    checks.push({viewportWidth:width,viewportHeight:height,...before,continuePreservedDraft:true});await page.close();
  }
  writeFileSync(out+'/chromium.json',JSON.stringify(checks,null,2));console.log('Passed: '+checks.length+' viewport cases, scrolling, dismissal, rotation, navigation, Continue preserves draft.');
} finally {await browser.close();server.close();}
