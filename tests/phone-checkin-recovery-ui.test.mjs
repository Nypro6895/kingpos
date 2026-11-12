import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

async function fixture(contents,plugins=[]) {
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents},plugins});
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
 const server=createServer((_request,response)=>{response.setHeader('Content-Type','text/html');response.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script>${js}</script></html>`)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 return {browser,url:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}

test('Phone recovery: new window retains unsent entries, stale revisions never replay, finalized work is scoped-cleaned, storage failures are visible', {timeout:60000},async()=>{
 const f=await fixture(`
  import React from 'react';import {createRoot} from 'react-dom/client';import {StaffScanClient} from './app/staff/scan/staff-scan-client';
  const ticket={visitId:'visit',queueNumber:1,customerName:'Anna',status:'in_service',revision:1,scanMode:true,requestedServices:[{id:'service',name:'Full Set'}],lines:[],offers:[{id:'offer',staffId:'staff',staffName:'Kim',status:'working'}]};
  window.state={enabled:true,staffId:'staff',current:[ticket],waiting:[],services:[{id:'service',name:'Full Set',price:40}]};window.saves=[];
  window.publish=()=>window.listener?.({resource:'tickets'});window.render=()=>root.render(<StaffScanClient salonId="salon" staffId="staff" initial={structuredClone(window.state)}/>);const root=createRoot(document.getElementById('root'));window.render();
 `,[{name:'boundaries',setup(b){
  b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
  b.onResolve({filter:/pos-workspace-sync$/},()=>({path:'sync',namespace:'fixture'}));
  b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
  b.onResolve({filter:/^\.\/actions$/},a=>a.importer.replaceAll('\\','/').includes('/staff/scan/')?{path:'actions',namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='language'?`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`:a.path==='sync'?`export function subscribePosChanges(id,callback){window.listener=callback;return ()=>{window.listener=null}}`:a.path==='link'?`export default function Link({children}){return children}`:`
   export async function loadStaffScan(){return {data:structuredClone(window.state)}};
   export async function connectStaffScan(){return {ticket:structuredClone(window.state.current[0])}};
   export async function saveStaffScan(scope,input){window.saves.push(input);return {ticket:structuredClone(window.state.current[0])}};
  `}));
 }}]);
 try {
  const context=await f.browser.newContext();let page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.url);await page.getByRole('button',{name:/Anna · #1/}).click();await page.getByRole('textbox',{name:'Amount',exact:true}).waitFor();await page.waitForTimeout(70);
  await page.getByRole('button',{name:'6',exact:true}).click();await page.getByRole('button',{name:'7',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('reylumi:staff-scan:salon:staff:offer'))?.lines[0].amount==='67');
  assert.equal(await page.evaluate(()=>window.saves.length),0,'typing must not automatically send financial work');
  await page.close();page=await context.newPage();await page.goto(f.url);await page.getByRole('button',{name:/Anna · #1/}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Amount"]')?.value==='67');await page.getByText('Recovered unsent entries on this device. Review, then Stand by or Done.').waitFor();
  assert.equal(await page.evaluate(()=>window.saves.length),0,'a new window only recovers, never replays');
  await page.evaluate(()=>{window.state.current[0].revision=2;window.publish()});await page.getByRole('button',{name:'Use POS values',exact:true}).waitFor();
  await page.getByRole('button',{name:'Stand by',exact:true}).click();assert.equal(await page.evaluate(()=>window.saves.length),0,'stale restored work must not be submitted');
  await page.evaluate(()=>{
   localStorage.setItem('reylumi:staff-scan:other:staff:offer','other salon');localStorage.setItem('reylumi:staff-scan:salon:other:offer','other staff');
   window.state.current=[];window.publish();
  });
  await page.waitForFunction(()=>!document.querySelector('[data-scan-editor]'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('reylumi:staff-scan:salon:staff:offer')),null);
  assert.equal(await page.evaluate(()=>localStorage.getItem('reylumi:staff-scan:other:staff:offer')),'other salon');
  assert.equal(await page.evaluate(()=>localStorage.getItem('reylumi:staff-scan:salon:other:offer')),'other staff');
  await context.close();
  const legacy=await f.browser.newContext();const oldPage=await legacy.newPage();await oldPage.addInitScript(()=>sessionStorage.setItem('reylumi:staff-scan:salon:staff:offer',JSON.stringify({lines:[{id:'old',serviceId:'service',amount:'82'}],revision:1,at:Date.now()-24*3600000})));
  await oldPage.goto(f.url);await oldPage.getByRole('button',{name:/Anna · #1/}).click();await oldPage.waitForFunction(()=>document.querySelector('input[aria-label="Amount"]')?.value==='82');
  assert.equal(await oldPage.evaluate(()=>sessionStorage.getItem('reylumi:staff-scan:salon:staff:offer')),null,'legacy session draft migrates after durable write');await legacy.close();
  const denied=await f.browser.newContext();const deniedPage=await denied.newPage();await deniedPage.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('reylumi:staff-scan:'))throw Error('quota');return set.call(this,key,value)}});
  await deniedPage.goto(f.url);await deniedPage.getByRole('button',{name:/Anna · #1/}).click();await deniedPage.getByRole('textbox',{name:'Amount',exact:true}).waitFor();await deniedPage.waitForTimeout(50);await deniedPage.getByRole('button',{name:'9',exact:true}).click();
  await deniedPage.getByText('Device storage unavailable. Keep this window open and use Stand by before leaving.').waitFor();
  assert.equal(await deniedPage.getByRole('textbox',{name:'Amount',exact:true}).inputValue(),'9');assert.equal(await deniedPage.evaluate(()=>window.saves.length),0);assert.deepEqual(errors,[]);await denied.close();
 } finally {await f.close()}
});

test('Portable real hook/outbox: offline reload, blocked stale replay, device persistence failure and receipt checkpoint', {timeout:60000},async()=>{
 const f=await fixture(`
  import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
  import {usePortableDraft} from './app/pos/portable/use-portable-draft';
  import {savePortableOperation} from './lib/portable-operations';
  const params=new URLSearchParams(location.search);const scope=params.get('scope')??'scope';
  const empty={amount:'',heldTicket:null};const payload=amount=>({token:'display',selectedStaffId:null,staffLines:[],customer:null,discount:0,subtotal:Number(amount),tax:0,tip:0,total:Number(amount),totalBeforeTip:Number(amount)});
  window.sent=[];window.serverVersion=Number(params.get('version')??0);window.reply=params.get('reply')??'ok';
  window.fetch=async(url,options)=>{const body=JSON.parse(options.body);window.sent.push({url,body});if(window.reply==='retry')return new Response('',{status:503});if(window.reply==='blocked')return Response.json({kind:'blocked',message:'Changed on another screen. Review.'});return Response.json({kind:'ok',version:body.expectedVersion+1})};
  window.setOnline=value=>{Object.defineProperty(navigator,'onLine',{configurable:true,value});window.dispatchEvent(new Event(value?'online':'offline'))};window.setOnline(false);
  function App(){const [value,setValue]=useState(empty),[version,setVersion]=useState(window.serverVersion);const draft=usePortableDraft({scope,operationScope:'portable:test:'+scope,version,recovery:value,emptyRecovery:empty,restore:setValue,onVersion:setVersion});
   window.edit=amount=>{const next={amount,heldTicket:{visitId:'visit',revision:4}};setValue(next);return draft.persistLocal(payload(amount),next)};
   window.checkpoint=async()=>{await savePortableOperation('portable:test:'+scope,'receipt',{localDraftKey:draft.recoveryKey.current});draft.checkpoint(empty);setValue(empty)};
   window.draft=draft;window.value=value;return <><output id="status">{draft.status}</output><output id="ready">{String(draft.ready)}</output><output id="amount">{value.amount}</output><output id="review">{String(draft.needsReview)}</output></>};createRoot(document.getElementById('root')).render(<App/>);
 `);
 try {
  const context=await f.browser.newContext();const page=await context.newPage();await page.goto(f.url);await page.waitForFunction(()=>window.draft?.ready);
  assert.equal(await page.evaluate(()=>window.edit('65')),true);await page.waitForFunction(()=>document.querySelector('#amount').textContent==='65');
  assert.equal(await page.evaluate(()=>window.sent.length),0);await page.reload();await page.waitForFunction(()=>window.draft?.ready&&window.value.amount==='65');
  assert.equal(await page.evaluate(()=>window.value.heldTicket.revision),4);assert.equal(await page.evaluate(()=>window.sent.length),0);
  await page.evaluate(()=>window.setOnline(true));await page.waitForFunction(()=>document.querySelector('#status').textContent==='Draft synced');
  assert.equal(await page.evaluate(()=>window.sent.length),1);assert.equal(await page.evaluate(()=>window.sent[0].body.payload.total),65);
  await page.evaluate(()=>window.setOnline(false));await page.evaluate(()=>window.edit('80'));await page.goto(f.url+'?version=9');
  await page.waitForFunction(()=>window.draft?.ready&&window.value.amount==='80');await page.getByText('The server receipt changed while this draft was offline. Review before continuing.').waitFor();
  await page.evaluate(()=>window.setOnline(true));await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.sent.length),0,'conflicting persisted outbox cannot replay');
  await page.goto(f.url+'?scope=checkpoint');await page.waitForFunction(()=>window.draft?.ready);await page.evaluate(()=>window.edit('91'));await page.evaluate(()=>window.checkpoint());await page.reload();await page.waitForFunction(()=>window.draft?.ready);assert.equal(await page.evaluate(()=>window.value.amount),'','submitted recovery must not resurrect');
  await page.goto(f.url+'?scope=other');await page.waitForFunction(()=>window.draft?.ready);assert.equal(await page.evaluate(()=>window.value.amount),'','other scope cannot restore the first scope');
  await context.close();
  const denied=await f.browser.newContext();const deniedPage=await denied.newPage();await deniedPage.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('kingpos:portable-draft:'))throw Error('quota');return set.call(this,key,value)}});await deniedPage.goto(f.url);await deniedPage.waitForFunction(()=>window.draft?.ready);assert.equal(await deniedPage.evaluate(()=>window.edit('72')),false);await deniedPage.getByText('Device storage unavailable — keep this window open').waitFor();assert.equal(await deniedPage.evaluate(()=>window.value.amount),'72');await denied.close();
 } finally {await f.close()}
});
