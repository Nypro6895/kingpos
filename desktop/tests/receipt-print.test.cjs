'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validateReceiptPrintJob,provisionalPrintAllowed,createReceiptPrinter}=require('../receipt-print.cjs');
const {OfflineShell}=require('../offline-shell.cjs');
const job={version:1,jobId:'50000000-0000-4000-8000-000000000001',kind:'receipt',receiptId:'40000000-0000-4000-8000-000000000001',title:'Receipt T1',paper:'80mm',html:'<!doctype html><html data-reylumi-receipt-document="1"><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head><body>Receipt</body></html>'};
const scope='10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001';

test('Windows installer includes the receipt runtime required by the native main process',()=>{
 const desktop=path.resolve(__dirname,'..'),build=fs.readFileSync(path.join(desktop,'build.cjs'),'utf8'),main=fs.readFileSync(path.join(desktop,'main.cjs'),'utf8');
 const packaged=[...build.match(/files:\s*\[([^\]]+)\]/s)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 for(const match of main.matchAll(/require\('\.\/([^']+\.cjs)'\)/g)){
  assert.ok(packaged.includes(match[1]),`Missing native runtime from installer: ${match[1]}`);
  assert.ok(fs.statSync(path.join(desktop,match[1])).isFile());
 }
 assert.ok(packaged.includes('receipt-print.cjs'));
});
test('native print job validation rejects injection, wrong identity/type/paper and oversized UTF8 before opening a printer',()=>{
 assert.equal(validateReceiptPrintJob(job),job);
 for(const patch of[{version:2},{jobId:'bad'},{kind:'paid'},{paper:'usb'},{receiptId:undefined},{html:'x'.repeat(1048577)},{html:job.html.replace('Receipt</body>','<script>alert(1)</script></body>')},{html:job.html.replace('Receipt</body>','<img src="https://outside.invalid/x"></body>')}])assert.throws(()=>validateReceiptPrintJob({...job,...patch}));
});
test('Windows passive readiness comes only from exact authorized main-shell attrs, clears on lock and rejects markers elsewhere',async()=>{
 const dir=fs.mkdtempSync(path.join(fs.mkdirSync(path.resolve('artifacts/receipt-native'),{recursive:true})||path.resolve('artifacts/receipt-native'),'shell-'));
 const codec={encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},origin='http://127.0.0.1:19999';let html=`<main data-portable-pos-shell data-receipt-local-scope="${scope}" data-receipt-local-commands="true"></main>`;
 const shell=new OfflineShell(dir,codec,origin,async()=>new Response(html,{headers:{'content-type':'text/html'}}));
 try{assert.equal(shell.printReadiness(scope).ready,false);await shell.prepare(scope);assert.equal(shell.printReadiness(scope).ready,true);assert.equal(shell.printReadiness('other').ready,false);shell.lock();assert.equal(shell.printReadiness(scope).ready,false);
 html=`<div data-receipt-local-scope="${scope}" data-receipt-local-commands="true"></div><main data-portable-pos-shell></main>`;await shell.prepare(scope);assert.equal(shell.printReadiness(scope).ready,false);
 }finally{shell.close();}
});
test('provisional native printing needs original prepared scope and durable pending receipt checkpoint',()=>{
 const pending={kind:'receipt',state:'pending',id:job.jobId,occurredAt:'2026-11-18T12:00:00Z',payload:{localDraftKey:'kingpos:portable-draft:v1:'+scope+':desktop',printSnapshot:{version:1,completion:'submitted-on-device',paymentState:'awaiting-server-validation'}}};
 const slip={...job,kind:'provisional',receiptId:undefined,operationId:pending.id,scope};let ready=true,checkpoint=Date.parse(pending.occurredAt);
 const shell={printReadiness:s=>({ready:ready&&s===scope})},vault={list:()=>[pending],checkpoint:()=>checkpoint};
 assert.equal(provisionalPrintAllowed(slip,shell,vault),true);checkpoint=0;assert.equal(provisionalPrintAllowed(slip,shell,vault),false);checkpoint=Date.parse(pending.occurredAt);ready=false;assert.equal(provisionalPrintAllowed(slip,shell,vault),false);ready=true;pending.state='attention';assert.equal(provisionalPrintAllowed(slip,shell,vault),false);
});
test('isolated Windows adapter uses explicit OS dialog, disables script/network, prevents duplicate jobs and never calls silent printing',async()=>{
 const windows=[],requests=[];
 class FakeWindow{constructor(options){this.options=options;this.destroyed=false;this.handlers={};this.webContents={setWindowOpenHandler(){},on(){},print:(options,done)=>{requests.push(options);done(true)}};windows.push(this)}on(n,f){this.handlers[n]=f}loadURL(url){this.url=url;return Promise.resolve()}isDestroyed(){return this.destroyed}destroy(){this.destroyed=true}}
 const partition={setPermissionRequestHandler(){},webRequest:{onBeforeRequest(_filter,handler){this.handler=handler}}};
 const printer=createReceiptPrinter({BrowserWindow:FakeWindow,session:{fromPartition:()=>partition},offlineShell:{epoch:0},vault:{}});
 assert.equal((await printer.print(job)).status,'submitted');assert.equal(requests[0].silent,false);assert.equal(windows[0].options.webPreferences.javascript,false);assert.equal(windows[0].options.webPreferences.nodeIntegration,false);assert.match(windows[0].url,/^data:text\/html/);let cancelled;partition.webRequest.handler({},v=>cancelled=v.cancel);assert.equal(cancelled,true);await assert.rejects(printer.print(job),/already handled/);
});
