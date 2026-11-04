import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';

const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const purchaseId='00000000-0000-4000-8000-000000000010';
const salonId='00000000-0000-4000-8000-000000000020';
function fixture(){
 const invoice={id:'in_current',subscription:'sub_saved',status:'paid',livemode:true,amount_paid:99,
  payment_intent:{id:'pi_current',status:'succeeded',amount_received:99,currency:'usd',latest_charge:{id:'ch_current',amount_refunded:99}}};
 const old={...invoice,id:'in_old',payment_intent:{...invoice.payment_intent,id:'pi_old',latest_charge:{id:'ch_old',amount_refunded:99}}};
 const purchase={id:purchaseId,salon_id:salonId,plugin_id:'booking-policy',subscription_id:'sub_saved',amount_cents:99,snapshot:{account_id:'acct_saved'}};
 return {config:{accountId:'acct_saved',mode:'live'},purchase,invoice,old,
  sub:{id:'sub_saved',livemode:true,status:'active',customer:'cus_saved',current_period_end:Math.floor(Date.now()/1000)+30*86400,
   metadata:{market_card_purchase:purchaseId,salon_id:salonId,plugin_id:'booking-policy'},
   items:{data:[{quantity:1,price:{unit_amount:99,currency:'usd',recurring:{interval:'month',interval_count:1}}}]},latest_invoice:invoice},
  event:{id:'evt_refund',livemode:true,type:'charge.refunded',api_version:'2026-10-28.endive',data:{object:{id:'ch_current',object:'charge'}}},
  charge:{id:'ch_current',livemode:true,invoice:'in_current'},events:new Map(),calls:[],writes:[],applied:[]};
}

async function loadCard(){
 const mocks={
  'server-only':'',
  './platform-payment':`
   export async function paymentConfig(){return globalThis.__marketCardEvent.config}
   export async function paymentStripe(route,form,key){
    const c=globalThis.__marketCardEvent;c.calls.push({route,form,key});
    if(c.failRoute===route)throw Error('Provider temporarily unavailable');
    if(route.startsWith('events/'))return c.event;
    if(route.startsWith('charges/'))return c.charge;
    if(route.startsWith('invoices/in_current?'))return c.invoice;
    if(route.startsWith('invoices/in_old?'))return c.old;
    if(route.startsWith('subscriptions/'))return c.sub;
    throw Error('Unexpected provider route '+route);
   }`,
  './market-payments':`
   export function marketServiceClient(){
    const c=globalThis.__marketCardEvent;
    return {
     from(table){return {table,filters:[],operation:'read',select(){return this},eq(field,value){this.filters.push([field,value]);return this},lte(){return this},
      update(values){this.operation='update';this.values=values;return this},upsert(values){this.operation='upsert';this.values=values;return this},
      async single(){return this.finish()},async maybeSingle(){return this.finish()},
      finish(){
       const id=this.filters.find(([field])=>field==='id')?.[1]??this.values?.id;
       if(this.operation==='read')return {data:table==='market_card_events'?c.events.get(id)??null:table==='market_card_purchases'?c.purchase:null,error:null};
       c.writes.push({table,operation:this.operation,values:this.values,filters:this.filters});
       if(table==='market_card_events')c.events.set(id,{...c.events.get(id),...this.values});
       return {data:null,error:null};
      },then(resolve,reject){return Promise.resolve(this.finish()).then(resolve,reject)}
     }},async rpc(name,args){c.applied.push({name,args});return {data:null,error:null}}
    };
   }`,
  './campaign-payments':`export async function fulfillCreditPayment(){throw Error('Unused campaign payment')}export async function expireCreditCheckout(){throw Error('Unused campaign checkout')}export async function fulfillCampaignCardSetup(){throw Error('Unused campaign setup')}`,
  './market-tax':`export async function recordMarketTaxInvoice(){throw Error('Unused automatic tax')}export function validateMarketTaxInvoice(){throw Error('Unused automatic tax')}`,
 };
 const output=await build({entryPoints:[path.join(root,'lib/market-card.ts')],bundle:true,write:false,platform:'node',format:'esm',
  plugins:[{name:'card-event-provider-boundary',setup(api){
   api.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
   api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'ts'}));
  }}]});
 return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
}

const routes=c=>c.calls.map(call=>call.route);
const applied=c=>c.applied.filter(call=>call.name==='market_card_apply');
const invoiceWrite=c=>c.writes.find(write=>write.table==='market_card_invoices');

test('real card event processing reconciles newer Stripe event shapes through pinned provider reads',async t=>{
 const card=await loadCard();
 try{
  await t.test('refund without invoice retrieves the charge before updating its invoice and paid access',async()=>{
   const c=fixture();globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.deepEqual(routes(c),['events/evt_refund','charges/ch_current','invoices/in_current?expand[]=payment_intent.latest_charge','subscriptions/sub_saved?expand[]=latest_invoice.payment_intent.latest_charge&expand[]=items.data.price.product']);
   assert.equal(invoiceWrite(c).values.refunded_cents,99);assert.equal(invoiceWrite(c).values.status,'refunded');
   assert.equal(applied(c).length,1);assert.equal(applied(c)[0].args.p_refunded,99);
   assert.equal(c.events.get(c.event.id).status,'processed');assert.ok(c.calls.every(call=>call.form===undefined));
  });
  await t.test('older refund event shape keeps its direct invoice path',async()=>{
   const c=fixture();c.event.data.object.invoice='in_current';globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.equal(routes(c).some(route=>route.startsWith('charges/')),false);
   assert.equal(invoiceWrite(c).values.refunded_cents,99);assert.equal(applied(c).length,1);
  });
  await t.test('invoice event without a top-level subscription resolves the authoritative invoice',async()=>{
   const c=fixture();c.event.type='invoice.paid';c.event.data.object={id:'in_current',parent:{subscription_details:{subscription:'sub_untrusted'}}};globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.equal(routes(c)[1],'invoices/in_current?expand[]=payment_intent.latest_charge');
   assert.equal(applied(c)[0].args.p_subscription,'sub_saved');assert.equal(c.events.get(c.event.id).status,'processed');
  });
  await t.test('unpaid invoice event refreshes subscription state without recording a paid old invoice',async()=>{
   const c=fixture();c.event.type='invoice.payment_failed';c.event.data.object={id:'in_current'};c.invoice.status='open';c.invoice.amount_paid=0;delete c.invoice.payment_intent;c.sub.status='past_due';globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.equal(invoiceWrite(c),undefined);assert.equal(applied(c).length,1);
   assert.equal(applied(c)[0].args.p_amount,null);assert.equal(applied(c)[0].args.p_until,null);assert.equal(applied(c)[0].args.p_status,'past_due');
   assert.equal(c.events.get(c.event.id).status,'processed');
  });
  await t.test('older invoice event shape keeps the direct subscription path',async()=>{
   const c=fixture();c.event.type='invoice.paid';c.event.data.object={id:'in_current',subscription:'sub_saved'};globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.equal(routes(c).some(route=>route.startsWith('invoices/')),false);assert.equal(applied(c).length,1);
  });
  await t.test('legitimate standalone charge refund has no subscription or entitlement to update',async()=>{
   const c=fixture();c.charge.invoice=null;globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.deepEqual(routes(c),['events/evt_refund','charges/ch_current']);assert.equal(invoiceWrite(c),undefined);assert.deepEqual(c.applied,[]);
   assert.equal(c.events.get(c.event.id).status,'processed');
  });
  await t.test('mismatched charge identity or test mode fails closed and remains retryable',async()=>{
   for(const change of [c=>{c.charge.id='ch_other'},c=>{c.charge.livemode=false},c=>{delete c.charge.invoice},c=>{c.charge.invoice={id:'in_current'}},c=>{c.charge.invoice=''},c=>{c.charge.invoice='in_bad/path'}]){
    const c=fixture();change(c);globalThis.__marketCardEvent=c;
    await assert.rejects(card.processCardEvent(c.event.id),/charge|invoice/i);
    assert.equal(c.events.get(c.event.id).status,'failed');assert.equal(c.events.get(c.event.id).attempts,1);
    assert.deepEqual(c.applied,[]);assert.equal(invoiceWrite(c),undefined);
    c.charge={id:'ch_current',livemode:true,invoice:'in_current'};
    await card.processCardEvent(c.event.id);
    assert.equal(c.events.get(c.event.id).status,'processed');assert.equal(c.events.get(c.event.id).attempts,2);assert.equal(applied(c).length,1);
   }
  });
  await t.test('failed pinned charge retrieval is not acknowledged as processed',async()=>{
   const c=fixture();c.failRoute='charges/ch_current';globalThis.__marketCardEvent=c;
   await assert.rejects(card.processCardEvent(c.event.id),/temporarily unavailable/);
   assert.equal(c.events.get(c.event.id).status,'failed');assert.deepEqual(c.applied,[]);
   delete c.failRoute;await card.processCardEvent(c.event.id);
   assert.equal(c.events.get(c.event.id).status,'processed');assert.equal(c.events.get(c.event.id).attempts,2);
  });
  await t.test('malformed refunded charge identifier never becomes a provider path',async()=>{
   const c=fixture();c.event.data.object.id='ch_bad/../other';globalThis.__marketCardEvent=c;
   await assert.rejects(card.processCardEvent(c.event.id),/Invalid refunded charge/);
   assert.deepEqual(routes(c),['events/evt_refund']);assert.equal(c.events.get(c.event.id).status,'failed');assert.deepEqual(c.applied,[]);
  });
  await t.test('newer old-invoice refund updates that invoice while applying the current invoice unchanged',async()=>{
   const c=fixture();c.charge.invoice='in_old';c.sub.latest_invoice.payment_intent.latest_charge.amount_refunded=0;globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.equal(invoiceWrite(c).values.refunded_cents,99);assert.ok(invoiceWrite(c).filters.some(([field,value])=>field==='id'&&value==='in_old'));
   assert.equal(applied(c)[0].args.p_invoice,'in_current');assert.equal(applied(c)[0].args.p_refunded,0);
  });
  await t.test('production still ignores test-mode events without writing or applying access',async()=>{
   const c=fixture();c.event.livemode=false;globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);
   assert.deepEqual(routes(c),['events/evt_refund']);assert.deepEqual(c.writes,[]);assert.deepEqual(c.applied,[]);
  });
  await t.test('already processed event delivery performs no new provider request or application',async()=>{
   const c=fixture();c.events.set(c.event.id,{status:'processed',attempts:1});globalThis.__marketCardEvent=c;
   await card.processCardEvent(c.event.id);assert.deepEqual(c.calls,[]);assert.deepEqual(c.writes,[]);assert.deepEqual(c.applied,[]);
  });
 }finally{delete globalThis.__marketCardEvent;}
});
