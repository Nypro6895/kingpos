import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({entryPoints:['app/market/card-payment-actions.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'provider-boundaries',setup(api){
 const stubs={
  '@/lib/market-plugins':`export async function marketPluginContext(){const f=globalThis.marketRecovery;return {salonId:'salon_a',client:{async rpc(name){f.reserves.push(name);return {data:f.purchase}}}}}`,
  '@/lib/market-payments':`export function marketServiceClient(){return {from(){globalThis.marketRecovery.databaseWrites++;throw Error('No purchase replacement is allowed')}}}`,
  '@/lib/platform-payment':`export async function paymentConfig(){return {enabled:true,mode:'live',webhookSecret:'fixture'}}export async function paymentStripe(path,form){const f=globalThis.marketRecovery;f.providerCalls.push({path,write:Boolean(form)});if(path==='checkout/sessions/cs_saved'&&!form)return f.session;throw Error('No new or expired checkout is allowed')}`,
  '@/lib/market-card':`export async function syncCardSubscription(id){const f=globalThis.marketRecovery;f.synced.push(id);return f.paid}`,
  '@/lib/check-writer-readiness':`export function checkWriterSalesReady(){return false}`,
  '@/lib/market-tax':`export async function applyMarketTaxToCheckout(){throw Error('No new quote is allowed')}`,
  'next/cache':`export function revalidatePath(){}`,
 };
 api.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'fixture'}:undefined);
 api.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'ts'}));
}}]});
const {startCardCheckout}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture({paid=false,linked=true,status='open',mode='hosted',sessionSubscription='sub_saved'}={}){
 globalThis.marketRecovery={paid,reserves:[],synced:[],providerCalls:[],databaseWrites:0,
  purchase:{id:'purchase_a',subscription_id:linked?'sub_saved':null,session_id:'cs_saved',snapshot:{checkout_ui_mode:mode}},
  session:{status,subscription:sessionSubscription,url:'https://checkout.stripe.com/c/pay/saved',client_secret:'secret_saved'}};
 return globalThis.marketRecovery;
}
function noReplacement(f){assert.equal(f.reserves.length,1);assert.equal(f.databaseWrites,0);assert.equal(f.providerCalls.some(c=>c.write),false);}
test('verified active paid subscription completes without creating or replacing Checkout',async()=>{
 const f=fixture({paid:true});const result=await startCardCheckout('booking-policy',true);
 assert.equal(result.complete,true);assert.deepEqual(f.synced,['sub_saved']);assert.deepEqual(f.providerCalls,[]);noReplacement(f);
});
test('incomplete unpaid subscription reopens its exact saved hosted Checkout without claiming completion',async()=>{
 const f=fixture();const result=await startCardCheckout('booking-policy',true);
 assert.equal(result.checkoutUrl,f.session.url);assert.notEqual(result.complete,true);assert.deepEqual(f.synced,['sub_saved']);
 assert.deepEqual(f.providerCalls,[{path:'checkout/sessions/cs_saved',write:false}]);noReplacement(f);
});
test('completed Checkout with an unpaid subscription remains pending, including a newly observed subscription',async()=>{
 for(const linked of[false,true]){const f=fixture({linked,status:'complete'});const result=await startCardCheckout('booking-policy',true);
  assert.notEqual(result.complete,true);assert.equal(result.checkoutUrl,undefined);assert.match(result.message,/No active paid access/);assert.deepEqual(f.synced,['sub_saved']);noReplacement(f);}
});
test('completed Checkout becomes complete only after a fresh paid subscription confirmation',async()=>{
 const f=fixture({linked:false,status:'complete',paid:true});const result=await startCardCheckout('booking-policy',true);
 assert.equal(result.complete,true);assert.deepEqual(f.synced,['sub_saved']);noReplacement(f);
});
test('expired Checkout with a linked or observed subscription never creates a replacement subscription',async()=>{
 for(const linked of[false,true]){const f=fixture({linked,status:'expired'});const result=await startCardCheckout('booking-policy',true);
  assert.notEqual(result.complete,true);assert.equal(result.checkoutUrl,undefined);assert.match(result.message,/existing subscription/);noReplacement(f);}
});
test('an unpaid linked embedded checkout remains usable on web and cannot be replaced from Safari',async()=>{
 let f=fixture({mode:'embedded'});let result=await startCardCheckout('booking-policy',false);assert.equal(result.clientSecret,'secret_saved');assert.notEqual(result.complete,true);noReplacement(f);
 f=fixture({mode:'embedded'});result=await startCardCheckout('booking-policy',true);assert.equal(result.checkoutUrl,undefined);assert.notEqual(result.complete,true);assert.match(result.message,/existing subscription/);noReplacement(f);
});
