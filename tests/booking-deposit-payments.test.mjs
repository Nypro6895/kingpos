import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';
const bundle=await build({entryPoints:['lib/booking-deposit.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'deposit-mocks',setup(b){
 b.onResolve({filter:/^(server-only|@\/lib\/(market-payments|market-plugins|supabase\/server|reylumi-config))$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='server-only'?'':a.path.endsWith('reylumi-config')?'export const REYLUMI_METADATA_BASE="https://reylumi.com";':a.path.endsWith('market-plugins')?'export async function marketPluginContext(){return {salonId:globalThis.depositOrder.salon_id}}':a.path.endsWith('supabase/server')?'export async function createSupabaseServerClient(){return {rpc:async()=>({data:globalThis.depositSettings})}}':`
 export async function marketPaymentSettings(){return {booking_deposit_test_enabled:false}};export function marketServiceClient(){return {from(table){let mutation,allowed;const chain={select(){return this},eq(){return this},in(field,values){allowed=values;return this},update(value){mutation=value;return this},single:async()=>({data:structuredClone(globalThis.depositOrder)}),then(resolve){if(mutation&&(!allowed||allowed.includes(globalThis.depositOrder.status)))Object.assign(globalThis.depositOrder,mutation);resolve({})}};return chain;},async rpc(name,args){if(name === "booking_deposit_record_payment"){const o=globalThis.depositOrder;o.stripe_intent=args.p_intent;o.receipt_url=args.p_receipt;o.refunded_cents=Math.max(o.refunded_cents,args.p_refunded);if(o.refunded_cents===o.amount_cents)o.status="refunded";else if(["pending","expired"].includes(o.status))o.status="paid";return {data:{booking_id:o.booking_id,refunded_cents:o.refunded_cents}};}globalThis.depositRpcCalls++;if(globalThis.depositReject){globalThis.depositOrder.status='refund_pending';return {data:{refund:true}}}globalThis.depositOrder.result={booking_id:'booking',manage_token:'token',status:'confirmed'};globalThis.depositOrder.booking_id='booking';return {data:globalThis.depositOrder.result};}}}
 `}));
}}]});
const payment=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const id='00000000-0000-4000-8000-000000000003';
test('Verify paid USD amount and connected account before finalizing; reserve refunds and retry them safely',async()=>{
 const original=globalThis.fetch;process.env.BOOKING_STRIPE_SECRET_KEY='test-secret';
 const seed=()=>{globalThis.depositOrder={id,salon_id:id,stripe_session:'cs_test',stripe_account:'acct_test',status:'pending',amount_cents:2000,refunded_cents:0};globalThis.depositRpcCalls=0;globalThis.depositReject=false;};
 let session={status:'complete',payment_status:'paid',currency:'usd',amount_total:2000,metadata:{booking_deposit_order:id},payment_intent:{id:'pi_test',status:'succeeded',currency:'usd',amount_received:2000,latest_charge:{receipt_url:'https://pay.stripe.com/receipts/test',amount_refunded:0}}};
 const requests=[];
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json(url.includes('/refunds')?{status:'succeeded'}:session)};
 try{
  seed();await payment.syncBookingDeposit(id,'acct_test');assert.equal(globalThis.depositRpcCalls,1);assert.equal(globalThis.depositOrder.status,'paid');assert.equal(globalThis.depositOrder.receipt_url,'https://pay.stripe.com/receipts/test');assert.equal(requests[0].options.headers['Stripe-Account'],'acct_test');
  seed();await assert.rejects(payment.syncBookingDeposit(id,'acct_other'),/mismatch/);assert.equal(globalThis.depositRpcCalls,0);
  for(const override of [{amount_total:1999},{currency:'eur'},{metadata:{booking_deposit_order:'other'}},{payment_intent:{...session.payment_intent,amount_received:1999}},{payment_intent:{...session.payment_intent,status:'processing'}}]){
   seed();const prior=session;session={...session,...override};await assert.rejects(payment.syncBookingDeposit(id),/mismatch|Verified/);assert.equal(globalThis.depositRpcCalls,0);session=prior;
  }
  seed();session.payment_status='unpaid';await payment.syncBookingDeposit(id);assert.equal(globalThis.depositRpcCalls,0);session.payment_status='paid';
  seed();globalThis.depositReject=true;await payment.syncBookingDeposit(id);assert.equal(globalThis.depositOrder.status,'refunded');assert.equal(globalThis.depositOrder.refunded_cents,2000);
  const refund=requests.find(r=>r.url.includes('/refunds'));assert.equal(refund.options.headers['Idempotency-Key'],`booking-refund:${id}`);assert.equal(new URLSearchParams(refund.options.body).get('payment_intent'),'pi_test');
 }finally{globalThis.fetch=original;delete process.env.BOOKING_STRIPE_SECRET_KEY;}
});
test('Webhook signatures reject stale, missing and forged signatures',()=>{
 process.env.BOOKING_STRIPE_WEBHOOK_SECRET='test-signature';const payload='{"type":"checkout.session.completed"}',stamp=Math.floor(Date.now()/1000);
 const digest=createHmac('sha256','test-signature').update(`${stamp}.${payload}`).digest('hex');
 assert.equal(payment.verifyDepositWebhook(payload,`t=${stamp},v1=${digest}`),true);
 assert.equal(payment.verifyDepositWebhook(payload+' ',`t=${stamp},v1=${digest}`),false);
 assert.equal(payment.verifyDepositWebhook(payload,`t=${stamp-301},v1=${digest}`),false);
 assert.equal(payment.verifyDepositWebhook(payload,''),false);delete process.env.BOOKING_STRIPE_WEBHOOK_SECRET;
});


