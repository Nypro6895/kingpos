import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('BookSMS settings lock unpaid salons and save active plugin controls on mobile and desktop', {timeout:90000},async()=>{
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {BookSmsPanel} from './app/market/booksms-panel';
 import {MessagingInventory} from './app/(app)/admin/settings/twilio/messaging-inventory';
 import {TwilioSettingsForm} from './app/(app)/admin/settings/twilio/settings-form';
 const active=new URLSearchParams(location.search).has('active'),admin=new URLSearchParams(location.search).has('admin');
 const state={active,installed:active,paidUntil:null,enabled:false,confirmation:true,reminders:false,accountSid:'AC'+'a'.repeat(32),messagingServiceSid:'MG'+'b'.repeat(32),from:'',tokenConfigured:true,monthlyLimit:100};
 const settings={...state,verifyServiceSid:'VA'+'c'.repeat(32),claimSms:true,claimVoice:false,authSms:true,loginAlerts:true,salonVerification:true};
 createRoot(document.getElementById('root')).render(admin?<><h1>Messaging & OTP</h1><MessagingInventory settings={settings}/><TwilioSettingsForm settings={settings}/></>:<BookSmsPanel initial={state}/>);
 `},bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'fixture-actions',setup(b){
 b.onResolve({filter:/booksms-actions$|\.\/actions$/},args=>({path:args.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path.includes('booksms')?`export async function saveBookSms(form){window.saved=Object.fromEntries(form);return {message:'BookSMS settings saved.'}}`:`export async function saveTwilioSettingsAction(previous,form){window.saved=Object.fromEntries(form);return {ok:true,message:'Saved.'}}`}));
 }}]});
 const js=result.outputFiles[0].text;
 const css=fs.existsSync('.next/static/css')?fs.readdirSync('.next/static/css').filter(file=>file.endsWith('.css')).map(file=>fs.readFileSync('.next/static/css/'+file,'utf8')).join('\n'):'';
 const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url.startsWith('/bundle')?'application/javascript':'text/html');response.end(request.url.startsWith('/bundle')?js:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:20px;background:#fafafa;font-family:Arial}#root{max-width:1100px;margin:auto}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const out='artifacts/booksms-qa';fs.mkdirSync(out,{recursive:true});
 try {
  for(const width of [390,1280]) {
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const base=`http://127.0.0.1:${server.address().port}`;
   await page.goto(base);
   assert.equal(await page.getByRole('button',{name:'Save BookSMS settings'}).isDisabled(),true);
   await page.goto(base+'?active');
   await page.getByLabel('Enable booking SMS delivery').check();
   await page.getByLabel('Appointment reminders within 24 hours').check();
   await page.getByRole('button',{name:'Save BookSMS settings'}).click();
   await page.getByRole('status').filter({hasText:'BookSMS settings saved.'}).waitFor();
   assert.equal((await page.evaluate(()=>window.saved)).reminders,'on');
   await page.screenshot({path:`${out}/plugin-${width}.png`,fullPage:true});
   await page.goto(base+'?admin');
   await page.getByRole('heading',{name:'System function inventory'}).waitFor();
   assert.equal(await page.getByRole('checkbox',{name:'Personal phone verification & SMS two-factor authentication'}).isChecked(),true);
   await page.screenshot({path:`${out}/admin-${width}.png`,fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
   assert.deepEqual(errors,[]);await page.close();
  }
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
