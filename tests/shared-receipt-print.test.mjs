import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from 'esbuild';
async function bundled(path){const{outputFiles}=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));}
const doc=await bundled('lib/receipt-print-document.ts'),prefs=await bundled('lib/receipt-device-preferences.ts');
const provisional=await bundled('lib/provisional-receipt-print.ts'),portable=await bundled('lib/portable-receipt-print.ts');
const receiptId='40000000-0000-4000-8000-000000000001',opId='50000000-0000-4000-8000-000000000001';
const scope='10000000-0000-4000-8000-000000000001:20000000-0000-4000-8000-000000000001';
const receipt={header:{salon_name:'QA Salon',salon_phone:'2025550101',ticket_number:'T00001',customer_name:'Walk-in',created_time:'2026-11-15T18:00:00Z',closed_time:'2026-11-15T19:00:00Z',ticket_status:'Closed',receipt_status:'Final Receipt'},items:[{service_name:'QA Manicure',assigned_staff:'QA Staff',line_total:65}],totals:{subtotal:65,discount:6.5,tax:0,tip:5,grand_total:63.5,paid:59,remaining:4.5},payments:[{method:'Cash',amount:59,created_time:'2026-11-15T19:00:00Z'}],footer:{message:'Thank you.'}};
const input={receipt,receiptId,brand:{salonName:'Salon <script>alert(1)</script>',phone:'2025550101',address:'100 QA Lane'},preferences:{...prefs.DEFAULT_RECEIPT_PREFERENCES,customFooter:'Extra <img src=x onerror=alert(1)>'}};

test('one escaped isolated document preserves canonical status/identity/money; layout controls cannot replace critical fields',()=>{
 const before=structuredClone(receipt);
 for(const paper of ['58mm','80mm','a4']){
  const html=doc.receiptPrintDocument({...input,preferences:{...input.preferences,paper,showPhone:false,showAddress:false,showLogo:false}});
  for(const text of[receiptId,'Final Receipt','Ticket status: Closed','$63.50','$59.00','$4.50','Recorded paid','Remaining','Thank you.','Extra &lt;img'])assert.ok(html.includes(text),text);
  assert.ok(html.includes("default-src 'none'"));assert.ok(!/<script\b|<iframe\b|<img src=x/i.test(html));assert.ok(html.includes('&lt;script&gt;'));
 }
 assert.deepEqual(receipt,before);
 for(const invalid of[NaN,Infinity,undefined,null])assert.throws(()=>doc.receiptPrintDocument({...input,receipt:{...receipt,totals:{...receipt.totals,paid:invalid}}}),/amounts were not recorded/);
});
test('unpaid/open, cancelled and missing receipt identity never become a final receipt; test job is conspicuous',()=>{
 for(const status of['open','cancelled','voided'])assert.throws(()=>doc.receiptPrintDocument({...input,receipt:{...receipt,header:{...receipt.header,ticket_status:status,receipt_status:'Draft'}}}),/saved, closed/);
 assert.throws(()=>doc.receiptPrintDocument({...input,receiptId:undefined}),/saved, closed/);
 const sample=doc.receiptPrintDocument({...input,test:true,receiptId:undefined,receipt:{...receipt,header:{...receipt.header,receipt_status:'Draft',ticket_status:'Open'}}});
 assert.ok(sample.includes('TEST PRINT'));assert.ok(sample.includes('NOT A RECEIPT'));assert.ok(sample.includes('NO SALE'));assert.ok(!sample.includes('Receipt ID:'));
});
test('device-scoped preferences are bounded/nonfinancial, Save commits once, other scopes stay separate and failure is explicit',()=>{
 const store=new Map(),events=[];globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};globalThis.window={dispatchEvent:e=>events.push(e)};
 globalThis.CustomEvent=class{constructor(type,{detail}){this.type=type;this.detail=detail;}};
 prefs.saveReceiptPreferences(scope,{...prefs.DEFAULT_RECEIPT_PREFERENCES,paper:'58mm',customFooter:'x'.repeat(500)});
 assert.equal(prefs.readReceiptPreferences(scope).customFooter.length,240);assert.equal(events.length,1);
 assert.equal(prefs.readReceiptPreferences('other:'+scope).paper,'80mm');assert.equal(prefs.readReceiptPreferences(scope).paper,'58mm');
 assert.equal(prefs.normalizeReceiptPreferences({paper:'bad',printer:'remote',total:0}).printer,'system');
 assert.throws(()=>prefs.saveReceiptPreferences('../escape',prefs.DEFAULT_RECEIPT_PREFERENCES),/workspace/);
 globalThis.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>prefs.saveReceiptPreferences(scope,prefs.DEFAULT_RECEIPT_PREFERENCES),/quota/);
});
function operation(){return{id:opId,scope,kind:'receipt',occurredAt:'2026-11-18T12:00:00Z',state:'pending',payload:{localDraftKey:'kingpos:portable-draft:v1:'+scope+':native-device',printSnapshot:provisional.captureReceiptPrintSnapshot({capturedAt:'2026-11-18T12:00:00Z',customerName:'Local customer',lines:receipt.items,totals:{subtotal:65,discount:6.5,tax:0,tip:5,grand_total:63.5}})}};}
test('provisional slip requires completed immutable snapshot, matching scope, durable checkpoint and admission; never says final/paid',()=>{
 const op=operation(),checkpoint=Date.parse(op.occurredAt),now=checkpoint+1000;
 const captured=provisional.provisionalReceiptFromOperation(op,scope,checkpoint,true,now);
 const html=doc.receiptPrintDocument({...input,...captured,receiptId:undefined});
 for(const text of['PROVISIONAL','PENDING SYNC','AWAITING SERVER VALIDATION',opId,'not a final receipt or proof of payment','$63.50'])assert.ok(html.includes(text),text);
 for(const text of['Final Receipt','Recorded paid','Remaining','Receipt ID:','Ticket status: Closed'])assert.ok(!html.includes(text),text);
 for(const mutate of[o=>{o.state='synced'},o=>{o.state='attention'},o=>{o.kind='visit'},o=>{o.rejected=true},o=>{delete o.payload.printSnapshot},o=>{delete o.payload.localDraftKey},o=>{o.scope='other'},o=>{o.payload.printSnapshot.completion='draft'}]){const bad=structuredClone(op);mutate(bad);assert.throws(()=>provisional.provisionalReceiptFromOperation(bad,scope,checkpoint,true,now),/Reconnect/);}
 assert.throws(()=>provisional.provisionalReceiptFromOperation(op,scope,0,true,now),/Reconnect/);assert.throws(()=>provisional.provisionalReceiptFromOperation(op,scope,checkpoint,false,now),/Reconnect/);
 const free=operation();free.payload.printSnapshot.totals={subtotal:65,discount:65,tax:0,tip:0,grand_total:0};assert.ok(provisional.provisionalReceiptFromOperation(free,scope,checkpoint,true,now));
});
test('native readback and lease expiry are checked without browser-storage fallback or outbox mutation',async()=>{
 const op=operation(),calls=[];let expires=Date.now()+60000;
 globalThis.location={pathname:'/pos/portable/ticket'};globalThis.window={__reylumiPortableDevice:{version:1,platform:'android',storage:{get(){throw Error('Must not read browser draft')},set(){throw Error('No writes')},remove(){throw Error('No writes')}},request:async request=>{calls.push(request.action);if(request.action==='offline.status')return{scope,storage:'native',offlineReady:true,expiresAt:new Date(expires).toISOString()};if(request.action==='operations.list')return[op];if(request.action==='operations.checkpoint')return Date.parse(op.occurredAt);throw Error('Unexpected mutation');}}};
 await provisional.readProvisionalReceipt(scope,opId);assert.deepEqual(calls,['offline.status','operations.list','operations.checkpoint']);
 expires=Date.now()-1;await assert.rejects(provisional.readProvisionalReceipt(scope,opId),/Reconnect/);
});
test('optional print metadata cannot block Gift-only or zero-total financial commands',async()=>{
 const gift={capturedAt:'2026-11-18T12:00:00Z',customerName:'Gift buyer',lines:[{service_name:'Gift card',assigned_staff:'',line_total:25}],totals:{subtotal:25,discount:0,tax:0,tip:0,grand_total:25}};
 assert.equal(provisional.captureReceiptPrintSnapshot(gift).totals.grand_total,25);
 assert.equal(provisional.captureReceiptPrintSnapshot({...gift,lines:[{service_name:'Service',assigned_staff:'QA',line_total:25}],totals:{subtotal:25,discount:25,tax:0,tip:0,grand_total:0}}).totals.grand_total,0);
 const free=provisional.captureReceiptPrintSnapshot({...gift,lines:[{service_name:'Complimentary service',assigned_staff:'QA',line_total:0}],totals:{subtotal:0,discount:0,tax:0,tip:0,grand_total:0}});assert.equal(free.lines[0].line_total,0);assert.equal(free.totals.grand_total,0);
 assert.throws(()=>provisional.captureReceiptPrintSnapshot({...gift,lines:[{service_name:'Bad amount',assigned_staff:'QA',line_total:-1}]}));
 const financial={requestId:opId,lines:[],giftPurchaseCents:2500},saved=[];
 const metadata=provisional.optionalReceiptPrintSnapshot({...gift,lines:[]});assert.equal(metadata,undefined);
 await Promise.resolve().then(()=>saved.push({...financial,printSnapshot:metadata}));assert.equal(saved.length,1);assert.equal(saved[0].giftPurchaseCents,2500);assert.deepEqual(saved[0].lines,[]);
});
test('Portable adapter uses current canonical retail totals and existing Gift/reward payment projection',()=>{
 const row={id:receiptId,status:'closed',ticketNumber:'T00001',customerName:'Walk-in',openedAt:'2026-11-15T18:00:00Z',createdAt:'2026-11-15T18:00:00Z',closedAt:'2026-11-15T19:00:00Z',discountType:'percentage',discountValue:10,taxRate:0,tipType:'fixed_amount',tipValue:5,
 items:[{lineTotal:65,serviceName:'QA Manicure',staffName:'QA Staff'}],subtotal:90,discountAmount:6.5,taxAmount:0,tipAmount:5,total:88.5,paid:84,remaining:4.5,
 financial_sources:{giftSales:[{id:opId,amountCents:2500,last4:'0000',status:'completed',paymentMethod:'cash',createdAt:'2026-11-15T19:00:00Z'}],giftRedeemedCents:0,rewardDiscount:2,recordedPayments:[{amount:59,paymentMethod:'cash',createdAt:'2026-11-15T19:00:00Z'}]}};
 const before=structuredClone(row),out=portable.portableTicketPrintReceipt(row,'QA Salon');assert.equal(out.totals.grand_total,88.5);assert.equal(out.totals.paid,84);assert.equal(out.totals.remaining,4.5);assert.equal(out.totals.discount,4.5);assert.equal(out.totals.reward,2);assert.equal(out.items.length,2);assert.deepEqual(row,before);
 assert.throws(()=>portable.portableTicketPrintReceipt({...row,status:'open'},'QA'),/closed/);assert.throws(()=>portable.portableTicketPrintReceipt({...row,paid:0},'QA'),/incomplete/);assert.throws(()=>portable.portableTicketPrintReceipt({...row,financial_sources:undefined},'QA'),/recorded payments/);
 const giftOnly={...row,items:[],discountValue:0,tipValue:0,subtotal:25,discountAmount:0,taxAmount:0,tipAmount:0,total:25,paid:25,remaining:0,financial_sources:{...row.financial_sources,rewardDiscount:0,recordedPayments:[]}};
 const giftReceipt=portable.portableTicketPrintReceipt(giftOnly,'QA');assert.equal(giftReceipt.items.length,1);assert.equal(giftReceipt.totals.grand_total,25);assert.equal(giftReceipt.totals.paid,25);
 const free={...row,discountValue:100,tipValue:0,subtotal:65,discountAmount:65,tipAmount:0,total:0,paid:0,remaining:0,financial_sources:{...row.financial_sources,giftSales:[],rewardDiscount:0,recordedPayments:[]}};assert.equal(portable.portableTicketPrintReceipt(free,'QA').totals.grand_total,0);
});
test('iOS JS bridge resolves only matching typed native acknowledgement, rejects concurrency and sends no arbitrary print command',async()=>{
 const posted=[],timers=new Map(),listeners={};let next=0;
 const window={webkit:{messageHandlers:{reylumi:{postMessage:m=>posted.push(m)}}},addEventListener:(n,f)=>listeners[n]=f};window.top=window;
 const context=vm.createContext({window,TextEncoder,Map,Promise,Error,setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(fs.readFileSync('ios/Reylumi/ReceiptPrintBridge.js','utf8'),context);
 const job=doc.receiptPrintJob(input),pending=window.__reylumiReceiptPrint.print(job);await assert.rejects(window.__reylumiReceiptPrint.print({...job,jobId:opId}),/already opening/);
 assert.equal(posted.length,1);assert.equal(posted[0].action,'print-receipt');window.__reylumiReceiptPrintResult({jobId:job.jobId,status:'presented'});assert.equal((await pending).status,'presented');assert.equal(timers.size,0);
 assert.ok(!posted.some(p=>p.action==='print'));
});
