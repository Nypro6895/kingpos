import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
const output='artifacts/ads-reporting-transparency-20261118/implementation/native-controller-r3';
const id='10000000-0000-4000-8000-000000000001',reservation='20000000-0000-4000-8000-000000000002';
const actor={kind:'user',id},secret='synthetic-native-controller-proof-secret';
async function proofModule(){const built=await build({entryPoints:['lib/ad-disclosure-ticket.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'server-only-marker',setup(a){a.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'fixture'}));a.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:''}));}}]});return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));}

test('actual platform controller crosses real native adapter: large proof only on reserve, small confirm/click and no asset fallback',async()=>{
 fs.mkdirSync(output,{recursive:true});
 const ticket=await proofModule(),now=Date.now(),selectedAt=new Date(now).toISOString();
 const payload={version:1,selectionId:id,issuedAt:now,expiresAt:now+600000,
  target:{kind:'platform_campaign',campaignId:id,sourceType:'explore_campaign',sourceId:id,salonId:null},
  snapshot:{advertiserName:'Synthetic native promotion',title:'Synthetic native promotion',caption:'Public synthetic creative. '.repeat(100),mediaBucket:null,mediaPath:null,destinationPath:'/destination',selectedAt},
  summary:{locationSource:'none',areaLabel:null,searchKind:null,searchCategory:null,page:'/explore',device:'desktop',audience:'personal',selectionRuleCodes:['page_match','device_match','audience_match'],selectedAt},
  disclosure:{advertiserName:'Synthetic native promotion',primaryReasons:['This promotion is available on your Explore page.','It matches your account view and screen layout.'],details:[{label:'Page used',value:'/explore'},{label:'Account view',value:'personal'},{label:'Screen layout',value:'desktop'},{label:'Synthetic frozen details',value:'Public selection context. '.repeat(60)}]},
 };
 const baseProof=ticket.sealAdDisclosureProof(payload,actor,{secret,now});assert.ok(Buffer.byteLength(baseProof)>2048);assert.ok(Buffer.byteLength(baseProof)<33000);
 const disclosure={kind:'platform_campaign',selectionId:id,selectedAt,...payload.disclosure,reportScope:ticket.adDisclosureScope(actor,'platform_campaign',{secret}),proof:baseProof};
 const admittedPayload={...payload,disclosure:{...payload.disclosure,details:[...payload.disclosure.details,{label:'Frozen admission fixture',value:'Synthetic own-session limits verified at admission.'}]}};
 const admissionDisclosure={...disclosure,...admittedPayload.disclosure,proof:ticket.sealAdDisclosureProof(admittedPayload,actor,{secret,now})};
 const campaign={id,name:'Synthetic native promotion',kind:'placement',enabled:true,audiences:['personal'],devices:['desktop'],locations:['/explore'],placements:['sidebar'],imageUrl:'/photo.svg',href:'/destination',text:'Synthetic public creative',background:'#fff4f6',color:'#59323c',delaySeconds:0,durationSeconds:0,closeButton:true,repeat:'always',position:'top',speedSeconds:30,startsAt:null,endsAt:null,adDisclosure:disclosure};
 const entry=`import React from'react';import{createRoot}from'react-dom/client';import{ExploreAdvertising,ExploreAdSlot}from'./components/explore-advertising';import{createAppLocalShellHttpFetch}from'./lib/app-local-shell-http-client';
 const original=window.fetch.bind(window);window.nativeFallbacks=[];window.nativeScope='synthetic-actor-scope';
 const bridge=async(kind,name,args,options)=>{const r=await original('/native-bridge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,name,args,scope:options?.scope})});if(!r.ok)throw Error('Synthetic native host rejected request');return r.json()};
 const host={isNative:true,read:async(name,args,options)=>({data:await bridge('read',name,args,options)}),command:async(name,args,options)=>bridge('command',name,args,options)};
 window.fetch=createAppLocalShellHttpFetch({location:'reylumi-app://bundle/explore',scope:()=>window.nativeScope,host:()=>host,fetch:async(input)=>{nativeFallbacks.push(String(input));throw Error('Unexpected native asset API fallback')}});
 createRoot(document.getElementById('root')).render(<ExploreAdvertising viewerId='${id}' audience='personal'><ExploreAdSlot desktop/></ExploreAdvertising>);`;
 const stubs={
  'next/navigation':`export function usePathname(){return '/explore'};export function useSearchParams(){return new URLSearchParams()}`,
  'next/link':`export default function Link(p){return <a {...p}/>};export function useLinkStatus(){return {pending:false}}`,
  '@/components/workspace-language':`export const WorkspaceText=({text})=>text;const t=x=>x;export const useWorkspaceTranslation=()=>t;`,
  './app-local-host':`export function getAppLocalHost(){throw Error('The explicit synthetic host must be used')}`,
  './app-local-command-client':`export function getAppLocalCommandScope(){throw Error('The explicit synthetic scope must be used')}`,
 };
 const bundle=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outfile:'fixture.js',format:'iife',platform:'browser',jsx:'automatic',alias:{'@':process.cwd()},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'outer-native-host-and-next-boundaries',setup(a){a.onResolve({filter:/.*/},i=>Object.hasOwn(stubs,i.path)?{path:i.path,namespace:'fixture'}:undefined);a.onLoad({filter:/.*/,namespace:'fixture'},i=>({contents:stubs[i.path],loader:'jsx',resolveDir:process.cwd()}));}}]});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const native=[];const http=(data)=>({status:200,headers:{'content-type':'application/json','cache-control':'private, no-store'},body:JSON.stringify(data)});
 let server,browser;
 try{
  server=createServer(async(req,res)=>{const send=(type,value,status=200)=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(value)};
   if(req.url==='/fixture.js')return send('text/javascript',js);
   if(req.url==='/photo.svg')return send('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#e6bcc5"/></svg>');
   if(req.url==='/destination')return send('text/html','<p>Synthetic destination only</p>');
   if(req.url==='/native-bridge'){
    let raw='';for await(const chunk of req)raw+=chunk;const call=JSON.parse(raw);native.push(call);
    if(call.scope!=='synthetic-actor-scope')return send('application/json','{}',403);
    if(call.kind==='read'&&call.name==='http.shell.advertising')return send('application/json',JSON.stringify(http({campaigns:[campaign],limits:{}})));
    if(call.kind==='command'&&call.name==='http.shell.advertising-event'){
     const input=call.args.input;
     if(input.phase==='reserve'){
      try{const verified=ticket.readAdDisclosureProof(input.disclosureProof,'platform_campaign',actor,{secret});if(verified.selectionId!==id)throw Error();}
      catch{return send('application/json','{}',400);}
      return send('application/json',JSON.stringify(http({allowed:true,reservation,admissionDisclosure})));
     }
     return send('application/json',JSON.stringify(http({allowed:true})));
    }
    return send('application/json','{}',400);
   }
   if(req.url.startsWith('/api/'))return send('application/json','{}',500);
   send('text/html','<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial,sans-serif}'+css+'</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/explore');await page.getByRole('button',{name:'Why this ad',exact:true}).waitFor();
  const command=()=>native.filter(c=>c.kind==='command').map(c=>c.args.input);
  await page.waitForFunction(()=>document.querySelector('aside img')?.complete);for(let n=0;n<100&&!command().some(c=>c.phase==='confirm');n++)await page.waitForTimeout(20);
  assert.deepEqual(native.map(c=>c.name),['http.shell.advertising','http.shell.advertising-event','http.shell.advertising-event']);
  const [reserve,confirm]=command();assert.equal(reserve.event,'view');assert.equal(reserve.phase,'reserve');assert.equal(reserve.disclosureProof===baseProof,true);
  assert.deepEqual(Object.keys(reserve).sort(),['device','disclosureProof','event','id','path','phase']);assert.ok(Buffer.byteLength(JSON.stringify(reserve))>2048);assert.ok(Buffer.byteLength(JSON.stringify(reserve))<=40000);
  assert.equal(confirm.event,'view');assert.equal(confirm.phase,'confirm');assert.equal(confirm.reservation,reservation);assert.equal(Object.hasOwn(confirm,'disclosureProof'),false);assert.ok(Buffer.byteLength(JSON.stringify(confirm))<=2048);
  const beforeInformation=native.length;await page.getByRole('button',{name:'Why this ad',exact:true}).click();await page.getByRole('dialog',{name:'Why this ad',exact:true}).locator('summary').click();await page.getByText('Synthetic own-session limits verified at admission.',{exact:true}).waitFor();await page.waitForTimeout(50);assert.equal(native.length,beforeInformation);await page.getByRole('button',{name:'Close ad information'}).click();
  // Keep this synthetic transport fixture on its page; the real React Ctrl-click handler still produces the click command.
  await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('a'))event.preventDefault();},{capture:true,once:true}));
  await page.getByRole('link',{name:'Synthetic native promotion',exact:true}).click({modifiers:['Control']});
  for(let n=0;n<100&&!command().some(c=>c.event==='click');n++)await page.waitForTimeout(20);
  assert.equal(command().length,3);const click=command()[2];assert.equal(click.event,'click');assert.equal(click.reservation,reservation);assert.equal(Object.hasOwn(click,'phase'),false);assert.equal(Object.hasOwn(click,'disclosureProof'),false);assert.ok(Buffer.byteLength(JSON.stringify(click))<=2048);
  assert.equal(await page.evaluate(()=>nativeFallbacks.length),0);assert.deepEqual(errors,[]);
  const files=['components/explore-advertising.tsx','lib/advertising-client.ts','lib/app-local-shell-http-client.ts','lib/app-local-advertising-input.ts','lib/ad-disclosure-ticket.ts'];
  const evidence={passed:true,syntheticLocalOnly:true,browser:'Chromium',physicalWkWebViewAcceptance:false,realController:true,realNativeHttpAdapter:true,realAesProof:true,proofBytes:Buffer.byteLength(baseProof),hostBoundary:'synthetic localhost AppLocalHost; actual shell/route covered by separate native suite',apiAssetFallbacks:0,order:native.map(c=>c.kind==='read'?'GET':c.args.input.phase??c.args.input.event),payloads:command().map(c=>({event:c.event,phase:c.phase??null,bytes:Buffer.byteLength(JSON.stringify(c)),keys:Object.keys(c).sort(),hasProof:Object.hasOwn(c,'disclosureProof')})),sourceHashes:files.map(file=>({path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))};
  fs.writeFileSync(output+'/controller-native-transport.json',JSON.stringify(evidence,null,2)+'\n');
 }finally{await browser?.close();if(server)await new Promise(r=>{server.closeAllConnections();server.close(r)});}
});
