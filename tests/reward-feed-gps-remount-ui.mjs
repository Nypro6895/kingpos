import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const output=process.env.REWARD_GPS_OUTPUT||'artifacts/reward-experience-v4/gps-remount';fs.mkdirSync(output,{recursive:true});
await build({entryPoints:['tests/helpers/reward-feed-gps-remount.tsx'],bundle:true,format:'esm',jsx:'automatic',outfile:path.join(output,'gps.js'),plugins:[{name:'fixture-adapters',setup(b){
 b.onResolve({filter:/^next\/(?:link|image)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onResolve({filter:/^@\/components\/(?:experience-scope|explore-social)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'jsx',resolveDir:process.cwd(),contents:args.path.endsWith('/link')?'import React from "react";export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}':args.path.endsWith('/image')?'import React from "react";export default function Image({unoptimized,priority,fill,...props}){return <img {...props}/>}':args.path.endsWith('experience-scope')?'export function useExperienceScope(){return null}':'const states={};export function useExploreSocial(){return {states}};export function useSalonSocial(){return {}}'}));
}}]});
const id='00000000-0000-4000-8000-000000000001';
const salon={id,name:'Fixture salon',city:'Chicago',state:'IL',distanceMiles:null,spendCents:2000,spendPoints:20,welcomePoints:0,firstBookingPoints:0,visitPoints:0,conversionPoints:0,version:1,canBook:false,coverImageSource:'illustration',serviceCategories:['Nails'],offers:[{id:'five',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
const calls=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/gps.js'||url.pathname==='/gps.css'){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');return res.end(fs.readFileSync(path.join(output,url.pathname.slice(1))));}
 if(url.pathname==='/images/rewards/nail-care-rewards-v1.webp'){res.setHeader('Content-Type','image/webp');return res.end(fs.readFileSync('public/images/rewards/nail-care-rewards-v1.webp'));}
 if(url.pathname.startsWith('/api/rewards/')){calls.push(url.pathname+url.search);res.setHeader('Content-Type','application/json');const scenario=new URL(req.headers.referer||'http://fixture').searchParams;if(url.pathname.endsWith('/discover')&&scenario.has('error')){res.statusCode=503;return res.end('{}');}return res.end(JSON.stringify(url.pathname.endsWith('/discover')?{salons:scenario.has('empty')?[]:[{...salon,distanceMiles:url.searchParams.has('lat')?0:null}],hasMore:false}:{salon,joined:false,available:null,authenticated:false,earningEligibility:{spend:true,visit:false,welcome:false,firstBooking:false,beforeAfter:false}}));}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/gps.css"><style>*{box-sizing:border-box}body{margin:0;font:14px Arial}main{max-width:664px;margin:auto;padding:16px}.grid{display:grid;gap:40px}[data-fresh]{height:700px;background:#f8f4ef;padding:16px}[data-tail]{height:1200px;background:#fafafa}button{font:inherit}img{max-width:100%}a{color:inherit;text-decoration:none}</style></head><body><div id="root"></div><script type="module" src="/gps.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-reward-discovery]').waitFor();
 await page.evaluate(()=>scrollTo(0,450));
 const before=calls.length;
 await page.locator('#choose-gps').evaluate(button=>button.click());
 const immediate=await page.evaluate(()=>({scrollY,slots:[...document.querySelectorAll('section[class*="pendingSlot"]')].map(el=>({rect:el.getBoundingClientRect().toJSON(),position:getComputedStyle(el).position}))}));
 await page.locator('[data-reward-discovery]').waitFor({timeout:3000});
 assert.ok(calls.slice(before).some(url=>url.includes('lat=41.88')),'GPS remount must load without requiring a scroll back to the top');
 await page.locator('[data-reward-discovery]').getByText(/0 mi.*Chicago, IL/).waitFor();
 assert.deepEqual(pageErrors,[]);await page.screenshot({path:path.join(output,'after-gps.png')});
 for(const scenario of['empty','error']){await page.goto(`http://127.0.0.1:${server.address().port}/?${scenario}=1`);await page.waitForLoadState('networkidle');await page.waitForFunction(()=>!document.querySelector('section[class*="pendingSlot"]'));assert.equal(await page.locator('[data-reward-discovery]').count(),0);const gap=await page.evaluate(()=>document.querySelector('[data-tail]').getBoundingClientRect().top-document.querySelector('[data-fresh]').getBoundingClientRect().bottom);assert.equal(gap,40,'settled empty/error result keeps only the original organic grid gap');}
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,immediate,calls,pageErrors,checks:['GPS remount while already scrolled loads at the actual feed position','empty/error leave no residual sentinel or extra grid gap']},null,2));console.log('PASS GPS remount while already scrolled and no residual empty/error grid slot.');
}catch(error){const dom=await page.evaluate(()=>({scrollY,slots:[...document.querySelectorAll('section[class*="pendingSlot"]')].map(el=>({rect:el.getBoundingClientRect().toJSON(),position:getComputedStyle(el).position}))}));fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,dom,calls,pageErrors},null,2));await page.screenshot({path:path.join(output,'failure.png')});throw error;
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
