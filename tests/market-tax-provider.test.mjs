import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';

const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const accountId='acct_live';
const taxCode='txcd_10103000';
const taxRate={id:'txr_state',country:'US',state:'CA',jurisdiction:'California',tax_type:'sales_tax',percentage:10};

async function loadTax(){
 const mocks={
  './platform-admin/auth':`export async function requirePlatformAdmin(){const c=globalThis.__marketTaxProviderTest;if(c.denied)throw Error('Access denied.');return{roleSlug:c.roleSlug||'platform_owner'}}`,
  './platform-admin/permissions':`export const PLATFORM_ADMIN_PERMISSIONS={teamManage:'team.manage'}`,
  './supabase/server':`export async function createAuthenticatedSupabaseServerClient(){return{async rpc(name,args){const c=globalThis.__marketTaxProviderTest;c.authCalls.push({name,args});return{data:{},error:null}}}}`,
  './market-payments':`export function marketServiceClient(){return{async rpc(name,args){const c=globalThis.__marketTaxProviderTest;c.records.push({name,args});return{data:{recorded:true},error:c.storageError}}}}`,
  './platform-payment':`export async function paymentConfig(){return globalThis.__marketTaxProviderTest.config} export async function paymentStripe(path,form,key,config){const c=globalThis.__marketTaxProviderTest;c.providerCalls.push({path,method:form?'POST':'GET',accountId:config?.accountId});if(c.providerError)throw Error(c.providerError);if(path==='account')return c.account;if(path==='tax/settings')return c.settings;if(path.startsWith('tax/registrations?'))return c.registrations;if(path.startsWith('tax_rates/'))return c.rates[path.slice(10)];if(path.startsWith('refunds?'))return c.refunds;if(path.startsWith('credit_notes?'))return c.notes;throw Error('Unexpected provider endpoint '+path)}`,
  'next/navigation':`export function notFound(){throw Error('Not found')}`,
 };
 const out=await build({entryPoints:[path.join(root,'lib/market-tax.ts')],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':root},plugins:[{name:'isolate-tax-provider',setup(api){
  api.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'stub'}:args.path==='server-only'?{path:'server-only',namespace:'stub'}:undefined);
  api.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:mocks[args.path]||'',loader:'ts'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
function fixture(){
 return {config:{secretKey:'sk_live_secret_must_not_leak',publishableKey:'pk_live_public',webhookSecret:'whsec_private',accountId,enabled:true,mode:'live',version:4},account:{id:accountId},settings:{livemode:true,status:'active',head_office:{address:{country:'US',state:'CA',city:'Los Angeles',postal_code:'90001',line1:'Office address'}}},registrations:{data:[{id:'taxreg_CA',country:'US',country_options:{us:{state:'CA'}},status:'active',active_from:1700000000,expires_at:null}],has_more:false},rates:{txr_state:taxRate},refunds:{data:[],has_more:false},notes:{data:[],has_more:false},providerCalls:[],records:[],authCalls:[]};
}
function purchase(behavior='exclusive'){
 return {id:'00000000-0000-4000-8000-000000000010',amount_cents:1000,snapshot:{account_id:accountId,automatic_tax:{enabled:true,price_behavior:behavior,tax_code:taxCode,version:3}}};
}
function invoice(behavior='exclusive',zeroTax=false){
 const tax=zeroTax?0:100,total=behavior==='inclusive'?1000:1000+tax,net=total-tax;
 return {id:'in_paid',status:'paid',livemode:true,currency:'usd',total,amount_paid:total,total_excluding_tax:net,automatic_tax:{enabled:true,status:'complete'},total_tax_amounts:tax?[{amount:tax,tax_rate:structuredClone(taxRate)}]:[],customer_address:{country:'US',state:'CA'},created:1700000000,status_transitions:{paid_at:1700000100},payment_intent:{id:'pi_paid',status:'succeeded',currency:'usd',amount_received:total,latest_charge:{amount:total,amount_refunded:0}}};
}
function checkoutForm(customer){
 const form=new URLSearchParams({'line_items[0][price_data][unit_amount]':'1000','line_items[0][price_data][currency]':'usd'});
 if(customer)form.set('customer',customer);else form.set('customer_email','owner@example.test');
 return form;
}
function issuedNote(){
 return {id:'cn_verified',created:1700000400,status:'issued',type:'post_payment',currency:'usd',livemode:true,invoice:'in_paid',refund:'re_paid',amount:550,total:550,subtotal_excluding_tax:500,out_of_band_amount:null,customer_balance_transaction:null,tax_amounts:[{amount:50,tax_rate:'txr_state'}]};
}

test('actual Stripe Tax helper verifies frozen terms, invoice amounts and jurisdiction credits',async t=>{
 const tax=await loadTax();
 try{
  await t.test('exclusive and inclusive invoices require the corresponding frozen net or gross total',()=>{
   assert.equal(tax.validateMarketTaxInvoice(invoice(),purchase()),true);
   assert.equal(tax.validateMarketTaxInvoice(invoice('inclusive'),purchase('inclusive')),true);
   assert.throws(()=>tax.validateMarketTaxInvoice(invoice('exclusive'),purchase('inclusive')),/match/);
   assert.throws(()=>tax.validateMarketTaxInvoice(invoice('inclusive'),purchase('exclusive')),/match/);
  });
  await t.test('a completed legitimate zero-tax invoice is recorded without inventing tax',async()=>{
   const c=fixture();globalThis.__marketTaxProviderTest=c;const bill=invoice('exclusive',true);
   assert.equal(tax.validateMarketTaxInvoice(bill,purchase()),true);
   await tax.recordMarketTaxInvoice(bill,purchase(),c.config);
   assert.equal(c.records.length,1);const value=c.records[0].args.p_invoice;
   assert.equal(value.amount_cents,1000);assert.equal(value.subtotal_cents,1000);assert.equal(value.tax_cents,0);assert.deepEqual(value.tax_breakdown,[]);
   assert.equal(value.occurred_at,new Date(1700000100*1000).toISOString());
  });
  await t.test('failed, incomplete or inconsistent provider invoices cannot pass verification',()=>{
   const changes=[
    bill=>{bill.amount_paid=1099},bill=>{bill.total_excluding_tax=999},bill=>{bill.total=1099},
    bill=>{bill.automatic_tax.status='failed'},bill=>{bill.automatic_tax.status='requires_location_inputs'},bill=>{bill.automatic_tax.enabled=false},
    bill=>{bill.status='open'},bill=>{bill.livemode=false},bill=>{bill.currency='eur'},bill=>{bill.total_excluding_tax=null},
    bill=>{bill.payment_intent.status='processing'},bill=>{bill.payment_intent.currency='eur'},bill=>{bill.payment_intent.amount_received=1099},bill=>{delete bill.payment_intent},
    bill=>{bill.total_tax_amounts[0].amount=-1},bill=>{bill.total_tax_amounts[0].amount=0.5},bill=>{bill.total=Number.MAX_SAFE_INTEGER+1},
   ];
   for(const change of changes){const bill=invoice();change(bill);assert.throws(()=>tax.validateMarketTaxInvoice(bill,purchase()));}
   const manual=purchase();manual.snapshot.automatic_tax={enabled:false};assert.equal(tax.validateMarketTaxInvoice(invoice(),manual),false);
  });
  await t.test('checkout uses frozen inclusive/exclusive classification and updates only an existing customer',async()=>{
   for(const behavior of ['inclusive','exclusive']){
    const c=fixture();c.config.tax_behavior=behavior==='inclusive'?'exclusive':'inclusive';globalThis.__marketTaxProviderTest=c;
    const form=checkoutForm('cus_existing');await tax.applyMarketTaxToCheckout(form,purchase(behavior));
    assert.equal(form.get('automatic_tax[enabled]'),'true');assert.equal(form.get('billing_address_collection'),'required');assert.equal(form.get('customer_update[address]'),'auto');
    assert.equal(form.get('line_items[0][price_data][tax_behavior]'),behavior);assert.equal(form.get('line_items[0][price_data][product_data][tax_code]'),taxCode);
    assert.equal(form.get('line_items[0][price_data][unit_amount]'),'1000');assert.equal([...form.keys()].some(key=>/tax_rates|tax_amount/.test(key)),false);
   }
   const c=fixture();globalThis.__marketTaxProviderTest=c;const form=checkoutForm();await tax.applyMarketTaxToCheckout(form,purchase());
   assert.equal(form.get('customer_email'),'owner@example.test');assert.equal(form.has('customer_update[address]'),false);
  });
  await t.test('manual-tax purchases leave the provider form unchanged',async()=>{
   const c=fixture();c.providerError='Should not call provider';globalThis.__marketTaxProviderTest=c;
   const saved=purchase();saved.snapshot.automatic_tax={enabled:false};const form=checkoutForm(),before=form.toString();
   await tax.applyMarketTaxToCheckout(form,saved);assert.equal(form.toString(),before);assert.deepEqual(c.providerCalls,[]);
  });
  await t.test('pending provider, missing head office, wrong merchant/mode or bad product classification cannot fall back to a flat tax',async()=>{
   const changes=[c=>{c.settings.status='pending'},c=>{c.settings.head_office=null},c=>{c.config.accountId='acct_replaced'},c=>{c.account.id='acct_other'},c=>{c.config.mode='test'},c=>{c.settings.livemode=false}];
   for(const change of changes){const c=fixture();change(c);globalThis.__marketTaxProviderTest=c;const form=checkoutForm(),before=form.toString();await assert.rejects(tax.applyMarketTaxToCheckout(form,purchase()));assert.equal(form.toString(),before);assert.deepEqual(c.records,[]);}
   for(const values of [{tax_code:'invalid'},{price_behavior:'unspecified'}]){const c=fixture();globalThis.__marketTaxProviderTest=c;const saved=purchase();Object.assign(saved.snapshot.automatic_tax,values);await assert.rejects(tax.applyMarketTaxToCheckout(checkoutForm(),saved),/classification/);assert.deepEqual(c.providerCalls,[]);}
  });
  await t.test('invoice tax rates are loaded and grouped into verified jurisdiction rows',async()=>{
   const c=fixture();globalThis.__marketTaxProviderTest=c;const bill=invoice();bill.total_tax_amounts=[{amount:40,tax_rate:'txr_state'},{amount:60,tax_rate:structuredClone(taxRate)}];
   await tax.recordMarketTaxInvoice(bill,purchase(),c.config);const value=c.records[0].args.p_invoice;
   assert.deepEqual(value.tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:100,country:'US',state:'CA',jurisdiction:'California',tax_type:'sales_tax',rate_bps:1000,tax_code:taxCode}]);
   assert.equal(c.providerCalls[0].path,'tax_rates/txr_state');assert.equal(value.account_id,accountId);assert.equal(value.purchase_id,purchase().id);
  });
  await t.test('2024-06-20 issued credit-note refund proves the actual jurisdiction tax reversal',async()=>{
   const c=fixture();c.refunds.data=[{id:'re_paid',status:'succeeded',amount:550,created:1700000300}];c.notes.data=[issuedNote()];globalThis.__marketTaxProviderTest=c;
   const bill=invoice();bill.payment_intent.latest_charge.amount_refunded=550;await tax.recordMarketTaxInvoice(bill,purchase(),c.config);
   const value=c.records[0].args.p_invoice;assert.equal(value.refunded_cents,550);assert.deepEqual(value.refund_tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:50}]);assert.equal(value.refund_occurred_at,new Date(1700000400*1000).toISOString());
   assert.ok(c.providerCalls.some(call=>call.path==='refunds?payment_intent=pi_paid&limit=100'));assert.ok(c.providerCalls.some(call=>call.path==='credit_notes?invoice=in_paid&limit=100'));
  });
  await t.test('delayed credit notes book the tax reversal on their issue/effective date rather than the older cash refund',async()=>{
   for(const effectiveAt of [null,1706000000]){
    const c=fixture();c.refunds.data=[{id:'re_paid',status:'succeeded',amount:550,created:1700000300}];c.notes.data=[{...issuedNote(),created:1705000000,effective_at:effectiveAt}];globalThis.__marketTaxProviderTest=c;
    const bill=invoice();bill.payment_intent.latest_charge.amount_refunded=550;await tax.recordMarketTaxInvoice(bill,purchase(),c.config);
    const value=c.records[0].args.p_invoice;assert.equal(value.refund_occurred_at,new Date((effectiveAt??1705000000)*1000).toISOString());assert.notEqual(value.refund_occurred_at,new Date(1700000300*1000).toISOString());assert.deepEqual(value.refund_tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:50}]);
   }
  });
  await t.test('two issued credit notes retain separate dated proofs instead of one combined refund date',async()=>{
   const c=fixture();c.refunds.data=[{id:'re_first',status:'succeeded',amount:275,created:1700000200},{id:'re_second',status:'succeeded',amount:275,created:1700000300}];c.notes.data=[{...issuedNote(),id:'cn_first',refund:'re_first',amount:275,created:1700000400,tax_amounts:[{amount:25,tax_rate:'txr_state'}]},{...issuedNote(),id:'cn_second',refund:'re_second',amount:275,created:1700000900,effective_at:1700010000,tax_amounts:[{amount:25,tax_rate:'txr_state'}]}];globalThis.__marketTaxProviderTest=c;
   const bill=invoice();bill.payment_intent.latest_charge.amount_refunded=550;await tax.recordMarketTaxInvoice(bill,purchase(),c.config);const value=c.records[0].args.p_invoice;
   assert.deepEqual(value.credit_notes,[{id:'cn_first',occurred_at:new Date(1700000400*1000).toISOString(),amount_cents:275,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:25}]},{id:'cn_second',occurred_at:new Date(1700010000*1000).toISOString(),amount_cents:275,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:25}]}]);
   assert.equal(value.refunds_reconciled_cents,550);assert.deepEqual(value.refund_tax_breakdown,[{tax_rate_id:'txr_state',tax_cents:50}]);
  });
  await t.test('a raw refund, void note, failed refund or credit/out-of-band adjustment does not invent a tax reversal',async()=>{
   const changes=[c=>{c.notes.data=[]},c=>{c.notes.data[0].status='void'},c=>{c.refunds.data[0].status='pending'},c=>{c.notes.data[0].out_of_band_amount=1},c=>{c.notes.data[0].credit_amount=1},c=>{c.notes.data[0].invoice='in_other'},c=>{c.notes.data[0].amount=551},c=>{c.notes.data[0].currency='eur'}];
   for(const change of changes){const c=fixture();c.refunds.data=[{id:'re_paid',status:'succeeded',amount:550,created:1700000300}];c.notes.data=[issuedNote()];change(c);globalThis.__marketTaxProviderTest=c;
    const bill=invoice();bill.payment_intent.latest_charge.amount_refunded=550;await tax.recordMarketTaxInvoice(bill,purchase(),c.config);const value=c.records[0].args.p_invoice;
    assert.equal(value.refunded_cents,550);assert.equal('refund_tax_breakdown' in value,false);assert.equal(value.refund_occurred_at,null);
   }
  });
  await t.test('refund credit for another jurisdiction is rejected before tax recording',async()=>{
   const c=fixture();c.refunds.data=[{id:'re_paid',status:'succeeded',amount:550,created:1700000300}];c.notes.data=[{...issuedNote(),tax_amounts:[{amount:50,tax_rate:'txr_wrong'}]}];globalThis.__marketTaxProviderTest=c;
   const bill=invoice();bill.payment_intent.latest_charge.amount_refunded=550;await assert.rejects(tax.recordMarketTaxInvoice(bill,purchase(),c.config),/jurisdiction/);assert.deepEqual(c.records,[]);
  });
  await t.test('an issued zero-tax credit note supplies explicit zero reversal evidence',async()=>{
   const c=fixture();c.refunds.data=[{id:'re_paid',status:'succeeded',amount:500,created:1700000300}];c.notes.data=[{...issuedNote(),amount:500,total:500,subtotal_excluding_tax:500,tax_amounts:[]}];globalThis.__marketTaxProviderTest=c;
   const bill=invoice('exclusive',true);bill.payment_intent.latest_charge.amount_refunded=500;await tax.recordMarketTaxInvoice(bill,purchase(),c.config);
   const value=c.records[0].args.p_invoice;assert.equal(value.tax_cents,0);assert.deepEqual(value.refund_tax_breakdown,[]);assert.equal(value.refund_occurred_at,new Date(1700000400*1000).toISOString());
  });
  await t.test('incomplete refund evidence and invalid invoice/refund timestamps cannot write a receipt',async()=>{
   const c=fixture();c.refunds={data:[],has_more:true};globalThis.__marketTaxProviderTest=c;const refunded=invoice();refunded.payment_intent.latest_charge.amount_refunded=550;
   await assert.rejects(tax.recordMarketTaxInvoice(refunded,purchase(),c.config),/loaded completely/);assert.deepEqual(c.records,[]);
   for(const timestamp of [NaN,Infinity,0,-1,1.5]){const next=fixture();globalThis.__marketTaxProviderTest=next;const bill=invoice();bill.status_transitions.paid_at=timestamp;await assert.rejects(tax.recordMarketTaxInvoice(bill,purchase(),next.config));assert.deepEqual(next.records,[]);}
   const next=fixture();next.refunds.data=[{id:'re_paid',status:'succeeded',amount:550,created:Infinity}];next.notes.data=[issuedNote()];globalThis.__marketTaxProviderTest=next;
   await assert.rejects(tax.recordMarketTaxInvoice(refunded,purchase(),next.config));assert.deepEqual(next.records,[]);
   for(const timestamp of [NaN,Infinity,0,-1,1.5]){
    const invalid=fixture();invalid.refunds.data=[{id:'re_paid',status:'succeeded',amount:550,created:1700000300}];invalid.notes.data=[{...issuedNote(),created:timestamp}];globalThis.__marketTaxProviderTest=invalid;
    await assert.rejects(tax.recordMarketTaxInvoice(refunded,purchase(),invalid.config),/transaction date/);assert.deepEqual(invalid.records,[]);
   }
  });
  await t.test('provider checks persist only safe readiness data and conceal provider failure secrets',async()=>{
   const c=fixture();globalThis.__marketTaxProviderTest=c;assert.match((await tax.syncMarketTaxProvider()).message,/1 active registrations/);
   const provider=c.records[0].args.p_provider;assert.equal(provider.status,'active');assert.equal(provider.head_office.country,'US');assert.deepEqual(provider.registrations,[{id:'taxreg_CA',country:'US',state:'CA',status:'active',active_from:1700000000,expires_at:null}]);
   assert.equal(JSON.stringify(provider).includes(c.config.secretKey),false);assert.equal(JSON.stringify(provider).includes(c.config.webhookSecret),false);
   const failed=fixture();failed.providerError=failed.config.secretKey;globalThis.__marketTaxProviderTest=failed;
   const result=await tax.syncMarketTaxProvider();assert.match(result.message,/could not be checked/);assert.equal(result.message.includes(failed.config.secretKey),false);
   assert.equal(failed.records[0].args.p_provider.status,'unavailable');assert.equal(JSON.stringify(failed.records).includes(failed.config.secretKey),false);
  });
  await t.test('unconfigured Stripe returns connection guidance and a valid cached check timestamp without provider requests',async()=>{
   const c=fixture();c.config.secretKey='';c.config.accountId='';globalThis.__marketTaxProviderTest=c;const result=await tax.syncMarketTaxProvider();
   assert.match(result.message,/Connect Stripe/);assert.deepEqual(c.providerCalls,[]);assert.equal(c.records.length,1);assert.equal(c.records[0].name,'market_tax_sync_provider');
   const provider=c.records[0].args.p_provider;assert.equal(provider.connected,false);assert.equal(provider.status,'unavailable');assert.match(provider.checked_at,/^\d{4}-\d{2}-\d{2}T/);assert.ok(Number.isFinite(Date.parse(provider.checked_at)));
  });
  await t.test('admin ownership and complete pagination are required for provider synchronization',async()=>{
   for(const values of [{denied:true},{roleSlug:'platform_operator'}]){const c=fixture();Object.assign(c,values);globalThis.__marketTaxProviderTest=c;await assert.rejects(tax.syncMarketTaxProvider());assert.deepEqual(c.records,[]);assert.deepEqual(c.providerCalls,[]);}
   const c=fixture();c.registrations={data:[],has_more:true};globalThis.__marketTaxProviderTest=c;assert.match((await tax.syncMarketTaxProvider()).message,/could not be checked/);assert.equal(c.records[0].args.p_provider.connected,false);
  });
  await t.test('unverified payment, customer country or failed storage never produces a successful tax receipt',async()=>{
   const c=fixture();globalThis.__marketTaxProviderTest=c;const bill=invoice();bill.automatic_tax.status='failed';await assert.rejects(tax.recordMarketTaxInvoice(bill,purchase(),c.config));assert.deepEqual(c.records,[]);
   bill.automatic_tax.status='complete';bill.customer_address.country='invalid';await assert.rejects(tax.recordMarketTaxInvoice(bill,purchase(),c.config),/country/);assert.deepEqual(c.records,[]);
   bill.customer_address.country='US';c.storageError={message:c.config.secretKey};await assert.rejects(tax.recordMarketTaxInvoice(bill,purchase(),c.config),error=>/Reconciliation/.test(error.message)&&!error.message.includes(c.config.secretKey));
  });
  await t.test('date range validates calendar dates and makes the inclusive end date exclusive in UTC',()=>{
   assert.deepEqual(tax.marketTaxDateRange({from:'2026-02-01',to:'2026-02-28'}),{filters:{from:'2026-02-01',to:'2026-02-28'},p_from:'2026-02-01T00:00:00.000Z',p_to:'2026-03-01T00:00:00.000Z'});
   assert.deepEqual(tax.marketTaxDateRange(),{filters:{from:'',to:''},p_from:null,p_to:null});
   for(const value of ['2026-02-29','2026-02-30','2026-13-01','2026-01-32','2026-1-01','invalid','2026-01-01T00:00:00Z'])assert.throws(()=>tax.marketTaxDateRange({from:value}),/valid report dates/);
   assert.throws(()=>tax.marketTaxDateRange({from:'2026-03-01',to:'2026-02-28'}),/on or after/);
   assert.equal(tax.marketTaxDateRange({from:'2024-02-29',to:'2024-02-29'}).p_to,'2024-03-01T00:00:00.000Z');
  });
 }finally{delete globalThis.__marketTaxProviderTest;}
});
