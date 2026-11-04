import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {build} from 'esbuild';
const compiled=await build({entryPoints:['lib/market-platform/stripe-test.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {testPaymentConfig,verifyTestWebhook,checkoutForm,providerRedirect}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const env={MARKET_PLATFORM_STRIPE_TEST_KEY:'sk_test_synthetic',MARKET_PLATFORM_STRIPE_TEST_WEBHOOK_SECRET:'whsec_synthetic',MARKET_PLATFORM_STRIPE_TEST_ACCOUNT:'acct_synthetic',MARKET_PLATFORM_TEST_ORIGIN:'http://localhost:4328'};
test('commerce cannot accept live keys, live origins or missing configuration',()=>{
 assert.throws(()=>testPaymentConfig({}));assert.throws(()=>testPaymentConfig({...env,MARKET_PLATFORM_STRIPE_TEST_KEY:'sk_live_secret'}));assert.throws(()=>testPaymentConfig({...env,MARKET_PLATFORM_TEST_ORIGIN:'https://reylumi.com'}));assert.equal(testPaymentConfig(env).origin,'http://localhost:4328');
});
test('signed test webhooks require raw bytes, valid timestamp, correct HMAC and test mode',()=>{
 const timestamp=1793163600,body=JSON.stringify({id:'evt_synthetic',livemode:false,type:'checkout.session.completed'}),secret='whsec_synthetic';
 const sign=value=>`t=${timestamp},v1=${createHmac('sha256',secret).update(`${timestamp}.${value}`).digest('hex')}`;
 assert.equal(verifyTestWebhook(body,sign(body),secret,timestamp*1000).id,'evt_synthetic');
 assert.throws(()=>verifyTestWebhook(body+' ',sign(body),secret,timestamp*1000));assert.throws(()=>verifyTestWebhook(body,sign(body),secret,(timestamp+301)*1000));assert.throws(()=>verifyTestWebhook(body,sign(body),secret,(timestamp-301)*1000));
 const live=body.replace('false','true');assert.throws(()=>verifyTestWebhook(live,sign(live),secret,timestamp*1000));assert.throws(()=>verifyTestWebhook(body,sign(body)+`,t=${timestamp}`,secret,timestamp*1000));
});
test('Checkout uses frozen quote and destination transfer, without browser-supplied pricing or account',()=>{
 const quote={id:'order',salon_id:'salon',version_id:'version',buyer_id:'buyer',account_id:'acct_seller',amount_cents:1000,fee_cents:100,name:'Synthetic app'};
 const form=checkoutForm(quote,testPaymentConfig(env));assert.equal(form.get('payment_intent_data[transfer_data][destination]'),'acct_seller');assert.equal(form.get('line_items[0][price_data][unit_amount]'),'1000');assert.equal(form.get('payment_intent_data[application_fee_amount]'),'100');assert.equal(form.get('client_reference_id'),'order');
 assert.throws(()=>checkoutForm({...quote,fee_cents:1001},testPaymentConfig(env)));
 assert.throws(()=>providerRedirect('https://checkout.stripe.com.evil.com/test','checkout'));assert.throws(()=>providerRedirect('https://user@connect.stripe.com/test','onboarding'));assert.equal(providerRedirect('https://connect.stripe.com/test','onboarding'),'https://connect.stripe.com/test');
});
