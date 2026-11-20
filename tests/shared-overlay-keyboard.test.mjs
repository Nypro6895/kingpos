import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
import test from 'node:test';
import assert from 'node:assert/strict';

test('shared Gift and workspace overlays keep drafts and actions reachable without changing normal controls',{timeout:60000},async()=>{
const out='artifacts/layout-hardening-20261119/shared-regression';fs.mkdirSync(out,{recursive:true});
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';
import{CustomerGiftDialog}from'./components/gift-card/customer-gift-dialog';
import{AuthIntentPrompt}from'./components/auth-intent-prompt';import{ActionDialog}from'./app/action-dialog';
import{VisitRewards}from'./components/rewardlumi/visit-rewards';
import{ExploreAccountActionsProvider}from'./components/explore-account-actions';
import{QuickWorkspacePanel}from'./app/quick-workspace-panel';
import{installMobileViewport}from'./lib/mobile-viewport';
const viewport=new EventTarget();Object.assign(viewport,{height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
window.fit=(height,offsetTop=0)=>{Object.assign(viewport,{height,offsetTop});viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));};
window.calls=[];const root=createRoot(document.getElementById('root'));const close=()=>window.calls.push('close');
const rewardTransport=async()=>({view:{enabled:true,available:200,reserved:0,pending:0,offers:[{id:'offer1',title:'Manicure reward',points:100,minimumCents:2500}],request:null}});
const showBase=kind=>kind==='rewards'?<VisitRewards scope="display" presentation="checkout" transport={rewardTransport}/>:kind==='gift-use'||kind==='gift-buy'?<CustomerGiftDialog session={{id:'fixture',revision:1,mode:kind==='gift-use'?'use':'buy',entry:'code',status:'open',amount:0,total:10000,purchase:0,card:null,approved:false,qrVisible:true,mobile:'fixture',expires:'2099-01-01T00:00:00Z'}} action={async(...args)=>window.calls.push(args)} onClose={close}/>:kind==='auth'?<AuthIntentPrompt kicker="Reylumi" title="Save your favorites" onClose={close}><p>Create an account to save your favorites and continue your salon journey.</p></AuthIntentPrompt>:<ActionDialog open title="Leave ownership of King Nails?" description="Your Owner access to this salon will be removed. The remaining Owner will continue managing the salon. Your personal account and salon records will be kept." primaryAction={{label:'Leave ownership'}} secondaryAction={{label:'Cancel'}} onClose={close}/>;
window.show=(kind)=>root.render(kind==='contact'?<ExploreAccountActionsProvider authenticated={false}><button onClick={()=>window.dispatchEvent(new CustomEvent('reylumi:contact-salon',{detail:{href:null,name:'King Nails',phoneHref:'tel:+14145550100',contactHref:'mailto:salon@example.test'}}))}>Open contact</button></ExploreAccountActionsProvider>:kind==='workspace'?<QuickWorkspacePanel accountLabel="Alex" currentWorkspace={null} workspaceOptions={[]} notificationSummary={{total:0,items:[],reviewHref:'/notifications'}} isOpen onClose={close} returnFocusRef={{current:null}}/>:showBase(kind));
installMobileViewport();window.show('auth');`;
const built=await build({stdin:{contents:fixture,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'offline',setup(b){
const mocks={'next/link':`import React from'react';export default({prefetch,...p})=><a {...p}/>;export const useLinkStatus=()=>({pending:false});`, 'next/navigation':`export const usePathname=()=>'/settings';export const useRouter=()=>({refresh(){},push(){}});export const useSearchParams=()=>new URLSearchParams();`, '@/components/workspace-language':`import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='span',...p})=>React.createElement(as,p);export const useWorkspaceTranslation=()=>x=>x;`, '@/components/reylumi-icons':`export const ReylumiIcon=()=>null;`, '@/app/explore/account-actions':`export const salonLoveAction=()=>{throw Error('No mutations in audit')};export const referenceLoveAction=salonLoveAction;`, '@/app/saved-post/actions':`export const setAccountSavedPostAction=()=>{throw Error('No mutations in audit')};`, '@/lib/workspace-navigation':`export const navigateToWorkspace=()=>{throw Error('No workspace navigation in audit')};`};
b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'offline'}:undefined);b.onLoad({filter:/.*/,namespace:'offline'},a=>({loader:'tsx',contents:mocks[a.path],resolveDir:process.cwd()}));
}}]});
const css=(await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css+'\n'+fs.readFileSync('components/gift-card/gift-card.css','utf8')+'\n'+fs.readFileSync('components/iphone-glass-nav.css','utf8')+'\n'+built.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{for(const [width,height]of[[390,844],[844,390],[320,568],[820,1180]]){
const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://audit.test'){requests.push(u.href);return route.abort();}return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font-family:Arial}</style><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script>`});});
await page.goto('http://audit.test/');
for(const kind of['auth','action','gift-use','gift-buy','rewards','contact','workspace']){
await page.evaluate(kind=>window.show(kind),kind);
if(kind==='rewards')await page.getByRole('button',{name:'Use points',exact:true}).first().click();
if(kind==='contact')await page.getByRole('button',{name:'Open contact',exact:true}).click();
await page.getByRole('dialog').first().waitFor();
const fields=kind==='workspace'?'input[placeholder="Search salons and workspaces"]':kind==='gift-use'?'input[aria-label="Security PIN"]':kind==='gift-buy'?'input[aria-label="Gift card amount"]':null;
const action=kind==='workspace'?page.getByRole('link',{name:'View full My Place',exact:true}):kind==='contact'?page.getByRole('link',{name:'Call salon',exact:true}):kind==='rewards'?page.getByRole('button',{name:'Use 100 points',exact:true}):kind==='gift-use'?page.getByRole('button',{name:'Check & apply',exact:true}):kind==='gift-buy'?page.getByRole('button',{name:/Add .* to purchase/}):kind==='auth'?page.getByRole('link',{name:'Create account',exact:true}):page.getByRole('button',{name:'Leave ownership',exact:true});
const sample=async(label)=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const metrics=await action.evaluate(el=>{const r=el.getBoundingClientRect(),v=visualViewport,hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{box:r.toJSON(),visibleTop:v.offsetTop,visibleBottom:v.offsetTop+v.height,hit:hit?.tagName,receivesClick:el===hit||el.contains(hit),insideVisual:r.top>=v.offsetTop&&r.bottom<=v.offsetTop+v.height,innerHeight,scrollY,dialog:[...document.querySelectorAll('dialog[open],[role="dialog"]')].map(e=>({tag:e.tagName,box:e.getBoundingClientRect().toJSON(),scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}))}});assert.ok(metrics.insideVisual&&metrics.receivesClick,JSON.stringify({kind,width,height,label,metrics}));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await action.click({trial:true});results.push({kind,width,height,label,metrics,errors:[...errors],requests:[...requests]});await page.screenshot({path:`${out}/${kind}-${width}x${height}-${label}.png`});return metrics;};

if(kind==='gift-use'){await page.getByLabel('Card code',{exact:true}).fill('1234567890ABCDEF');await page.getByLabel('Security PIN',{exact:true}).fill('12345678');}
if(kind==='gift-buy')await page.getByLabel('Gift card amount',{exact:true}).fill('125');
if(kind==='workspace')await page.locator(fields).fill('Unsaved salon search');
await action.scrollIntoViewIfNeeded();await sample('normal');
if(fields&&width===390){const draft=await page.locator(fields).inputValue();const root=kind==='workspace'?page.getByRole('dialog'):page.locator('.gc-modal-layer');const before=await root.boundingBox();const pageScroll=await page.evaluate(()=>scrollY);await page.locator(fields).focus();for(const offset of[0,60]){await page.evaluate(o=>window.fit(360,o),offset);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const field=await page.locator(fields).boundingBox();assert.ok(field.y>=offset-1&&field.y+field.height<=360+offset+1,JSON.stringify({kind,field,offset}));assert.equal(await page.locator(fields).inputValue(),draft);await action.scrollIntoViewIfNeeded();await action.evaluate(el=>{for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){if(/auto|scroll/.test(getComputedStyle(p).overflowY))p.scrollTop=p.scrollHeight;}});await sample('keyboard-pan'+offset);}await page.evaluate(()=>window.fit(844));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const restored=await root.boundingBox();assert.ok(Math.abs(restored.y-before.y)<1&&Math.abs(restored.height-before.height)<1,JSON.stringify({kind,before,restored}));assert.equal(await page.locator(fields).inputValue(),draft);assert.equal(await page.evaluate(()=>scrollY),pageScroll);}
}
assert.deepEqual(await page.evaluate(()=>window.calls),[],'trial clicks must not invoke any real action');await page.close();
}}finally{await browser.close();}
fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify({states:results.length,allActionsReachable:results.every(r=>r.metrics.insideVisual&&r.metrics.receivesClick)}));

});
