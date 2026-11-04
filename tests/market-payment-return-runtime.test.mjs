import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(file,stubs){
 const out=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'mock',setup(api){
  api.onResolve({filter:/.*/},args=>args.path==='server-only'||stubs[args.path]?{path:args.path,namespace:'mock'}:undefined);
  api.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:stubs[args.path]??'',loader:'ts'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
test('trial mutations reject a changed salon before invoking the database',async()=>{
 globalThis.marketTrialCalls=[];
 try{
  const {marketTrialAction}=await load('app/market/trial-actions.ts',{
   '@/lib/market-plugins':`export async function marketPluginContext(){return {salonId:'salon_a',client:{async rpc(name,args){globalThis.marketTrialCalls.push(args);return {data:{started:true,active:true}}}}}}`,
   '@/lib/check-writer-readiness':`export function checkWriterTrialReady(){return false}`,
   '@/lib/market-payments':`export function marketServiceClient(){throw Error('This generic trial must not use the service boundary')}`,
   'next/cache':`export function revalidatePath(){}`,
  });
  assert.match((await marketTrialAction('booksms',true,'salon_b')).error,/salon changed/);
  assert.match((await marketTrialAction('booksms',true)).error,/salon changed/);
  assert.equal(globalThis.marketTrialCalls.length,0);
  assert.equal((await marketTrialAction('booksms',true,'salon_a')).state.active,true);
  assert.deepEqual(globalThis.marketTrialCalls,[{p_salon:'salon_a',p_plugin:'booksms',p_start:true}]);
 }finally{delete globalThis.marketTrialCalls;}
});
test('payment return reconciles only current salon saved purchases; failed providers do not block siblings',async()=>{
 globalThis.marketReturnFixture={rows:[{plugin_id:'booksms',session_id:'cs_sms'},{plugin_id:'booksms',subscription_id:'sub_old'},{plugin_id:'tax-company',subscription_id:'sub_tax'},{plugin_id:'booking-policy',session_id:'cs_open'}],scopes:[],synced:[],calls:[]};
 const f=globalThis.marketReturnFixture;
 try{
  const {reconcileMarketPaymentReturn}=await load('lib/market-payment-return.ts',{
   '@/lib/market-plugins':`export async function marketPluginContext(){return {salonId:'salon_a'}}`,
   '@/lib/market-payments':`export function marketServiceClient(){const f=globalThis.marketReturnFixture;return {from(){const q={select(){return q},eq(key,value){f.scopes.push([key,value]);return q},in(){return q},order(){return q},async limit(){return {data:f.rows}}};return q}}}`,
   '@/lib/platform-payment':`export async function paymentStripe(path){globalThis.marketReturnFixture.calls.push(path);return path.includes('cs_sms')?{status:'complete',subscription:'sub_sms'}:{status:'open',subscription:'sub_incomplete'}}`,
   '@/lib/market-card':`export async function syncCardSubscription(id){globalThis.marketReturnFixture.synced.push(id);if(id==='sub_tax')throw Error('provider unavailable');}`,
  });
  await assert.rejects(reconcileMarketPaymentReturn('salon_b'),/salon changed/); assert.equal(f.scopes.length,0);
  await reconcileMarketPaymentReturn('salon_a');
  assert.deepEqual(f.scopes,[['salon_id','salon_a']]);
  assert.deepEqual(f.synced.sort(),['sub_sms','sub_tax']);
  assert.deepEqual(f.calls.sort(),['checkout/sessions/cs_open','checkout/sessions/cs_sms']);
 }finally{delete globalThis.marketReturnFixture;}
});

test('billing portal checks current salon, original payer, provider account and trusted URL',async()=>{
 globalThis.marketPortalFixture={payer:'owner_a',account:'acct_a',url:'https://billing.stripe.com/p/session/demo',calls:[]};
 const f=globalThis.marketPortalFixture;
 try{
  const {manageCardSubscription}=await load('app/market/card-payment-actions.ts',{
   '@/lib/market-plugins':`export async function marketPluginContext(){return {salonId:'salon_a',userId:'owner_a'}}`,
   '@/lib/market-payments':`export function marketServiceClient(){const f=globalThis.marketPortalFixture;return {from(){const q={select(){return q},eq(){return q},not(){return q},order(){return q},limit(){return q},async maybeSingle(){return {data:{payer_id:f.payer,customer_id:'cus_a',snapshot:{account_id:f.account}}}}};return q}}}`,
   '@/lib/platform-payment':`export async function paymentConfig(){return {accountId:'acct_a',portalConfigurationId:'bpc_a'}} export async function paymentStripe(path,form){const f=globalThis.marketPortalFixture;f.calls.push({path,form:Object.fromEntries(form)});return {url:f.url}}`,
   '@/lib/market-card':`export async function syncCardSubscription(){}`,
   '@/lib/market-tax':`export async function applyMarketTaxToCheckout(){}`,
   'next/cache':`export function revalidatePath(){}`,
  });
  f.payer='owner_b'; assert.match((await manageCardSubscription('booksms')).error,/payer/); assert.equal(f.calls.length,0);
  f.payer='owner_a';f.account='acct_b';assert.match((await manageCardSubscription('booksms')).error,/payer/);assert.equal(f.calls.length,0);
  f.account='acct_a';assert.equal((await manageCardSubscription('booksms')).url,f.url);
  assert.deepEqual(f.calls[0].form,{customer:'cus_a',return_url:'https://reylumi.com/market',configuration:'bpc_a'});
  f.url='https://billing.stripe.com.evil.test/';assert.match((await manageCardSubscription('booksms')).error,/could not open/);
 }finally{delete globalThis.marketPortalFixture;}
});
