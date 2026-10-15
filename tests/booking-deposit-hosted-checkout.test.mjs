import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const salon='00000000-0000-4000-8000-000000000010';
const success=`https://reylumi.com/market/booking-deposit/payment?salon=${salon}`;
const mocks={
 'server-only':'',
 '@/lib/market-plugins':`export async function marketPluginContext(){const c=globalThis.hostedDeposit;if(c.denied)throw Error('Owner required');return{salonId:c.salon,client:{async rpc(name,args){c.reservations.push({name,args});return{data:c.rows[Math.min(c.reservations.length-1,c.rows.length-1)]}}}}}`,
 '@/lib/market-payments':`export function marketServiceClient(){const c=globalThis.hostedDeposit;return{from(table){return{update(value){c.updates.push({table,value,filters:[]});return this},eq(k,v){c.updates.at(-1).filters.push([k,v]);return this},in(k,v){c.updates.at(-1).filters.push([k,v]);return this},then(resolve){resolve({error:c.saveError})}}}}}`,
 '@/lib/platform-payment':`export async function paymentConfig(){return globalThis.hostedDeposit.config}export async function paymentStripe(path,form,key){const c=globalThis.hostedDeposit;c.calls.push({path,form:form?Object.fromEntries(form):null,key});if(path.endsWith('/expire')){if(c.expireError)throw Error(c.expireError);return{status:c.expireStatus}}return path==='checkout/sessions'?c.created:c.session;}`,
 '@/lib/market-card':`export async function syncCardSubscription(id){globalThis.hostedDeposit.synced.push(id);return globalThis.hostedDeposit.paid}`,
 '@/lib/market-tax':`export async function applyMarketTaxToCheckout(form,row){globalThis.hostedDeposit.tax.push(row.id);if(row.snapshot.automatic_tax?.enabled)form.set('automatic_tax[enabled]','true');}`,
 '@/lib/reylumi-config':`export const REYLUMI_METADATA_BASE='https://reylumi.com';`,
};
const bundled=await build({entryPoints:['lib/booking-deposit-checkout.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'provider-fixture',setup(api){api.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'ts'}));}}]});
const {prepareBookingDepositCheckout}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function row(extra={}){return {id:'purchase_1',amount_cents:679,created_at:new Date().toISOString(),snapshot:{name:'Booking Deposit',customer_id:'cus_saved',automatic_tax:{enabled:true}},...extra};}
function fixture(overrides={}){return globalThis.hostedDeposit={salon,config:{enabled:true,mode:'live',webhookSecret:'fixture'},rows:[row()],created:{id:'cs_new',url:'https://checkout.stripe.com/pay/new'},session:{status:'open',ui_mode:'hosted',success_url:success,url:'https://checkout.stripe.com/pay/resume'},expireStatus:'expired',calls:[],reservations:[],updates:[],synced:[],tax:[],paid:false,...overrides};}
test('Booking Deposit opens one hosted subscription with frozen price/tax and salon-bound return',async()=>{
 const c=fixture();assert.deepEqual(await prepareBookingDepositCheckout(salon),{url:c.created.url});
 const call=c.calls[0];assert.equal(call.form.ui_mode,'hosted');assert.equal(call.form.mode,'subscription');assert.equal(call.form.success_url,success);assert.equal(call.form.cancel_url,'https://reylumi.com/market/booking-deposit?cancelled=1');
 assert.equal(call.form['line_items[0][price_data][unit_amount]'],'679');assert.equal(call.form['line_items[0][price_data][recurring][interval]'],'month');assert.equal(call.form['automatic_tax[enabled]'],'true');assert.equal(call.form.customer,'cus_saved');assert.equal(call.form['subscription_data[metadata][salon_id]'],salon);assert.equal(call.form['subscription_data[metadata][plugin_id]'],'booking-deposit');assert.equal(call.key,'market-card:purchase_1');assert.deepEqual(c.tax,['purchase_1']);
});
test('an open checkout is resumed without a second purchase',async()=>{
 const c=fixture({rows:[row({session_id:'cs_open'})]});assert.equal((await prepareBookingDepositCheckout(salon)).url,c.session.url);assert.equal(c.calls.length,1);assert.deepEqual(c.updates,[]);
});
test('older embedded checkout is expired before a fresh hosted reservation',async()=>{
 const c=fixture({rows:[row({session_id:'cs_old'}),row({id:'purchase_2'})],session:{status:'open',ui_mode:'embedded'}});
 assert.ok((await prepareBookingDepositCheckout(salon)).url);assert.deepEqual(c.calls.map(c=>c.path),['checkout/sessions/cs_old','checkout/sessions/cs_old/expire','checkout/sessions']);assert.equal(c.calls[2].key,'market-card:purchase_2');assert.equal(c.updates[0].value.status,'expired');
});
test('failed expiration or concurrently completed payment cannot create a second checkout',async()=>{
 for(const extra of [{expireError:'Already paid'},{expireStatus:'complete'},{session:{status:'complete',subscription:'sub_pending'}}]){
  const c=fixture({rows:[row({session_id:'cs_old'})],session:{status:'open',ui_mode:'embedded'},...extra});
  try {const result=await prepareBookingDepositCheckout(salon);assert.equal(result.complete,false);}catch(error){assert.ok(error.message);}
  assert.equal(c.calls.some(x=>x.path==='checkout/sessions'),false);assert.deepEqual(c.updates,[]);
 }
});
test('only verified paid subscriptions are complete; lost persistence retries the same idempotency key',async()=>{
 for(const paid of [false,true]){
  const c=fixture({rows:[row({subscription_id:'sub_existing'})],paid});assert.equal((await prepareBookingDepositCheckout(salon)).complete,paid);assert.deepEqual(c.calls,[]);
 }
 const c=fixture({saveError:{message:'Offline'}});await assert.rejects(prepareBookingDepositCheckout(salon),/same payment/);c.saveError=null;await prepareBookingDepositCheckout(salon);assert.equal(c.calls[0].key,c.calls[1].key);assert.deepEqual(c.calls[0].form,c.calls[1].form);
});
test('authorization, changed salons and inactive payment configuration block reservation',async()=>{
 for(const overrides of [{denied:true},{salon:'other'},{config:{enabled:false}},{config:{enabled:true,mode:'test',webhookSecret:'fixture'}}]){
  const c=fixture(overrides);await assert.rejects(prepareBookingDepositCheckout(salon));assert.deepEqual(c.reservations,[]);
 }
});
test('untrusted redirect hosts never reach the browser',async()=>{
 for(const url of ['https://checkout.stripe.com.evil.test/pay','http://checkout.stripe.com/pay','https://user@checkout.stripe.com/pay']){
  fixture({created:{id:'cs_new',url}});await assert.rejects(prepareBookingDepositCheckout(salon),/could not open/);
 }
});
