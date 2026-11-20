import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const dir=path.resolve('artifacts/reward-experience/customer-ui');fs.mkdirSync(dir,{recursive:true});
await build({entryPoints:['tests/helpers/reward-wallet-ui.tsx'],bundle:true,format:'esm',target:'es2022',jsx:'automatic',outfile:path.join(dir,'wallet.js'),plugins:[{name:'isolated-ui-dependencies',setup(b){
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/experience-scope$/},()=>({path:'scope',namespace:'fixture'}));
 b.onResolve({filter:/reward-owner-setup$/},()=>({path:'owner',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',resolveDir:process.cwd(),contents:args.path==='link'?'import React from "react"; export default function Link({children,...props}){return React.createElement("a",props,children)}':args.path==='scope'?'export function useExperienceScope(){return null}':'export function RewardOwnerSetup(){return null}'}));
}}]});
const server=http.createServer((req,res)=>{
 if(['/wallet.js','/wallet.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(dir,req.url.slice(1))));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wallet.css"><style>*{box-sizing:border-box}body{margin:0;background:#fff;font:14px Arial,sans-serif;--brand-orange:#ee793f;--brand-orange-soft:#fff1e9;--brand-teal:#287f83;--text-primary:#353432;--text-secondary:#706963;--surface:#fff;--border-subtle:#e8e2dc}a{color:inherit;text-decoration:none}button{border:0;background:none;font:inherit;padding:0;cursor:pointer}.beauty-home{padding:16px;max-width:520px;margin:auto}.beauty-home p,.beauty-home h2{margin:0;font-weight:400}</style></head><body><div id="root"></div><script type="module" src="/wallet.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
const old={salonId:'old',salonName:'Older salon',joinedAt:'2026-10-01T00:00:00Z',enabled:true,available:999,pending:0,reserved:0,offers:[{id:'five',title:'$5 off',points:100,valueCents:500,minimumCents:4000}],request:null};
const newest={...old,salonId:'new',salonName:'Newest salon',joinedAt:'2026-11-03T00:00:00Z',available:0,pending:30,reserved:0};
const checks=[];
async function open(route){await page.goto(origin+route);await page.waitForFunction(()=>window.walletQA?.pending.length===1);}
async function resolve(index,cards){await page.evaluate(({index,cards})=>window.walletQA.resolve(index,{cards}),{index,cards});}
try{
 await open('/beauty');await resolve(0,[old,newest]);await page.getByText('Newest salon',{exact:true}).waitFor();
 assert.equal(await page.getByText('Older salon',{exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:/More/}).getAttribute('href'),'/rewards');
 assert.equal(await page.getByText('30 pending',{exact:true}).count(),1);
 const sizes=await page.locator('[data-beauty-rewards]').evaluate(el=>({points:parseFloat(getComputedStyle(el.querySelector('strong')).fontSize),salon:parseFloat(getComputedStyle(el.querySelector('a[aria-label] > div:nth-child(2) > span:nth-child(2)')).fontSize),height:el.getBoundingClientRect().height}));
 assert.ok(sizes.points>sizes.salon);assert.ok(sizes.height<180);await page.screenshot({path:path.join(dir,'beauty-latest.png')});checks.push('Beauty latest membership wins over larger older balance, pending shown, points-first compact summary');
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await page.evaluate(()=>window.walletQA.calls),1);checks.push('Fresh Beauty wallet does not refetch for repeated foreground events');
 await open('/wallet');await resolve(0,[old,newest]);await page.getByRole('heading',{name:'Newest salon',exact:true}).waitFor();
 assert.deepEqual(await page.locator('[data-reward-salon]').evaluateAll(els=>els.map(el=>el.dataset.rewardSalon)),['new','old']);
 const boxes=await page.locator('[data-reward-salon]').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,points:parseFloat(getComputedStyle(el.querySelector('strong')).fontSize),salon:parseFloat(getComputedStyle(el.querySelector('h2')).fontSize)})));
 assert.ok(boxes[1].top>boxes[0].bottom);assert.ok(boxes.every(b=>b.points>b.salon));
 await page.locator('[data-reward-salon="new"] > details > summary').click();assert.equal(await page.getByRole('link',{name:/Show My QR/}).getAttribute('href'),'/qr');
 await page.getByText('Point history',{exact:true}).first().click();await page.locator('[data-reward-salon="new"]').getByText('No point activity yet.',{exact:true}).waitFor();checks.push('Wallet vertical separate balances, points-first, details/history, safe My QR route');
 for(const width of[320,390,1024]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'wallet-expanded.png'),fullPage:true});
 await open('/beauty');await page.evaluate(()=>window.walletQA.reject(0));await page.getByText('Rewards are unavailable right now.',{exact:true}).waitFor();assert.equal(await page.getByText('points available',{exact:true}).count(),0);assert.equal(await page.getByText('Discover salon rewards',{exact:false}).count(),0);checks.push('Read failure is not represented as zero points or empty membership');
 await open('/beauty');await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));await resolve(0,[old]);await page.getByText(/Your account has changed/).waitFor();assert.equal(await page.getByText('Older salon',{exact:true}).count(),0);checks.push('Reset invalidates outstanding private read and removes private cards');
 await open('/beauty');await page.evaluate(()=>window.walletQA.switchActor('customer-b'));await page.waitForFunction(()=>window.walletQA.pending.length===2);await resolve(1,[{...newest,salonName:'Account B salon',available:7}]);await page.getByText('Account B salon',{exact:true}).waitFor();await resolve(0,[old]);assert.equal(await page.getByText('Older salon',{exact:true}).count(),0);assert.equal(await page.getByText('Account B salon',{exact:true}).count(),1);checks.push('Delayed account A reply cannot replace current account B wallet');
 await open('/beauty');await resolve(0,[]);await page.getByRole('link',{name:/Discover salon rewards/}).waitFor();checks.push('True empty wallet gives discovery entry without an invented point balance');
 await open('/beauty');await resolve(0,[{...old,joinedAt:undefined}]);await page.getByRole('link',{name:/View your salon rewards/}).waitFor();assert.equal(await page.getByText('Latest salon joined',{exact:true}).count(),0);checks.push('Legacy reply without joinedAt falls back to full wallet without guessing newest salon');
 await open('/wallet');await resolve(0,[{...newest,enabled:false,available:120,reserved:100}]);await page.getByText('New earning paused · your points are kept.',{exact:true}).waitFor();await page.getByText(/Enough points for/).waitFor();await page.locator('[data-reward-salon="new"] > details > summary').click();await page.getByRole('link',{name:/Show My QR/}).waitFor();checks.push('Paused earning preserves balance, held status, qualifying reward and QR access');
 await page.goto(origin+'/beauty');await page.waitForFunction(()=>window.walletQA);await page.evaluate(()=>window.walletQA.switchActor('guest'));await page.getByRole('link',{name:/Sign in to view rewards/}).waitFor();assert.equal(await page.getByText('points available',{exact:true}).count(),0);checks.push('Guest has account entry and no exposed private balance');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,checks,pageErrors:errors},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
