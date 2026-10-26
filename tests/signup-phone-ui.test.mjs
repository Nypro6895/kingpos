import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test('signup phone UI connects automatically, selects shared profiles and handles OTP retries on mobile/desktop',{
 skip:!process.env.TEST_BROWSER_PATH,timeout:120000,
},async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {SignupPhoneForm} from './app/signup/phone/signup-phone-form';import {SignupForm} from './app/signup/signup-form';
 window.calls=[];window.mode=new URL(location.href).searchParams.get('mode');
 const content=window.mode==='signup'?<SignupForm/>:<><h1 className="text-2xl font-extrabold">Bring your salon history with you</h1><p className="mt-3 text-sm">Verify the number you use at check-in. We’ll connect your past visits and receipts.</p><SignupPhoneForm initialPhone="+15035550100" initiallyVerified={window.mode==='verified'} nextPath="/activity"/></>;
 createRoot(document.getElementById('root')).render(content);
 `},bundle:true,write:false,jsx:'automatic',format:'iife',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock-actions',setup(b){
  b.onResolve({filter:/next\/navigation|next\/link|app\/account\/actions$|\.\/actions$/},args=>({path:args.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:
   args.path==='next/navigation'?`export const useRouter=()=>({replace:url=>{window.destination=url},push:url=>{window.destination=url},refresh:()=>{window.refreshes=(window.refreshes||0)+1}});`:
   args.path==='next/link'?`export default function Link(p){return <a {...p}/>;}`:
   args.path.endsWith('account/actions')?`
    export const sendAccountPhoneVerificationOtpAction=async input=>{window.calls.push(['send',input]);return {error:null,status:'sent',normalizedPhone:input.phone,resendAfterSeconds:1}};
    export const verifyAccountPhoneOtpAction=async input=>{window.calls.push(['verify',input]);return input.code==='000000'?{error:'The code could not be verified.'}:{error:null,status:'verified'};};`:
   `export const loadSignupHistoryAction=async()=>{window.calls.push(['load']);return {profiles:window.mode==='shared'?[{id:'mary',name:'Mary',salonName:'First salon',linked:false},{id:'david',name:'David',salonName:'Second salon',linked:false}]:[]};};
    export const finishSignupPhoneAction=async input=>{window.calls.push(['finish',input]);return {redirectTo:'/activity'};};`
  }));
 }}]});
 const style=readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./signup";\n@source "./(app)/welcome";');
 const css=(await postcss([tailwind({base:process.cwd()})]).process(style,{from:'app/globals.css'})).css;
 const js=built.outputFiles[0].text;
 const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><main class="min-h-screen bg-surface-muted px-4 py-8"><section id="root" class="mx-auto max-w-md rounded-2xl border border-border-subtle bg-white p-5"></section></main><script src="/app.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
 const base=`http://127.0.0.1:${server.address().port}`;
 const output='artifacts/signup-phone-history-20261025';await mkdir(output,{recursive:true});
 try{
  for(const width of [375,1280]){
   const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'?mode=signup');
   await page.getByLabel('Email',{exact:true}).fill('fixture@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');
   assert.equal(await page.getByLabel('Phone number',{exact:true}).getAttribute('required'),'');
   await page.getByRole('button',{name:'Create account',exact:true}).click();
   assert.equal(await page.evaluate(()=>window.destination),undefined);
   assert.equal(await page.getByLabel('Phone number',{exact:true}).evaluate(el=>el.validity.valueMissing),true);
   await page.goto(base+'?mode=single');
   await page.getByRole('button',{name:'Send verification code',exact:true}).click();
   await page.getByLabel('Verification code',{exact:true}).fill('000000');
   await page.getByRole('button',{name:'Verify & connect history',exact:true}).click();
   await page.getByRole('alert').filter({hasText:'The code could not be verified.'}).waitFor();
   await page.getByRole('button',{name:'Resend code',exact:true}).click();
   await page.getByLabel('Verification code',{exact:true}).fill('123456');
   await page.screenshot({path:`${output}/${width}-otp.png`});
   await page.getByRole('button',{name:'Verify & connect history',exact:true}).click();
   await page.waitForFunction(()=>window.destination==='/activity');
   assert.equal(await page.evaluate(()=>window.calls.filter(c=>c[0]==='send').length),2);
   await page.goto(base+'?mode=shared');await page.getByRole('button',{name:'Send verification code',exact:true}).click();
   await page.getByLabel('Verification code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify & connect history',exact:true}).click();
   await page.getByRole('heading',{name:'Which profiles are yours?'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Connect selected history'}).isDisabled(),true);
   await page.getByRole('checkbox',{name:'Mary First salon'}).check();
   await page.screenshot({path:`${output}/${width}-profiles.png`});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.getByRole('button',{name:'Connect selected history'}).click();await page.waitForFunction(()=>window.destination==='/activity');
   assert.deepEqual(await page.evaluate(()=>window.calls.find(c=>c[0]==='finish')[1].customerIds),['mary']);
   await page.goto(base+'?mode=shared');await page.getByRole('button',{name:'Send verification code',exact:true}).click();
   await page.getByRole('button',{name:'Change number',exact:true}).click();await page.getByLabel('Phone number',{exact:true}).fill('+15035550199');
   await page.getByRole('button',{name:'Send verification code',exact:true}).click();await page.getByLabel('Verification code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify & connect history',exact:true}).click();
   await page.getByRole('button',{name:'Select all my profiles',exact:true}).click();
   await page.getByRole('button',{name:'Connect selected history'}).click();await page.waitForFunction(()=>window.destination==='/activity');
   assert.deepEqual(await page.evaluate(()=>window.calls.find(c=>c[0]==='finish')[1].customerIds),['mary','david']);
   await page.goto(base+'?mode=shared');await page.getByRole('button',{name:'Send verification code',exact:true}).click();
   await page.getByLabel('Verification code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify & connect history',exact:true}).click();
   await page.getByRole('button',{name:'None of these profiles are mine',exact:true}).click();await page.waitForFunction(()=>window.destination==='/activity');
   assert.deepEqual(await page.evaluate(()=>window.calls.find(c=>c[0]==='finish')[1].customerIds),[]);
   await page.goto(base+'?mode=verified');await page.getByRole('button',{name:'Continue to my history'}).click();await page.waitForFunction(()=>window.destination==='/activity');
   assert.ok(!(await page.evaluate(()=>window.calls)).some(call=>call[0]==='send'));
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
