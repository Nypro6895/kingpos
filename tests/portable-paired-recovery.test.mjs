import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

test('paired browser keeps unacknowledged draft and operation ID across a new window, and rejects a second writer',async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{usePortableDraft}from'./app/pos/portable/use-portable-draft';
  // Hold the cloud response after the real outbox has durably assigned its ID.
  window.fetch=()=>new Promise(()=>{});
  function App(){const[amount,setAmount]=useState('0');const draft=usePortableDraft({paired:true,scope:'salon:paired-receipt',operationScope:'salon:pos-key',version:0,recovery:{amount},restore:value=>setAmount(value.amount),onVersion:()=>{}});
   return <main><output data-ready={String(draft.ready)}>{amount}</output><p>{draft.status}</p><button disabled={!draft.ready} onClick={()=>{setAmount('73.50');draft.persistLocal({token:'paired-receipt',selectedStaffId:null,staffLines:[],customer:null,discount:0,subtotal:73.5,tax:0,tip:0,total:73.5,totalBeforeTip:73.5},{amount:'73.50'})}}>Save pending</button></main>}
  createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',plugins:[{name:'recovery-only-boundary',setup(b){b.onResolve({filter:/portable-native-client$|portable-operations$|pos-local-display$/},({path})=>({path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('portable-native-client')?'export const PORTABLE_NATIVE_READY_CHANGED="readiness";':path.endsWith('portable-operations')?'export async function portableCheckpoint(){return 0}':'export function publishLocalDisplaySnapshot(){}'}));}}]});
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?built.outputFiles[0].text:'<div id="root"></div><script src="/bundle.js"></script>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const context=await browser.newContext(),url=`http://127.0.0.1:${server.address().port}/`;
  let page=await context.newPage();await page.goto(url);await page.locator('[data-ready=true]').waitFor();await page.getByRole('button',{name:'Save pending'}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kingpos:portable-draft:v1:salon:paired-receipt:paired-device'))?.outbox.head?.id);
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:portable-draft:v1:salon:paired-receipt:paired-device')));
  assert.equal(stored.recovery.amount,'73.50');const operationId=stored.outbox.head?.id??stored.outbox.next?.id;assert.ok(operationId);
  const oldTab=await page.evaluate(()=>sessionStorage.getItem('kingpos:portable-tab'));await page.close();
  page=await context.newPage();await page.goto(url);await page.locator('[data-ready=true]').waitFor();await page.waitForFunction(()=>document.querySelector('output').textContent==='73.50');
  assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('kingpos:portable-tab')),oldTab);
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('kingpos:portable-draft:v1:salon:paired-receipt:paired-device')));
  assert.equal(restored.outbox.head?.id??restored.outbox.next?.id,operationId);
  const competing=await context.newPage();await competing.goto(url);await competing.getByText('POS is already open in another window. Continue there or close it first.').waitFor();
  assert.equal(await competing.getByRole('button',{name:'Save pending'}).isDisabled(),true);
  await competing.close();await page.close();await context.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
