import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const built=await build({entryPoints:['lib/booking-deposit-checkout.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'provider-boundaries',setup(api){
 const stubs={
  'server-only':'',
  '@/lib/market-plugins':`export async function marketPluginContext(){const f=globalThis.depositRecovery;return {salonId:'salon_a',client:{async rpc(name,args){f.reserves.push({name,args});return {data:f.purchase}}}}}`,
  '@/lib/market-payments':`export function marketServiceClient(){return {from(){globalThis.depositRecovery.databaseWrites++;throw Error('No purchase replacement is allowed')}}}`,
  '@/lib/platform-payment':`export async function paymentConfig(){return {enabled:true,mode:'live',webhookSecret:'fixture'}}export async function paymentStripe(path,form){const f=globalThis.depositRecovery;f.providerCalls.push({path,write:Boolean(form)});if(path==='checkout/sessions/cs_saved'&&!form)return f.session;throw Error('No new or expired checkout is allowed')}`,
  '@/lib/market-card':`export async function syncCardSubscription(id){const f=globalThis.depositRecovery;f.synced.push(id);return f.paid}`,
  '@/lib/market-tax':`export async function applyMarketTaxToCheckout(){throw Error('No new quote is allowed')}`,
  '@/lib/reylumi-config':`export const REYLUMI_METADATA_BASE='https://reylumi.test'`,
 };
 api.onResolve({filter:/.*/},a=>Object.hasOwn(stubs,a.path)?{path:a.path,namespace:'fixture'}:undefined);
 api.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'ts'}));
}}]});
const {prepareBookingDepositCheckout}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function fixture({paid=false,linked=true,status='open',mode='hosted',sessionSubscription='sub_saved',successUrl='https://reylumi.test/market/booking-deposit/payment?salon=salon_a'}={}){
 return globalThis.depositRecovery={paid,reserves:[],synced:[],providerCalls:[],databaseWrites:0,
  purchase:{id:'purchase_a',subscription_id:linked?'sub_saved':null,session_id:'cs_saved'},
  session:{status,ui_mode:mode,subscription:sessionSubscription,success_url:successUrl,url:'https://checkout.stripe.com/c/pay/saved'}};
}
function noReplacement(f){assert.equal(f.databaseWrites,0);assert.equal(f.providerCalls.some(c=>c.write),false);assert.equal(f.reserves.every(r=>r.name==='market_card_reserve'&&r.args.p_salon==='salon_a'&&r.args.p_plugin==='booking-deposit'),true);}

test('dedicated Deposit checkout reuses its exact saved hosted session after an incomplete unpaid subscription',async()=>{
 const f=fixture();for(let n=0;n<2;n++){const result=await prepareBookingDepositCheckout('salon_a');assert.equal(result.url,f.session.url);assert.notEqual(result.complete,true);}
 assert.deepEqual(f.synced,['sub_saved','sub_saved']);assert.equal(f.reserves.length,2);assert.equal(f.providerCalls.length,2);noReplacement(f);
});
test('dedicated Deposit completes only from an authoritative active paid subscription',async()=>{
 let f=fixture({paid:true});assert.equal((await prepareBookingDepositCheckout('salon_a')).complete,true);assert.deepEqual(f.providerCalls,[]);noReplacement(f);
 f=fixture({linked:false,status:'complete',paid:true});assert.equal((await prepareBookingDepositCheckout('salon_a')).complete,true);assert.deepEqual(f.synced,['sub_saved']);noReplacement(f);
 for(const linked of[false,true]){f=fixture({linked,status:'complete'});await assert.rejects(prepareBookingDepositCheckout('salon_a'),/No active paid access/);assert.deepEqual(f.synced,['sub_saved']);noReplacement(f);}
});
test('dedicated Deposit never replaces or expires a linked or provider-observed subscription',async()=>{
 for(const linked of[false,true])for(const state of[{status:'expired'},{mode:'embedded'},{successUrl:'https://reylumi.test/wrong-return'}]){const f=fixture({linked,...state});await assert.rejects(prepareBookingDepositCheckout('salon_a'),/existing subscription/);noReplacement(f);}
});
test('dedicated Deposit recovery retains salon and trusted checkout URL checks',async()=>{
 let f=fixture();await assert.rejects(prepareBookingDepositCheckout('salon_b'),/salon changed/);assert.deepEqual(f.reserves,[]);assert.deepEqual(f.providerCalls,[]);
 f=fixture({linked:false,sessionSubscription:null});assert.equal((await prepareBookingDepositCheckout('salon_a')).url,f.session.url);noReplacement(f);
 f=fixture();f.session.url='https://checkout.stripe.com.evil.test/c/pay/forged';await assert.rejects(prepareBookingDepositCheckout('salon_a'),/Payment could not open/);noReplacement(f);
});
