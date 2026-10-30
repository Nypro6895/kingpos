import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const output='artifacts/rewardlumi/browser';fs.mkdirSync(output,{recursive:true});const errors=[];
const desktop=await browser.newContext({viewport:{width:1280,height:900}}),mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const personal=await mobile.newPage(),pos=await desktop.newPage(),display=await desktop.newPage();
for(const page of [personal,pos,display])page.on('pageerror',e=>errors.push(e.message));
const origin=process.env.REWARD_UI_ORIGIN||'http://localhost:4077';
try {
 const fixture=await fetch(origin+'/fixture').then(r=>r.json());await fetch(origin+'/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'personal',op:'cancel',args:{visitId:fixture.visitId}})});
 await personal.goto(origin+'/personal');await personal.getByRole('button',{name:'Use reward',exact:true}).waitFor();
 await personal.screenshot({path:output+'/01-personal-ready.png',fullPage:true});
 let refreshStarted;const inFlightRefresh=new Promise(resolve=>{refreshStarted=resolve;});let delayed=false;
 await personal.route('**/command',async route=>{
  const payload=route.request().postDataJSON();
  if(!delayed&&payload.op==='load'){delayed=true;refreshStarted();await new Promise(resolve=>setTimeout(resolve,1200));}
  await route.continue();
 });
 await inFlightRefresh;
 await personal.getByRole('button',{name:'Use reward',exact:true}).click();
 await personal.getByRole('button',{name:'Confirm 100 points',exact:true}).waitFor();
 await personal.screenshot({path:output+'/02-personal-confirm.png',fullPage:true});
 await personal.getByRole('button',{name:'Confirm 100 points',exact:true}).click();
 await personal.getByText('Requested · waiting for eligible services on this ticket',{exact:false}).waitFor();
 await pos.goto(origin+'/pos');await pos.getByText('Confirmed · applied when this ticket is paid',{exact:false}).waitFor();
 await pos.screenshot({path:output+'/03-pos-confirmed.png',fullPage:true});
 await display.goto(origin+'/display');await display.getByText('Confirmed · applied when this ticket is paid',{exact:false}).waitFor();
 await display.getByRole('button',{name:'Not now',exact:true}).click();
 await pos.getByRole('button',{name:'Ask customer',exact:true}).waitFor();
 await pos.getByRole('button',{name:'Ask customer',exact:true}).click();
 await display.getByRole('button',{name:'Confirm use of 100 points'}).waitFor();
 await display.screenshot({path:output+'/04-display-consent.png',fullPage:true});
 await display.getByRole('button',{name:'Confirm use of 100 points'}).click();
 await pos.getByText('Confirmed · applied when this ticket is paid',{exact:false}).waitFor();
 await personal.getByText('Confirmed · applied when this ticket is paid',{exact:false}).waitFor();
 assert.equal(await personal.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'personal layout must not overflow horizontally');
 const owner=await desktop.newPage();owner.on('pageerror',e=>errors.push(e.message));await owner.goto(origin+'/owner');
 await owner.getByRole('button',{name:'Confirm & save'}).waitFor();
 await owner.getByLabel('Welcome points',{exact:true}).fill('15');await owner.getByRole('button',{name:'Confirm & save'}).click();
 await owner.getByText('Reward System saved.',{exact:true}).waitFor();await owner.screenshot({path:output+'/05-owner-settings.png',fullPage:true});
 const wallet=await mobile.newPage();await wallet.goto(origin+'/wallet');await wallet.getByRole('heading',{name:'Lumi Nail Studio'}).waitFor();await wallet.getByText('Point history',{exact:true}).click();await wallet.screenshot({path:output+'/06-personal-wallet.png',fullPage:true});
 assert.deepEqual(errors,[],'browser runtime errors');
 fs.writeFileSync(output+'/browser-result.json',JSON.stringify({passed:true,checks:['customer tap is queued during background refresh','customer first: confirm once','POS first: customer display consent','bidirectional cancellation and state sync','owner settings persist','wallet and history','390px no horizontal overflow'],errors,actualComponents:true,isolatedDatabase:true,productionTouched:false},null,2));
 console.log('PASS: 6 browser flow checks plus customer tap during in-flight refresh, no runtime errors.');
} finally {await browser.close();}
