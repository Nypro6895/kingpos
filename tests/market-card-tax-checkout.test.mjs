import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';

const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const salonId='00000000-0000-4000-8000-000000000010';
const purchaseId='00000000-0000-4000-8000-000000000020';

async function loadActions(){
 const mocks={
  '@/lib/market-plugins':`export async function marketPluginContext(){const c=globalThis.__marketCardCheckoutTest;if(c.denied)throw Error('Choose an active salon.');return{salonId:c.salonId,client:{async rpc(name,args){c.calls.push({name,args});return{data:c.row,error:c.reserveError}}}}}`,
  '@/lib/market-payments':`export function marketServiceClient(){const c=globalThis.__marketCardCheckoutTest;return{from(table){const query={update(values){c.updates.push({table,values,filters:[]});return this},eq(column,value){c.updates.at(-1).filters.push({column,value});return this},in(column,values){c.updates.at(-1).filters.push({column,values});return this},then(resolve,reject){return Promise.resolve({error:c.storageError}).then(resolve,reject)}};return query}}}`,
  '@/lib/platform-payment':`export async function paymentConfig(){return globalThis.__marketCardCheckoutTest.config} export async function paymentStripe(path,form,key,config){const c=globalThis.__marketCardCheckoutTest;c.provider.push({path,form:form?Object.fromEntries(form):null,key,accountId:config?.accountId});if(c.providerError)throw Error(c.providerError);return path==='checkout/sessions'?{id:'cs_same',client_secret:'cs_same_secret'}:c.session}`,
  '@/lib/market-card':`export async function syncCardSubscription(id){globalThis.__marketCardCheckoutTest.synced.push(id);return true}`,
  '@/lib/market-tax':`export async function applyMarketTaxToCheckout(form,purchase){const c=globalThis.__marketCardCheckoutTest;c.taxCalls.push({purchase:structuredClone(purchase),before:Object.fromEntries(form)});if(c.taxError)throw Error(c.taxError);const tax=purchase.snapshot.automatic_tax;if(tax?.enabled===true){form.set('automatic_tax[enabled]','true');form.set('billing_address_collection','required');if(form.has('customer'))form.set('customer_update[address]','auto');form.set('line_items[0][price_data][product_data][tax_code]',tax.tax_code);form.set('line_items[0][price_data][tax_behavior]',tax.price_behavior)}}`,
  'next/cache':`export function revalidatePath(path){globalThis.__marketCardCheckoutTest.paths.push(path)}`,
 };
 const out=await build({entryPoints:[path.join(root,'app/market/card-payment-actions.ts')],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':root},plugins:[{name:'checkout-fixtures',setup(api){
  api.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'stub'}:args.path==='server-only'?{path:'server-only',namespace:'stub'}:undefined);
  api.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:mocks[args.path]||'',loader:'ts'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}

function fixture(overrides={}){
 return {
  salonId,config:{enabled:true,mode:'live',webhookSecret:'whsec_test',publishableKey:'pk_live_test',accountId:'acct_current'},
  row:{id:purchaseId,salon_id:salonId,plugin_id:'booking-policy',amount_cents:1210,created_at:new Date().toISOString(),snapshot:{name:'Frozen booking rules',price_cents:1000,fee_bps:1000,fixed_fee_cents:110,tax_bps:750,automatic_tax:{enabled:true,price_behavior:'exclusive',tax_code:'txcd_10103000',currency:'usd',account_id:'acct_current',version:3},currency:'usd',account_id:'acct_current',catalog_version:4,settings_version:9}},
  calls:[],provider:[],taxCalls:[],updates:[],synced:[],paths:[],session:{id:'cs_same',status:'open',client_secret:'cs_same_secret'},
  ...overrides,
 };
}

test('actual Market card action applies frozen tax terms before embedded subscription checkout',async t=>{
 const actions=await loadActions();
 try{
  await t.test('automatic tax uses the reserved pre-tax amount and collects the billing address',async()=>{
   const c=fixture();globalThis.__marketCardCheckoutTest=c;
   const result=await actions.startCardCheckout('booking-policy');
   assert.deepEqual(result,{clientSecret:'cs_same_secret',publishableKey:'pk_live_test'});
   assert.deepEqual(c.calls,[{name:'market_card_reserve',args:{p_salon:salonId,p_plugin:'booking-policy'}}]);
   assert.equal(c.taxCalls.length,1);assert.deepEqual(c.taxCalls[0].purchase,c.row);
   const request=c.provider[0];assert.equal(request.path,'checkout/sessions');assert.equal(request.key,`market-card:${purchaseId}`);
   assert.equal(request.form.mode,'subscription');assert.equal(request.form.ui_mode,'embedded');
   assert.equal(request.form['line_items[0][price_data][unit_amount]'],'1210');
   assert.equal(request.form['automatic_tax[enabled]'],'true');assert.equal(request.form.billing_address_collection,'required');
   assert.equal(request.form['line_items[0][price_data][tax_behavior]'],'exclusive');assert.equal(request.form['line_items[0][price_data][product_data][tax_code]'],'txcd_10103000');
   assert.equal(request.form['saved_payment_method_options[payment_method_save]'],'enabled');
   assert.equal(request.form['customer_update[address]'],undefined);
   assert.match(request.form['line_items[0][price_data][product_data][description]'],/billing address/);
   assert.doesNotMatch(request.form['line_items[0][price_data][product_data][description]'],/includes configured tax/);
   assert.equal(Object.keys(request.form).some(key=>/tax_rates|tax_amount|line_items\[1\]/.test(key)),false);
   assert.deepEqual(c.updates,[{table:'market_card_purchases',values:{session_id:'cs_same',status:'open'},filters:[{column:'id',value:purchaseId},{column:'status',value:'creating'}]}]);
  });
  await t.test('saved customer is present before tax setup and remains eligible to save a new card',async()=>{
   const c=fixture();c.row.snapshot.customer_id='cus_owner';c.row.snapshot.customer_email='owner@example.test';globalThis.__marketCardCheckoutTest=c;
   await actions.startCardCheckout('booking-policy');const form=c.provider[0].form;
   assert.equal(c.taxCalls[0].before.customer,'cus_owner');assert.equal(form.customer,'cus_owner');assert.equal(form.customer_email,undefined);
   assert.equal(form['customer_update[address]'],'auto');assert.equal(form['saved_payment_method_options[payment_method_save]'],'enabled');
  });
  await t.test('new customer email and inclusive tax come from the frozen purchase',async()=>{
   const c=fixture();c.config.automaticTax=false;c.config.taxBehavior='exclusive';c.row.snapshot.automatic_tax.price_behavior='inclusive';c.row.snapshot.customer_email='owner@example.test';globalThis.__marketCardCheckoutTest=c;
   await actions.startCardCheckout('booking-policy');const form=c.provider[0].form;
   assert.equal(form.customer_email,'owner@example.test');assert.equal(form.customer,undefined);assert.equal(form['customer_update[address]'],undefined);
   assert.equal(form['automatic_tax[enabled]'],'true');assert.equal(form['line_items[0][price_data][tax_behavior]'],'inclusive');assert.equal(form['line_items[0][price_data][unit_amount]'],'1210');
   assert.equal(c.taxCalls[0].purchase.snapshot.settings_version,9);
  });
  await t.test('manual tax keeps the previously reserved total and original description',async()=>{
   const c=fixture();c.row.amount_cents=1293;c.row.snapshot.automatic_tax={enabled:false};globalThis.__marketCardCheckoutTest=c;
   await actions.startCardCheckout('booking-policy');const form=c.provider[0].form;
   assert.equal(c.taxCalls.length,1);assert.equal(form['line_items[0][price_data][unit_amount]'],'1293');
   assert.equal(form['automatic_tax[enabled]'],undefined);assert.equal(form['line_items[0][price_data][tax_behavior]'],undefined);assert.equal(form.billing_address_collection,undefined);
   assert.match(form['line_items[0][price_data][product_data][description]'],/Total includes configured tax and fees/);
   assert.equal(form['saved_payment_method_options[payment_method_save]'],'enabled');
  });
  await t.test('tax readiness and merchant mismatch errors prevent provider creation and access',async()=>{
   for(const taxError of ['Stripe Tax is not ready for this account.','Saved tax configuration belongs to another payment account.']){
    const c=fixture({taxError});globalThis.__marketCardCheckoutTest=c;
    assert.deepEqual(await actions.startCardCheckout('booking-policy'),{message:taxError});
    assert.equal(c.taxCalls.length,1);assert.deepEqual(c.provider,[]);assert.deepEqual(c.updates,[]);assert.deepEqual(c.synced,[]);
   }
  });
  await t.test('owner authorization and live provider readiness remain mandatory before reserving',async()=>{
   for(const overrides of [{denied:true},{config:{enabled:false,mode:'live',webhookSecret:'whsec_test'}},{config:{enabled:true,mode:'test',webhookSecret:'whsec_test'}},{config:{enabled:true,mode:'live',webhookSecret:''}}]){
    const c=fixture(overrides);globalThis.__marketCardCheckoutTest=c;assert.ok((await actions.startCardCheckout('booking-policy')).message);
    assert.deepEqual(c.calls,[]);assert.deepEqual(c.provider,[]);assert.deepEqual(c.taxCalls,[]);
   }
  });
  await t.test('existing session is recovered without changing its frozen provider tax configuration',async()=>{
   const c=fixture({taxError:'New configuration is not ready.'});c.row.session_id='cs_saved';globalThis.__marketCardCheckoutTest=c;
   assert.deepEqual(await actions.startCardCheckout('booking-policy'),{clientSecret:'cs_same_secret',publishableKey:'pk_live_test'});
   assert.deepEqual(c.taxCalls,[]);assert.equal(c.provider.length,1);assert.equal(c.provider[0].path,'checkout/sessions/cs_saved');assert.equal(c.provider[0].form,null);assert.deepEqual(c.updates,[]);
  });
  await t.test('lost storage acknowledgement retries the same immutable session idempotency key',async()=>{
   const c=fixture({storageError:{message:'Connection lost'}});globalThis.__marketCardCheckoutTest=c;
   assert.match((await actions.startCardCheckout('booking-policy')).message,/reserved.*same payment/);
   c.storageError=null;assert.ok((await actions.startCardCheckout('booking-policy')).clientSecret);
   assert.equal(c.provider.length,2);assert.equal(c.provider[0].key,c.provider[1].key);assert.deepEqual(c.provider[0].form,c.provider[1].form);
   assert.equal(c.synced.length,0);
  });
  await t.test('confirmed provider sessions follow subscription reconciliation rather than starting another payment',async()=>{
   const c=fixture({taxError:'Tax changed.'});c.row.session_id='cs_saved';c.session={status:'complete',subscription:'sub_verified'};globalThis.__marketCardCheckoutTest=c;
   assert.equal((await actions.startCardCheckout('booking-policy')).complete,true);assert.deepEqual(c.synced,['sub_verified']);assert.deepEqual(c.paths,['/market']);assert.deepEqual(c.taxCalls,[]);
   assert.equal(c.provider.length,1);assert.equal(c.provider[0].form,null);
  });
 }finally{delete globalThis.__marketCardCheckoutTest;}
});
