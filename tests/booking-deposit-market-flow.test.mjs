import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const salon='00000000-0000-4000-8000-000000000010';
const otherSalon='00000000-0000-4000-8000-000000000011';
const paidUntil=new Date(Date.now()+86400000).toISOString();
const stubs={
 'server-only':'',
 'next/cache':`export function revalidatePath(path){globalThis.depositFlow.paths.push(path)}`,
 '@/lib/current-context':`export async function getCurrentBusinessContext(){return {user:globalThis.depositFlow.guest?null:{id:'owner'}}}`,
 '@/lib/market-plugins':`export async function marketPluginContext(){const c=globalThis.depositFlow;if(c.denied)throw Error('Owner access required.');return {salonId:c.salon,client:{async rpc(name,args){c.installs.push({name,args});if(c.installError)return {error:c.installError};c.row.installed=args.p_installed;return {}}}}}`,
 '@/lib/market-payments':`export function marketServiceClient(){const c=globalThis.depositFlow;return {from(table){const q={filters:[],select(){return this},eq(k,v){this.filters.push([k,v]);return this},order(){return this},limit(){return this},async maybeSingle(){c.reads.push({table,filters:this.filters});return table==='market_card_purchases'?{data:c.purchase,error:c.readError}:{data:{...c.row}}}};return q}}} export async function marketStripe(path){const c=globalThis.depositFlow;c.provider.push(['legacy',path]);if(c.providerError)throw Error(c.providerError);return c.session;}`,
 '@/lib/platform-payment':`export async function paymentStripe(path){const c=globalThis.depositFlow;c.provider.push(['card',path]);if(c.providerError)throw Error(c.providerError);return c.session;}`,
 '@/lib/market-card':`export async function syncCardSubscription(id){const c=globalThis.depositFlow;c.synced.push(['card',id]);if(c.syncError)throw Error(c.syncError);if(c.verified)c.row.paid_until=c.verified;return Boolean(c.verified)}`,
 '@/lib/booking-deposit-subscription':`export async function syncBookingDepositSubscription(id){const c=globalThis.depositFlow;c.synced.push(['legacy',id]);if(c.verified)c.row.paid_until=c.verified;} export async function bookingDepositPayment(...args){globalThis.depositFlow.legacyStarts.push(args);return 'https://checkout.stripe.com/legacy';}`,
 '@/lib/market-bank-billing':`export async function marketBankBillingState(){return globalThis.depositFlow.billing;}`,
 '@/lib/booking-deposit-checkout':`export async function prepareBookingDepositCheckout(...args){globalThis.depositFlow.starts.push(args);return globalThis.depositFlow.checkout;}`,
};
const output=await build({entryPoints:['app/market/booking-deposit-purchase-actions.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'flow-isolation',setup(api){api.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'ts'}));}}]});
const actions=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
function fixture(overrides={}){
 return globalThis.depositFlow={salon,row:{installed:false,paid_until:null,stripe_subscription:null,stripe_checkout:null},purchase:null,billing:{available:true,settings:{version:1}},session:{status:'open'},checkout:{url:'https://checkout.stripe.com/pay'},reads:[],paths:[],installs:[],provider:[],synced:[],starts:[],legacyStarts:[],...overrides};
}

test('Add opens hosted checkout and never grants a free or test installation',async()=>{
 const c=fixture();const result=await actions.beginBookingDepositCheckoutAction(salon);
 assert.equal(result.url,'https://checkout.stripe.com/pay');assert.deepEqual(c.starts,[[salon]]);assert.deepEqual(c.installs,[]);
});
test('guests sign in; unauthorized owners and changed salon cannot reserve or install',async()=>{
 for(const options of [{guest:true},{denied:true},{salon:otherSalon}]){
  const c=fixture(options),result=await actions.beginBookingDepositCheckoutAction(salon);
  assert.ok(result.path?.startsWith('/login')||result.error);assert.deepEqual(c.starts,[]);assert.deepEqual(c.installs,[]);
 }
});
test('already-paid owners open settings without buying twice, including re-adding removed plugin',async()=>{
 for(const installed of [false,true]){
  const c=fixture({row:{paid_until:paidUntil,installed}}),result=await actions.beginBookingDepositCheckoutAction(salon);
  assert.equal(result.path,`/market/booking-deposit/settings?salon=${salon}`);assert.deepEqual(c.starts,[]);assert.equal(c.installs.length,installed?0:1);
 }
});
test('expired paid access cannot bypass checkout',async()=>{
 const c=fixture({row:{paid_until:'2000-01-01T00:00:00Z',installed:true}});
 assert.ok((await actions.beginBookingDepositCheckoutAction(salon)).url);assert.equal(c.starts.length,1);assert.deepEqual(c.installs,[]);
});
test('cancelled/open/completed-but-unpaid returns never open settings',async()=>{
 for(const session of [{status:'expired'},{status:'open'},{status:'complete',subscription:'sub_unpaid'}]){
  const c=fixture({purchase:{session_id:'cs_saved'},session}),result=await actions.confirmBookingDepositCheckoutAction(salon);
  assert.equal(result.pending,true);assert.equal(result.path,undefined);assert.deepEqual(c.installs,[]);
  assert.equal(c.reads.find(r=>r.table==='market_card_purchases').filters.some(([k,v])=>k==='salon_id'&&v===salon),true);
  assert.equal(c.reads.find(r=>r.table==='market_card_purchases').filters.some(([k,v])=>k==='plugin_id'&&v==='booking-deposit'),true);
 }
});
test('verified payment installs for the correct salon and redirects to deposit settings',async()=>{
 const c=fixture({purchase:{session_id:'cs_saved'},session:{status:'complete',subscription:'sub_paid'},verified:paidUntil});
 const result=await actions.confirmBookingDepositCheckoutAction(salon);
 assert.equal(result.path,`/market/booking-deposit/settings?salon=${salon}&confirmed=1`);
 assert.deepEqual(c.synced,[['card','sub_paid']]);assert.deepEqual(c.installs,[{name:'booking_deposit_install',args:{p_salon:salon,p_installed:true}}]);
 await actions.confirmBookingDepositCheckoutAction(salon);assert.equal(c.installs.length,1);assert.deepEqual(c.starts,[]);
});
test('wrong salon, unverifiable provider, and persistence failures fail closed',async()=>{
 for(const overrides of [{salon:otherSalon},{providerError:'Provider offline'},{syncError:'Price mismatch',session:{status:'complete',subscription:'sub_wrong'}},{verified:paidUntil,session:{status:'complete',subscription:'sub_paid'},installError:{message:'Temporary outage'}},{readError:{code:'NETWORK'}}]){
  const c=fixture({purchase:{session_id:'cs_saved'},...overrides});const result=await actions.confirmBookingDepositCheckoutAction(salon);
  assert.ok(result.error);assert.equal(result.path,undefined);if(!overrides.installError)assert.deepEqual(c.installs,[]);
 }
});
test('legacy checkout is still verified before installation',async()=>{
 const c=fixture({row:{installed:false,stripe_checkout:'cs_legacy'},session:{status:'complete',subscription:'sub_legacy'},verified:paidUntil,readError:{code:'42P01'}});
 assert.ok((await actions.confirmBookingDepositCheckoutAction(salon)).path);assert.deepEqual(c.synced,[['legacy','sub_legacy']]);assert.equal(c.installs.length,1);
});
test('provider unavailable does not create a checkout or installation',async()=>{
 const c=fixture({billing:{available:false,reason:'Unavailable',settings:{version:1}}});
 assert.equal((await actions.beginBookingDepositCheckoutAction(salon)).error,'Unavailable');assert.deepEqual(c.starts,[]);assert.deepEqual(c.installs,[]);
});
