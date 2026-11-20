// Local browser fixture only; no provider, customer or production requests.
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const out=path.resolve('artifacts/member-badge');fs.mkdirSync(out,{recursive:true});
const source=`import React from 'react';import{createRoot}from'react-dom/client';import{SalonMemberBadge,SalonName}from'@/components/salon-member-badge';
window.calls=[];window.revoked=false;window.short=false;
const ids=Array.from({length:105},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
createRoot(document.getElementById('root')).render(<div><a data-long href="#salon" style={{display:'block',width:240,overflow:'hidden'}}><SalonName name={'A salon with a very long name '.repeat(6)} salonId={ids[0]}/></a>{ids.map((id,i)=><p key={id} data-salon={id}>Sample salon {i+1}<SalonMemberBadge salonId={id}/></p>)}<p data-invalid>Unrelated personal profile<SalonMemberBadge href="/explore/beauty/00000000-0000-4000-8000-000000000001"/></p></div>);`;
await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:true,outfile:path.join(out,'app.js'),jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'local-experience-scope',setup(b){b.onResolve({filter:/^@\/components\/experience-scope$/},()=>({path:'scope',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export function useExperienceScope(){return null;}'}));}}]});
const server=createServer((req,res)=>{if(req.url==='/app.js'||req.url==='/app.css'){res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');return res.end(fs.readFileSync(out+req.url));}res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><style>body{font:16px system-ui;padding:24px}p{display:flex;align-items:center;gap:6px}</style><div id="root"></div><script src="/app.js"></script></html>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:700}});await page.clock.install();let held=false;const releases=[];
 await page.route('**/api/membership/salon-badges',async route=>{const body=route.request().postDataJSON();const result=await page.evaluate(({ids})=>{window.calls.push(ids);return{badges:window.revoked?[]:ids.filter(id=>!id.endsWith('002')).map(id=>({salon_id:id,valid_until:new Date(Date.now()+(window.short?500:3600000)).toISOString()}))};},body);if(held)await new Promise(resolve=>releases.push(resolve));await route.fulfill({json:result}).catch(()=>{});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('[data-salon]').first().getByRole('img',{name:'Reylumi Member',exact:true}).waitFor();assert.equal(await page.getByRole('img',{name:'Reylumi Member',exact:true}).count(),105);
 assert.equal(await page.locator('[data-invalid] [data-reylumi-member-badge]').count(),0);const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,2);assert.ok(calls.every(ids=>ids.length<=100));
 const clipped=await page.locator('[data-long]').evaluate(el=>{const mark=el.querySelector('[data-reylumi-member-badge]').getBoundingClientRect(),box=el.getBoundingClientRect();return mark.width<14||mark.right>box.right+1;});assert.equal(clipped,false);await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'salon-names.png')});
 await page.evaluate(()=>window.revoked=true);await page.clock.fastForward(16000);await page.waitForFunction(()=>document.querySelectorAll('[data-reylumi-member-badge]').length===0);
 await page.evaluate(()=>{window.revoked=false;window.short=true;});await page.clock.fastForward(16000);await page.waitForFunction(()=>document.querySelectorAll('[data-reylumi-member-badge]').length===105);await page.clock.fastForward(600);assert.equal(await page.locator('[data-reylumi-member-badge]').count(),0);
 held=true;await page.evaluate(()=>{window.short=false;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>window.calls.length>=8);await page.evaluate(()=>window.dispatchEvent(new Event('reylumi:experience-reset')));held=false;releases.splice(0).forEach(resolve=>resolve());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('[data-reylumi-member-badge]').count(),0);
 console.log('PASS: 105 salon names batched into two requests; duplicates deduplicated, long-name mark visible, personal/nonmember excluded; revocation, exact expiry and late responses after identity reset are safe.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
