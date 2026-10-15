import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {createRequire} from 'node:module';

const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const purchaseId='00000000-0000-4000-8000-000000000010',salonId='00000000-0000-4000-8000-000000000020';
const rate={id:'txr_state',country:'US',state:'CA',jurisdiction:'California',tax_type:'sales_tax',percentage:10};
function bill(id='in_current',refund=0){return {id,subscription:'sub_saved',status:'paid',livemode:true,currency:'usd',total:1100,amount_paid:1100,total_excluding_tax:1000,automatic_tax:{enabled:true,status:'complete'},total_tax_amounts:[{amount:100,tax_rate:rate}],customer_address:{country:'US',state:'CA'},created:1700000000,status_transitions:{paid_at:1700000100},payment_intent:{id:id==='in_old'?'pi_old':'pi_current',status:'succeeded',currency:'usd',amount_received:1100,latest_charge:{amount:1100,amount_refunded:refund}}};}
function fixture(){
 const purchase={id:purchaseId,salon_id:salonId,plugin_id:'booking-policy',subscription_id:'sub_saved',amount_cents:1000,snapshot:{account_id:'acct_saved',automatic_tax:{enabled:true,price_behavior:'exclusive',tax_code:'txcd_10103000'}}};
 return {purchase,config:{accountId:'acct_saved',enabled:true,mode:'live'},sub:{id:'sub_saved',status:'active',customer:'cus_saved',livemode:true,current_period_end:Math.floor(Date.now()/1000)+30*86400,metadata:{market_card_purchase:purchaseId,salon_id:salonId,plugin_id:'booking-policy'},automatic_tax:{enabled:true},items:{data:[{quantity:1,price:{unit_amount:1000,currency:'usd',recurring:{interval:'month',interval_count:1},tax_behavior:'exclusive',product:{tax_code:'txcd_10103000'}}}]},latest_invoice:bill()},old:bill('in_old'),savedInvoice:{id:'in_old',status:'paid',amount_cents:1100,payment_intent:'pi_old',market_card_purchases:{subscription_id:'sub_saved',snapshot:purchase.snapshot}},notes:[],refunds:[],event:{id:'evt_old',type:'charge.refunded',livemode:true,data:{object:{id:'ch_old',invoice:'in_old'}}},provider:[],rpc:[],writes:[],sequence:[],auth:[],paths:[]};
}
async function loadReconciliation(){
 const service=`export function marketServiceClient(){const c=globalThis.__marketTaxReconcile;return{from(table){const q={table,filters:[],operation:'read',select(){return this},eq(column,value){this.filters.push({column,value});return this},lte(column,value){this.filters.push({column,value});return this},in(column,value){this.filters.push({column,value});return this},update(values){this.operation='update';this.values=values;return this},upsert(values){this.operation='upsert';this.values=values;return this},insert(values){this.operation='insert';this.values=values;return this},async single(){return this.finish()},async maybeSingle(){return this.finish()},finish(){if(this.operation!=='read'){c.writes.push({table,operation:this.operation,values:this.values,filters:this.filters});c.sequence.push('write:'+table+':'+(this.filters.find(f=>f.column==='id')?.value??this.values?.id??''));return{data:null,error:null}}c.sequence.push('read:'+table);return{data:table==='market_card_purchases'?c.purchase:table==='market_card_invoices'?c.savedInvoice:table==='market_card_events'?c.priorEvent??null:null,error:null}},then(resolve,reject){return Promise.resolve(this.finish()).then(resolve,reject)}};return q},async rpc(name,args){c.rpc.push({name,args});c.sequence.push(name==='market_tax_record_invoice'?'tax:'+args.p_invoice.invoice_id:'apply:'+args.p_invoice);return{data:{recorded:true},error:name==='market_tax_record_invoice'?c.taxError??null:c.applyError??null}}}}`;
 const provider=`export async function paymentConfig(){return globalThis.__marketTaxReconcile.config} export async function paymentStripe(path,form,key){const c=globalThis.__marketTaxReconcile;c.provider.push({path,form:form?Object.fromEntries(form):null,key});c.sequence.push('provider:'+path+(form?':POST':':GET'));if(path.startsWith('subscriptions/'))return c.sub;if(path.startsWith('invoices/in_old?'))return c.old;if(path.startsWith('events/'))return c.event;if(path==='credit_notes'){c.old.payment_intent.latest_charge.amount_refunded=1100;c.refunds=[{id:'re_old',status:'succeeded',amount:1100,created:1700000300}];c.notes=[{id:'cn_old',created:1700000400,status:'issued',type:'post_payment',currency:'usd',invoice:'in_old',refund:'re_old',amount:1100,out_of_band_amount:null,tax_amounts:[{amount:100,tax_rate:'txr_state'}]}];return{id:'cn_old',created:1700000400,status:'issued'}}if(path==='refunds'){c.old.payment_intent.latest_charge.amount_refunded=1100;return{id:'re_old',status:'succeeded'}}if(path.startsWith('refunds?'))return{data:c.refunds,has_more:false};if(path.startsWith('credit_notes?'))return{data:c.notes,has_more:false};throw Error('Unexpected provider call '+path)} export function encryptPayment(){return 'encrypted'} export function publicPayment(){return{}} export const PAYMENT_WEBHOOK='https://reylumi.com/api/payments/webhook';`;
 const auth=`export async function requirePlatformAdmin(permission){const c=globalThis.__marketTaxReconcile;c.auth.push(permission);if(c.denied)throw Error('Admin access required.');return{roleSlug:c.roleSlug??'platform_owner',userId:'admin_user'}}`;
 const permissions=`export const PLATFORM_ADMIN_PERMISSIONS={teamManage:'team.manage'}`;
 const mocks={
  './market-payments':service,'@/lib/market-payments':service,'./platform-payment':provider,'@/lib/platform-payment':provider,
  './platform-admin/auth':auth,'@/lib/platform-admin/auth':auth,'./platform-admin/permissions':permissions,'@/lib/platform-admin/permissions':permissions,
  './supabase/server':`export async function createAuthenticatedSupabaseServerClient(){return null}`,
  './campaign-payments':`export async function fulfillCreditPayment(){} export async function expireCreditCheckout(){}`,
  'next/navigation':`export function notFound(){throw Error('Not found.')}`,
  'next/cache':`export function revalidatePath(path){globalThis.__marketTaxReconcile.paths.push(path)}`,
 };
 const out=await build({stdin:{resolveDir:root,loader:'ts',contents:`export {syncCardSubscription,syncCardInvoice,processCardEvent} from './lib/market-card';export {refundCardInvoice} from './app/(app)/admin/market/system-actions';`},bundle:true,write:false,platform:'node',format:'esm',alias:{'@':root},plugins:[{name:'real-reconciliation-fixtures',setup(api){api.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'stub'}:args.path==='server-only'?{path:'server-only',namespace:'stub'}:undefined);api.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:mocks[args.path]||'',loader:'ts'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
function refundForm(){const form=new FormData();form.set('invoice_id','in_old');form.set('reason','Customer requested cancellation');return form;}

test('actual card reconciliation and admin refunds preserve verified automatic tax',async t=>{
 const card=await loadReconciliation();
 try{
  await t.test('taxed gross can differ from the frozen pre-tax price and tax is recorded before access',async()=>{
   const c=fixture();globalThis.__marketTaxReconcile=c;assert.equal(await card.syncCardSubscription('sub_saved'),true);
   const tax=c.rpc.find(call=>call.name==='market_tax_record_invoice'),apply=c.rpc.find(call=>call.name==='market_card_apply');
   assert.equal(tax.args.p_invoice.subtotal_cents,1000);assert.equal(tax.args.p_invoice.amount_cents,1100);assert.equal(tax.args.p_invoice.tax_cents,100);
   assert.equal(apply.args.p_amount,1100);assert.equal(apply.args.p_invoice,'in_current');assert.equal(apply.args.p_customer,'cus_saved');
   assert.ok(c.sequence.indexOf('tax:in_current')<c.sequence.indexOf('apply:in_current'));
   assert.equal(c.provider[0].path,'subscriptions/sub_saved?expand[]=latest_invoice.payment_intent.latest_charge&expand[]=items.data.price.product');
  });
  await t.test('tax behavior, product code or automatic-tax subscription mismatch denies access',async()=>{
   for(const change of [c=>{c.sub.items.data[0].price.tax_behavior='inclusive'},c=>{c.sub.items.data[0].price.product.tax_code='txcd_10000000'},c=>{c.sub.automatic_tax.enabled=false}]){
    const c=fixture();change(c);globalThis.__marketTaxReconcile=c;await assert.rejects(card.syncCardSubscription('sub_saved'),/tax terms/);assert.deepEqual(c.rpc,[]);
   }
   const c=fixture();c.sub.items.data[0].price.product.tax_code={id:'txcd_10103000'};globalThis.__marketTaxReconcile=c;assert.equal(await card.syncCardSubscription('sub_saved'),true);
  });
  await t.test('failure to record verified tax does not grant plugin access',async()=>{
   const c=fixture();c.taxError={message:'Storage unavailable'};globalThis.__marketTaxReconcile=c;await assert.rejects(card.syncCardSubscription('sub_saved'),/tax could not be recorded/);
   assert.equal(c.rpc.some(call=>call.name==='market_card_apply'),false);
  });
  await t.test('manual-tax subscriptions retain their original fixed payment verification',async()=>{
   const c=fixture();c.purchase.snapshot.automatic_tax={enabled:false};c.purchase.amount_cents=1100;c.sub.items.data[0].price.unit_amount=1100;c.sub.automatic_tax.enabled=false;globalThis.__marketTaxReconcile=c;
   assert.equal(await card.syncCardSubscription('sub_saved'),true);assert.equal(c.rpc.length,1);assert.equal(c.rpc[0].name,'market_card_apply');assert.equal(c.rpc[0].args.p_amount,1100);
   c.sub.latest_invoice.payment_intent.amount_received=1099;await assert.rejects(card.syncCardSubscription('sub_saved'),/reconciliation/);
  });
  await t.test('older-invoice charge refund is recorded before refreshing the current paid subscription',async()=>{
   const c=fixture();c.old.payment_intent.latest_charge.amount_refunded=550;globalThis.__marketTaxReconcile=c;await card.processCardEvent('evt_old');
   const oldTax=c.rpc.find(call=>call.name==='market_tax_record_invoice'&&call.args.p_invoice.invoice_id==='in_old');assert.equal(oldTax.args.p_invoice.refunded_cents,550);assert.equal('refund_tax_breakdown' in oldTax.args.p_invoice,false);
   const taxOld=c.sequence.indexOf('tax:in_old'),taxCurrent=c.sequence.indexOf('tax:in_current'),applyCurrent=c.sequence.indexOf('apply:in_current');assert.ok(taxOld>=0&&taxOld<taxCurrent&&taxCurrent<applyCurrent);
   const saved=c.writes.find(write=>write.table==='market_card_invoices');assert.equal(saved.values.refunded_cents,550);assert.equal(saved.values.status,'partially_refunded');assert.ok(saved.filters.some(f=>f.column==='id'&&f.value==='in_old'));
   assert.ok(c.writes.some(write=>write.table==='market_card_events'&&write.values.status==='processed'));assert.equal(c.rpc.find(call=>call.name==='market_card_apply').args.p_refunded,0);
  });
  await t.test('issued credit-note event sends its older invoice tax credit to the same ledger',async()=>{
   const c=fixture();c.old.payment_intent.latest_charge.amount_refunded=550;c.refunds=[{id:'re_old',status:'succeeded',amount:550,created:1700000300}];c.notes=[{id:'cn_old',created:1700000400,status:'issued',type:'post_payment',currency:'usd',invoice:'in_old',refund:'re_old',amount:550,tax_amounts:[{amount:50,tax_rate:'txr_state'}]}];c.event.type='credit_note.created';c.event.data.object={id:'cn_old',invoice:'in_old'};globalThis.__marketTaxReconcile=c;
   await card.processCardEvent('evt_old');const value=c.rpc.find(call=>call.name==='market_tax_record_invoice'&&call.args.p_invoice.invoice_id==='in_old').args.p_invoice;
   assert.deepEqual(value.refund_tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:50}]);assert.ok(c.sequence.indexOf('tax:in_old')<c.sequence.indexOf('apply:in_current'));
  });
  await t.test('prepayment credit-note events on unpaid invoices create no old cash/tax ledger entry',async()=>{
   const c=fixture();c.old.status='open';c.old.amount_paid=0;delete c.old.payment_intent;c.event.type='credit_note.created';c.event.data.object={id:'cn_prepaid',invoice:'in_old',type:'pre_payment'};globalThis.__marketTaxReconcile=c;
   assert.equal(await card.syncCardInvoice('in_old'),'sub_saved');assert.deepEqual(c.rpc,[]);assert.deepEqual(c.writes,[]);
   await card.processCardEvent('evt_old');assert.equal(c.rpc.some(call=>call.name==='market_tax_record_invoice'&&call.args.p_invoice.invoice_id==='in_old'),false);assert.equal(c.writes.some(write=>write.table==='market_card_invoices'&&write.filters.some(filter=>filter.value==='in_old')),false);
   assert.equal(c.provider.some(call=>call.path.startsWith('refunds?')||call.path.startsWith('credit_notes?')),false);assert.ok(c.writes.some(write=>write.table==='market_card_events'&&write.values.status==='processed'));
  });
  await t.test('several successful refunds with only one issued credit note keep uncovered gross visible',async()=>{
   const c=fixture();c.old.payment_intent.latest_charge.amount_refunded=550;c.refunds=[{id:'re_with_note',status:'succeeded',amount:275,created:1700000300},{id:'re_without_note',status:'succeeded',amount:275,created:1700000400}];c.notes=[{id:'cn_partial',created:1700000500,status:'issued',type:'post_payment',currency:'usd',invoice:'in_old',refund:'re_with_note',amount:275,tax_amounts:[{amount:25,tax_rate:'txr_state'}]}];globalThis.__marketTaxReconcile=c;
   await card.processCardEvent('evt_old');const value=c.rpc.find(call=>call.name==='market_tax_record_invoice'&&call.args.p_invoice.invoice_id==='in_old').args.p_invoice;
   assert.equal(value.refunded_cents,550);assert.equal(value.refunds_reconciled_cents,275);assert.ok(value.refunds_reconciled_cents<value.refunded_cents);assert.deepEqual(value.refund_tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:25}]);
  });
  await t.test('duplicate credit-note links exceeding the actual successful refund fail closed',async()=>{
   const c=fixture();c.old.payment_intent.latest_charge.amount_refunded=275;c.refunds=[{id:'re_same',status:'succeeded',amount:275,created:1700000300}];const note={created:1700000400,status:'issued',type:'post_payment',currency:'usd',invoice:'in_old',refund:'re_same',amount:275,tax_amounts:[{amount:25,tax_rate:'txr_state'}]};c.notes=[{...note,id:'cn_first'},{...note,id:'cn_duplicate'}];globalThis.__marketTaxReconcile=c;
   await assert.rejects(card.processCardEvent('evt_old'),/exceed.*refund evidence/);assert.deepEqual(c.rpc,[]);assert.ok(c.writes.some(write=>write.table==='market_card_events'&&write.values.status==='failed'));assert.equal(c.sequence.some(step=>step==='apply:in_current'),false);
  });
  await t.test('full taxed admin refund issues an idempotent credit note and synchronizes old and current invoices',async()=>{
   const c=fixture();globalThis.__marketTaxReconcile=c;assert.equal((await card.refundCardInvoice(refundForm())).ok,true);
   const issued=c.provider.find(call=>call.path==='credit_notes'&&call.form);assert.deepEqual(issued.form,{invoice:'in_old',amount:'1100',refund_amount:'1100',reason:'order_change',memo:'Customer requested cancellation','metadata[admin_reason]':'Customer requested cancellation'});assert.equal(issued.key,'market-full-credit:in_old');
   assert.equal(c.provider.some(call=>call.path==='refunds'&&call.form),false);const cancellation=c.provider.find(call=>call.path==='subscriptions/sub_saved'&&call.form);assert.equal(cancellation.form.cancel_at_period_end,'true');assert.equal(cancellation.key,'market-refund-cancel:in_old');
   const oldTax=c.rpc.find(call=>call.name==='market_tax_record_invoice'&&call.args.p_invoice.invoice_id==='in_old');assert.deepEqual(oldTax.args.p_invoice.refund_tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:100}]);assert.equal(oldTax.args.p_invoice.refunded_cents,1100);
   assert.ok(c.sequence.indexOf('tax:in_old')<c.sequence.indexOf('apply:in_current'));assert.equal(c.rpc.find(call=>call.name==='market_card_apply').args.p_refunded,0);
   assert.ok(c.writes.some(write=>write.table==='market_system_audit'&&write.values.action==='payment.refund'));assert.deepEqual(c.paths,['/admin/market','/admin/settings','/market']);
   await card.refundCardInvoice(refundForm());assert.equal(c.provider.filter(call=>call.path==='credit_notes'&&call.form).every(call=>call.key==='market-full-credit:in_old'),true);
  });
  await t.test('manual admin refund retains raw card-refund API and stable refund idempotency',async()=>{
   const c=fixture();c.purchase.snapshot.automatic_tax={enabled:false};c.savedInvoice.market_card_purchases.snapshot=c.purchase.snapshot;c.purchase.amount_cents=1100;c.sub.items.data[0].price.unit_amount=1100;globalThis.__marketTaxReconcile=c;
   assert.equal((await card.refundCardInvoice(refundForm())).ok,true);const refund=c.provider.find(call=>call.path==='refunds'&&call.form);assert.equal(refund.key,'market-full-refund:in_old');assert.equal(refund.form.payment_intent,'pi_old');assert.equal(refund.form.amount,'1100');
   assert.equal(c.provider.some(call=>call.path==='credit_notes'&&call.form),false);assert.equal(c.rpc.some(call=>call.name==='market_tax_record_invoice'),false);
  });
  await t.test('unauthenticated and non-owner admins cannot create a refund',async()=>{
   for(const values of [{denied:true},{roleSlug:'platform_operator'}]){const c=fixture();Object.assign(c,values);globalThis.__marketTaxReconcile=c;await assert.rejects(card.refundCardInvoice(refundForm()));assert.deepEqual(c.provider,[]);assert.deepEqual(c.rpc,[]);assert.deepEqual(c.writes,[]);assert.deepEqual(c.auth,['team.manage']);}
  });
 }finally{delete globalThis.__marketTaxReconcile;}
});

test('actual CardCheckoutPanel excludes legacy flat tax from automatic inclusive/exclusive fees',async()=>{
 const out=await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {CardCheckoutPanel} from './app/market/card-checkout-panel';export function render(billingState,automaticTax){return renderToStaticMarkup(<CardCheckoutPanel pluginId="booking-policy" pluginName="Booking Rules" billingState={billingState} hasActiveSubscription={false} ready={true} automaticTax={automaticTax} onStateChange={()=>{}}/>);}`},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',alias:{'@':root},plugins:[{name:'isolate-card-panel',setup(api){api.onResolve({filter:/^(next\/navigation|@stripe\/stripe-js|.*card-payment-actions)$/},args=>({path:args.path,namespace:'stub'}));api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`export function useRouter(){return{refresh(){}}}export async function loadStripe(){throw Error('Not used')}export async function startCardCheckout(){throw Error('Not used')}export async function refreshCardPurchase(){throw Error('Not used')}`,loader:'ts'}));}}]});
 const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(createRequire(path.join(root,'package.json')),module,module.exports);const panel=module.exports;
 const billing={settings:{tax_bps:5000,fee_bps:1000,fixed_fee_cents:20},catalog:[{plugin_id:'booking-policy',price_cents:1000,published:true,fulfillment_ready:true}]};
 const text=html=>html.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&');
 const exclusive=text(panel.render(billing,{enabled:true,price_behavior:'exclusive'}));assert.match(exclusive,/\$11\.20 \/ month \+ applicable tax/);assert.match(exclusive,/Price \$10\.00 · Fees \$1\.20/);assert.doesNotMatch(exclusive,/\$16\.70|Tax \$5\.00/);
 const inclusive=text(panel.render(billing,{enabled:true,price_behavior:'inclusive'}));assert.match(inclusive,/\$11\.20 \/ month/);assert.match(inclusive,/Applicable tax is included/);assert.doesNotMatch(inclusive,/\+ applicable tax|\$16\.70|Tax \$5\.00/);
 const manual=text(panel.render(billing,{enabled:false,price_behavior:'exclusive'}));assert.match(manual,/\$16\.70 \/ month/);assert.match(manual,/Price \$10\.00 · Tax \$5\.00 · Fees \$1\.70/);
});
