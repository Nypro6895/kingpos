import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Actual QR encoder, video element, canvas frame extraction and jsQR decoder.
// Only the physical camera and server actions are replaced in this browser layer;
// real RPC persistence/idempotence is tested in personal-qr-full-schema.
test('phone viewport camera decodes salon QR and both customer IDs; denied camera retains manual fallback', {timeout:60000},async()=>{
 const entry='00000000-0000-4000-8000-000000000200',visit='00000000-0000-4000-8000-000000000300';
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {PersonalQrClient} from './app/qr/personal-qr-client';
  import {StaffQrScanner} from './app/staff/scan/qr-scanner';
  import {QrCodeTile} from './components/qr-code-tile';
  const mode=new URLSearchParams(location.search).get('mode');
  window.calls=[];window.stops=0;window.decoded=[];
  window.qrValue=mode==='personal'?'reylumi:personal:${entry}':mode==='visit'?'reylumi:checkin:${visit}':'https://reylumi.com/check-in/${entry}';
  window.state={updatedAt:new Date().toISOString(),userId:'customer',code:'reylumi:personal:${entry}',expiresAt:new Date(Date.now()+900000).toISOString(),visits:[{visitId:'${visit}',salonId:'salon',salonName:'Nails Studio',queueNumber:28,status:'waiting',checkedInAt:new Date().toISOString(),requestedServices:[{id:'s1',name:'Pedicure'}],workingStaff:[],lines:[]}]};
  createRoot(document.getElementById('root')).render(<><div id="source" style={{display:'none'}}><QrCodeTile valueToEncode={window.qrValue} ariaLabel="Camera fixture" /></div>{mode==='personal'||mode==='visit'?<StaffQrScanner onCode={code=>window.decoded.push(code)} onClose={()=>{}}/>:<PersonalQrClient viewerId="customer" initial={window.state} customerName="NENE"/>}</>);
  navigator.mediaDevices.getUserMedia=async options=>{
   window.calls.push({kind:'camera',options});
   if(mode==='denied')throw new DOMException('Permission denied','NotAllowedError');
   const svg=document.querySelector('#source svg');
   const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(new XMLSerializer().serializeToString(svg));await img.decode();
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=640;
   const ctx=canvas.getContext('2d');const draw=()=>{ctx.fillStyle='white';ctx.fillRect(0,0,640,640);ctx.drawImage(img,80,80,480,480)};draw();
   const stream=canvas.captureStream(10),timer=setInterval(draw,100);
   for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.stops++;clearInterval(timer);stop()};}
   return stream;
  };
 `},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/^\.\/actions$/},()=>({path:'actions',namespace:'fixture'}));
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;':a.path==='link'?'export default function Link({children,...props}){return <a {...props}>{children}</a>}':`
   export async function loadPersonalQr(){return {data:structuredClone(window.state)}}
   export async function loadPersonalQrCatalog(viewer,entry){window.calls.push({kind:'catalog',viewer,entry});return {catalog:{salonId:'salon',salonName:'Nails Studio',services:[{id:'s1',name:'Pedicure',base_price:45}]}}}
   export async function checkinPersonalQr(viewer,input){window.calls.push({kind:'checkin',viewer,input});return {visitId:'${visit}'}}
  `}));
 }}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px Arial;margin:0}${css}</style><div id="root"></div><script>${js}</script></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const open=mode=>page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
  await open('salon');await page.getByRole('button',{name:'Scan salon QR',exact:true}).click();
  await page.getByRole('region',{name:'Choose check-in services'}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='checkin').length),0,'scan alone must not create a check-in');
  assert.equal(await page.evaluate(()=>window.calls.find(c=>c.kind==='catalog').entry),entry);
  assert.ok(await page.evaluate(()=>window.stops>0),'camera stops after decode');
  await page.getByRole('checkbox',{name:'Pedicure',exact:true}).check();await page.getByRole('button',{name:'Confirm check-in',exact:true}).click();
  await page.getByRole('img',{name:'Your check-in QR',exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>window.state.visits.length),1);assert.equal(await page.getByText('#28',{exact:true}).count()>0,true);
  fs.mkdirSync('artifacts/phone-checkin-scan-20261026',{recursive:true});
  await page.screenshot({path:'artifacts/phone-checkin-scan-20261026/mobile-existing-visit.png',fullPage:true});
  for(const mode of ['personal','visit']){
   await open(mode);await page.waitForFunction(()=>window.decoded.length===1);
   assert.equal(await page.evaluate(()=>window.decoded[0]),mode==='personal'?`reylumi:personal:${entry}`:`reylumi:checkin:${visit}`);
   assert.ok(await page.evaluate(()=>window.stops>0));
  }
  await open('denied');await page.getByRole('button',{name:'Scan salon QR',exact:true}).click();await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Close camera',exact:true}).click();
  await page.getByText('Have a check-in link?',{exact:true}).click();await page.getByRole('textbox',{name:'Salon check-in link'}).fill(`https://reylumi.com/check-in/${entry}`);await page.getByRole('button',{name:'Open check-in',exact:true}).click();await page.getByRole('region',{name:'Choose check-in services'}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.kind==='checkin').length),0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
