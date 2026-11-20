import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('existing provider reconciliation enforces Check Writer invoice/account/salon/price and refund facts (provider responses are fixtures)',async()=>{
 await build({entryPoints:['lib/market-card.ts'],outfile:'work/check-writer-readiness/provider.cjs',bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'isolated-provider-fixtures',setup(b){const mocks={
 'server-only':'',
 './market-payments':`export function marketServiceClient(){return globalThis.cwProvider.service}`,
 './platform-payment':`export async function paymentConfig(){return {accountId:'acct_fixture'}}export async function paymentStripe(){return globalThis.cwProvider.subscription}`,
 './campaign-payments':`export async function fulfillCreditPayment(){}export async function expireCreditCheckout(){}export async function fulfillCampaignCardSetup(){}`,
 './market-tax':`export async function recordMarketTaxInvoice(){throw Error('Unexpected tax path')}export function validateMarketTaxInvoice(){return false}`};b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
 const {syncCardSubscription}=require('../work/check-writer-readiness/provider.cjs');
 function fixture(){const calls=[];const purchase={id:'purchase_fixture',salon_id:'salon_fixture',plugin_id:'print-check',amount_cents:490,snapshot:{account_id:'acct_fixture'}};const subscription={id:'sub_fixture',metadata:{market_card_purchase:purchase.id,salon_id:purchase.salon_id,plugin_id:'print-check'},customer:'cus_fixture',livemode:true,status:'active',current_period_end:Math.floor(Date.now()/1000)+86400,items:{data:[{quantity:1,price:{unit_amount:490,currency:'usd',recurring:{interval:'month',interval_count:1}}}]},latest_invoice:{id:'in_fixture',status:'paid',amount_paid:490,payment_intent:{id:'pi_fixture',status:'succeeded',amount_received:490,currency:'usd',latest_charge:{amount_refunded:0}}}};
 const q={select(){return q},eq(){return q},async single(){return {data:purchase,error:null}}};globalThis.cwProvider={subscription,service:{from(){return q},async rpc(name,args){calls.push({name,args});return {error:null}}}};return {subscription,calls}}
 try{
  let f=fixture();assert.equal(await syncCardSubscription('sub_fixture'),true);assert.equal(f.calls[0].args.p_amount,490);assert.equal(f.calls[0].args.p_status,'active');
  const tamper=[s=>s.livemode=false,s=>s.metadata.salon_id='other',s=>s.metadata.plugin_id='other',s=>s.items.data[0].price.unit_amount=491,s=>s.items.data[0].quantity=2,s=>s.items.data[0].price.currency='eur',s=>s.items.data[0].price.recurring.interval='year',s=>s.latest_invoice.amount_paid=491,s=>s.latest_invoice.payment_intent.status='processing',s=>s.latest_invoice.payment_intent.amount_received=489,s=>s.current_period_end=0];
  for(const change of tamper){f=fixture();change(f.subscription);await assert.rejects(syncCardSubscription('sub_fixture'));assert.equal(f.calls.length,0)}
  f=fixture();f.subscription.latest_invoice.status='open';assert.equal(await syncCardSubscription('sub_fixture'),false);assert.equal(f.calls[0].args.p_amount,null);assert.equal(f.calls[0].args.p_until,null);
  f=fixture();f.subscription.latest_invoice.payment_intent.latest_charge.amount_refunded=490;assert.equal(await syncCardSubscription('sub_fixture'),false);assert.equal(f.calls[0].args.p_refunded,490);
 }finally{delete globalThis.cwProvider}
});
