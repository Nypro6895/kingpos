import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';

test('claim UI routes later applicants and stale challenges to manual support',async t=>{
 const output=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {ClaimPanel} from './app/claim/claim-panel';
 const mode=new URLSearchParams(location.search).get('mode');window.calls=[];
 const initialRequest=mode==='approved'?{id:'r',status:'approved'}:mode==='needs_info'?{id:'r',status:'needs_info',support_report_id:'case',review_reason:'Send evidence'}:mode==='confirm'?{id:'r',status:'otp_pending'}:null;
 createRoot(document.getElementById('root')).render(<ClaimPanel salonId="salon" phone="+15555550123" unclaimed={mode!=='managed'} messagingReady={true} uploadsReady={true} initialRequest={initialRequest}/>);
 `},bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/^(next\/link|next\/navigation|\.\/actions)$/},a=>({path:a.path,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},a=>({resolveDir:process.cwd(),loader:'jsx',contents:a.path==='next/link'?`import React from 'react';export default function Link(p){return <a {...p}/>;}`:a.path==='next/navigation'?`export function useRouter(){return {refresh(){},push(){}};}`:`export async function beginBusinessClaimAction(){window.calls.push('send');return {supportRequired:true};}export async function confirmBusinessClaimAction(){window.calls.push('confirm');return {supportRequired:true};}export async function requestBusinessClaimSupportAction(id,form){window.calls.push({id,reason:form.get('reason')});return {error:null};}`}));
 }}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?output.outputFiles[0].text:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());
 for(const mode of ['managed','send','confirm','approved','needs_info'])await t.test(mode,async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844}});try{
   await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
   if(mode==='approved'){await page.getByRole('link',{name:'Open salon management'}).waitFor();assert.equal(await page.getByRole('button',{name:'Call me with a code'}).count(),0);return;}
   if(mode==='needs_info'){await page.getByRole('link',{name:'View request, decision & conversation'}).waitFor();assert.equal(await page.getByRole('button',{name:'Call me with a code'}).count(),0);return;}
   await page.getByRole('checkbox').check();
   if(mode==='send')await page.getByRole('button',{name:'Call me with a code'}).click();
   if(mode==='confirm'){await page.getByRole('textbox',{name:'Six-digit code'}).fill('123456');await page.getByRole('button',{name:'Confirm code'}).click();}
   await page.getByRole('heading',{name:'Request ownership review'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Call me with a code'}).count(),0);
   assert.equal(await page.getByRole('textbox',{name:'Six-digit code'}).count(),0);
   await page.getByRole('textbox',{name:'Your connection to this salon'}).fill('I am claiming ownership and submit my evidence for review.');
   await page.getByRole('button',{name:'Submit request'}).click();
   await page.getByRole('status').filter({hasText:'waiting for ownership review'}).waitFor();
   const calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>typeof c==='object').length,1);if(mode==='managed')assert.equal(calls.length,1);
  }finally{await page.close();}
 });
});
