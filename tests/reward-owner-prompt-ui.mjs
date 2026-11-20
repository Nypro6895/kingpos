import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const output=process.env.REWARD_OWNER_UI_OUTPUT||'artifacts/reward-experience-redesign/owner-browser';
fs.mkdirSync(output,{recursive:true});
const bundle=await build({entryPoints:['tests/helpers/reward-owner-prompt-ui.tsx'],bundle:true,write:false,outdir:'bundle',platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'next-adapters',setup(b){
 b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'adapter'}));
 b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'adapter'}));
 b.onResolve({filter:/^@\/components\/experience-scope$/},()=>({path:'scope',namespace:'adapter'}));
 b.onLoad({filter:/.*/,namespace:'adapter'},args=>({contents:args.path==='link'?'import React from "react";export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}':args.path==='image'?'import React from "react";export default function Image({unoptimized,priority,fill,...props}){return <img {...props}/>}':'export function useExperienceScope(){return null}',loader:'jsx',resolveDir:process.cwd()}));
}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const salonId='00000000-0000-4000-8000-000000000001';
const preview={id:salonId,name:'King Nails Spa',city:'Milwaukee',state:'WI',distanceMiles:null,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:0,conversionPoints:30,version:0,offers:[],canBook:true,coverImageUrl:'/salon-public-cover.webp',coverImageSource:'salon',serviceCategories:['Nails']};
let scenario='off';const calls=[];
function summary(){
 const base={salonId,enabled:false,nearby:false,discoverable:false,reasons:[],periodStart:'2026-10-04',periodEnd:'2026-11-02',discountCents:0,members:0,paidConversions:0,rewardUses:0,preview};
 if(scenario==='on')return{...base,enabled:true,nearby:true,discoverable:true};
 if(scenario==='hidden')return{...base,enabled:true,reasons:['Local discovery is hidden.']};
 if(scenario==='profile')return{...base,enabled:true,nearby:true,reasons:['Publish your salon profile before advertising public rewards.']};
 if(scenario==='location')return{...base,enabled:true,nearby:true,reasons:['Add an accurate salon city/state or map location.']};
 if(scenario==='activity')return{...base,members:2,paidConversions:1,rewardUses:3,discountCents:1500};
 if(scenario==='missing-preview')return{...base,preview:null};
 if(scenario==='broken-preview')return{...base,preview:{...preview,coverImageUrl:'/broken-public-cover.webp'}};
 return base;
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');calls.push({method:req.method,path:url.pathname});
 if(url.pathname==='/bundle.js'){res.setHeader('content-type','text/javascript');return res.end(js);}
 if(url.pathname==='/bundle.css'){res.setHeader('content-type','text/css');return res.end(css);}
 if(url.pathname==='/salon-public-cover.webp'||url.pathname==='/images/rewards/nail-care-rewards-v1.webp'){res.setHeader('content-type','image/webp');return res.end(fs.readFileSync('public/images/rewards/nail-care-rewards-v1.webp'));}
 if(url.pathname==='/api/rewards/owner-discovery'){res.setHeader('content-type','application/json');if(scenario==='failure'){res.statusCode=503;return res.end('{}');}return res.end(JSON.stringify(summary()));}
 if(url.pathname!=='/'){res.statusCode=404;return res.end();}
 scenario=url.searchParams.get('scenario')||'off';res.setHeader('content-type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>button{font:inherit;border:0;background:transparent}a{text-decoration:none}</style><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'?scenario=off');const activate=page.getByRole('link',{name:'Preview & set up rewards',exact:true});await activate.waitFor();assert.equal(await activate.getAttribute('href'),'/reward-system');assert.equal(await page.getByRole('button',{name:'Activate local rewards'}).count(),0);assert.match(await page.getByRole('region',{name:'Grow with rewards'}).innerText(),/Earning stays off until you confirm/);
 await page.locator('img').first().evaluate(image=>image.decode());await page.screenshot({path:path.join(output,'owner-off-mobile.png'),fullPage:true});
 await page.getByText('Customer post preview',{exact:true}).click();const post=page.getByRole('article',{name:'Customer reward post preview'});await post.waitFor();await post.getByText('King Nails Spa',{exact:true}).waitFor();await post.getByText('Milwaukee, WI',{exact:true}).waitFor();assert.equal(await post.locator('img').getAttribute('src'),'/salon-public-cover.webp');assert.equal(await post.getByText('Illustration',{exact:true}).count(),0);assert.equal(await post.getByText('Book a visit',{exact:true}).getAttribute('aria-disabled'),'true');assert.equal(await post.locator('a,button').count(),0);assert.equal(await page.getByRole('button',{name:'Service spend'}).count(),0);await page.screenshot({path:path.join(output,'owner-customer-preview-mobile.png'),fullPage:true});
 await page.setViewportSize({width:320,height:568});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Later',exact:true}).click();assert.equal(await activate.count(),0);const until=await page.evaluate(id=>Number(localStorage.getItem('reward-owner-prompt:'+id)),salonId);assert.ok(until-Date.now()>6.99*86400000&&until-Date.now()<=7*86400000);await page.reload();await page.getByText('Today workspace remains available.').waitFor();assert.equal(await activate.count(),0);
 await page.goto(origin+'?scenario=on');await page.getByRole('region',{name:'Reward visibility',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Manage',exact:true}).getAttribute('href'),'/reward-system');assert.equal(await page.getByText('New members',{exact:true}).count(),0);await page.screenshot({path:path.join(output,'owner-visible-mobile.png'),fullPage:true});
 for(const[state,label,href]of[['hidden','Review rewards','/reward-system'],['profile','Review profile','/salon-profile'],['location','Add location','/salon-settings']]){await page.goto(origin+'?scenario='+state);await page.getByRole('region',{name:'Reward visibility needs attention'}).waitFor();assert.equal(await page.getByRole('link',{name:label,exact:true}).getAttribute('href'),href);}
 await page.screenshot({path:path.join(output,'owner-location-required-mobile.png'),fullPage:true});
 await page.goto(origin+'?scenario=activity&setup=1');const activity=page.getByRole('region',{name:'Reward program activity',exact:true});await activity.getByText('New members',{exact:true}).waitFor();assert.match(await activity.innerText(),/Program activity across all channels/);assert.match(await activity.innerText(),/\$15.00/);assert.doesNotMatch(await activity.innerText(),/ROI|revenue|from Explore/);assert.equal(await activity.locator('a,button,details').count(),0);await page.screenshot({path:path.join(output,'owner-program-activity-mobile.png'),fullPage:true});
 await page.goto(origin+'?scenario=off&setup=1');await page.getByText('No program activity in this period yet. Results appear after customers participate.').waitFor();
 await page.evaluate(id=>localStorage.setItem('reward-owner-prompt:'+id,String(Date.now()-1)),salonId);await page.goto(origin+'?scenario=missing-preview');await activate.waitFor();assert.equal(await page.getByText('Customer post preview',{exact:true}).count(),0);
 await page.goto(origin+'?scenario=off');await activate.waitFor();scenario='on';await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByRole('heading',{name:'Rewards are visible in Explore',exact:true}).waitFor();assert.equal(await activate.count(),0);
 await page.goto(origin+'?scenario=broken-preview');await activate.waitFor();await page.getByText('Customer post preview',{exact:true}).click();await post.getByText('Illustration',{exact:true}).waitFor();assert.equal(await post.getByText('Illustration',{exact:true}).count(),1);assert.equal(await post.locator('img').getAttribute('src'),'/images/rewards/nail-care-rewards-v1.webp');await page.screenshot({path:path.join(output,'owner-fallback-illustration-mobile.png'),fullPage:true});
 await page.goto(origin+'?scenario=failure');await page.getByText('Today workspace remains available.').waitFor();assert.equal(await activate.count(),0);assert.deepEqual(errors,[]);assert.equal(calls.every(call=>call.method==='GET'),true);
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,checks:['off invite uses public salon image and review CTA','new-customer preview with inert booking affordance','7-day dismissal and expiration','visible status remains visible after dismissal','blocked publication/location actions','truthful program-wide activity and empty state','preview unavailable does not invent a post','refresh after activation','320px overflow','no write requests','visible Illustration label follows actual fallback media'],runtimeErrors:errors},null,2));
 console.log('Owner prompt UI acceptance passed: 11 behavior groups, no write requests, no runtime errors.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
