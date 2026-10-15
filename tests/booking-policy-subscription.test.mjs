import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['lib/booking-policy-subscription.ts'], bundle: true, write: false, format: 'esm', platform: 'node', plugins: [{ name: 'payment-test', setup(b) {
 b.onResolve({ filter: /^(server-only|@\/lib\/market-plugins|@\/lib\/market-payments|@\/lib\/reylumi-config)$/ }, args => ({ path: args.path, namespace: 'mock' }));
 b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'server-only' ? '' : args.path.endsWith('market-plugins') ? 'export async function marketPluginContext(){return {salonId: globalThis.receiptSalon}}' : args.path.endsWith('reylumi-config') ? 'export const REYLUMI_METADATA_BASE="https://reylumi.com";' : `
 export function marketServiceClient(){
  const chain={select(){return this},eq(){return this},single:async()=>({data:globalThis.receiptRow}),maybeSingle:async()=>({data:globalThis.receiptRow}),update(value){globalThis.receiptUpdate=value;return this},insert:async()=>({}),then(resolve){resolve({})}};
  return {from(){return chain}};
 }
 export async function marketStripe(path,form,key){globalThis.receiptStripeRequest={path,form,key};return globalThis.receiptStripe;}
 export async function assertLegacyMarketCheckoutAllowed(){}
 export function marketPaymentReady(){return true;}export async function marketPaymentSettings(){return {enabled:true};}
 ` }));
} }] });
const payment = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const salon='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
test('Booking rules billing verifies $0.99 monthly USD entitlement and preserves salon/payer linkage', async () => {
 const subscription={metadata:{reylumi_plugin:'booking-policy',salon_id:salon,owner_id:owner},status:'active',latest_invoice:{status:'paid'},customer:'cus_test',items:{data:[{quantity:1,current_period_end:1900000000,price:{unit_amount:99,currency:'usd',recurring:{interval:'month',interval_count:1}}}]}};
 globalThis.receiptRow={payment_owner:owner,stripe_subscription:null};globalThis.receiptStripe=structuredClone(subscription);
 await payment.syncBookingPolicySubscription('sub_test');
 assert.equal(globalThis.receiptUpdate.stripe_subscription,'sub_test');assert.equal(globalThis.receiptUpdate.paid_until,new Date(1900000000000).toISOString());
 globalThis.receiptStripe.latest_invoice.status='open';await payment.syncBookingPolicySubscription('sub_test');assert.equal(globalThis.receiptUpdate.paid_until,null);globalThis.receiptStripe.latest_invoice.status='paid';
 globalThis.receiptStripe.items.data[0].price.unit_amount=47;
 await assert.rejects(payment.syncBookingPolicySubscription('sub_test'),/price/);
 globalThis.receiptStripe=structuredClone(subscription);globalThis.receiptRow.payment_owner=salon;
 await assert.rejects(payment.syncBookingPolicySubscription('sub_test'),/linked/);
 globalThis.receiptRow={payment_owner:owner,stripe_subscription:'sub_other'};
 await assert.rejects(payment.syncBookingPolicySubscription('sub_test'),/linked/);
 globalThis.receiptRow.stripe_subscription='sub_test';globalThis.receiptStripe.status='canceled';
 await payment.syncBookingPolicySubscription('sub_test');assert.equal(globalThis.receiptUpdate.stripe_subscription,null);assert.equal(globalThis.receiptUpdate.stripe_checkout,null);
 await assert.rejects(payment.syncBookingPolicySubscription('../subscriptions'),/Invalid/);
});
test('Booking rules checkout reuses an open session and waits for payment confirmation', async () => {
 globalThis.receiptRow={stripe_subscription:null,stripe_checkout:'cs_test',payment_owner:owner};
 globalThis.receiptStripe={status:'open',url:'https://checkout.stripe.com/test'};
 assert.equal(await payment.bookingPolicyPayment(salon,owner,false),'https://checkout.stripe.com/test');
 assert.equal(globalThis.receiptStripeRequest.path,'checkout/sessions/cs_test');
 globalThis.receiptStripe.status='complete';
 await assert.rejects(payment.bookingPolicyPayment(salon,owner,false),/confirmed/);
 await assert.rejects(payment.bookingPolicyPayment(salon,salon,false),/Another owner/);
});
test('Booking rules checkout charges 99 cents monthly and uses its reserved checkout identity',async()=>{
 globalThis.receiptRow={stripe_subscription:null,stripe_checkout:null,payment_owner:owner,checkout_reference:'reserved-checkout'};
 globalThis.receiptStripe={id:'cs_new',url:'https://checkout.stripe.com/new'};
 await payment.bookingPolicyPayment(salon,owner,false);
 const {form,key}=globalThis.receiptStripeRequest;
 assert.equal(form.get('line_items[0][price_data][unit_amount]'),'99');
 assert.equal(form.get('line_items[0][price_data][recurring][interval]'),'month');
 assert.equal(form.get('subscription_data[metadata][salon_id]'),salon);
 assert.equal(form.get('subscription_data[metadata][owner_id]'),owner);
 assert.match(key,/reserved-checkout/);
});
