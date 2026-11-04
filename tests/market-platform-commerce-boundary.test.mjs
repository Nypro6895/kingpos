import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';import {createHash} from 'node:crypto';
const key=Symbol.for('market-platform-commerce-test'),state={};globalThis[key]=state;
const compiled=await build({entryPoints:['lib/market-platform/commerce.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'financial-boundaries',setup(builder){
 builder.onResolve({filter:/^(server-only|@supabase\/supabase-js|\.\/server)$/},args=>({path:args.path,namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='server-only'?'':args.path==='./server'?`export class PlatformError extends Error {} export async function platformRpc(name,args){return globalThis[Symbol.for('market-platform-commerce-test')].authRpc(name,args);}`:`export function createClient(){return {rpc(name,args){return globalThis[Symbol.for('market-platform-commerce-test')].serviceRpc(name,args);}};}`}));
}}]});
const adapter=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const envNames=['MARKET_PLATFORM_STRIPE_TEST_KEY','MARKET_PLATFORM_STRIPE_TEST_WEBHOOK_SECRET','MARKET_PLATFORM_STRIPE_TEST_ACCOUNT','MARKET_PLATFORM_TEST_ORIGIN','NEXT_PUBLIC_SUPABASE_URL','MARKET_PLATFORM_TEST_SERVICE_ROLE_KEY'];
const previous=Object.fromEntries(envNames.map(n=>[n,process.env[n]])),oldFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=oldFetch;for(const name of envNames)if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];delete globalThis[key];});
function validCheckoutSha(){const manifest={schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic app',description:'Synthetic approved checkout version.',launchUrl:'https://developer.reylumi.com/connect',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:profile:read'],price:{currency:'usd',amountCents:1000,billing:'one-time-version'}};return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');}
function reset(){
 Object.assign(process.env,{MARKET_PLATFORM_STRIPE_TEST_KEY:'sk_test_fixture',MARKET_PLATFORM_STRIPE_TEST_WEBHOOK_SECRET:'whsec_fixture',MARKET_PLATFORM_STRIPE_TEST_ACCOUNT:'acct_platform',MARKET_PLATFORM_TEST_ORIGIN:'http://localhost:4328',NEXT_PUBLIC_SUPABASE_URL:'http://localhost:4329',MARKET_PLATFORM_TEST_SERVICE_ROLE_KEY:'synthetic_local_key'});
 Object.assign(state,{calls:[],applied:[],authCalls:[],responses:new Map(),seller:{organization_id:'00000000-0000-4000-8000-000000000001',account_id:null,testEnabled:true,charges_enabled:false,payouts_enabled:false,details_submitted:false,updated_at:new Date().toISOString()},quote:{id:'00000000-0000-4000-8000-000000000002',salon_id:'00000000-0000-4000-8000-000000000003',version_id:'00000000-0000-4000-8000-000000000004',buyer_id:'00000000-0000-4000-8000-000000000005',account_id:'acct_seller',amount_cents:1000,fee_cents:100,state:'pending',checkout_id:null,name:'Synthetic app',created_at:new Date().toISOString()},authError:null,serviceError:null,workspaceOverride:undefined,ownerOverride:undefined,commerceOverride:undefined,savedOrderOverride:undefined,financeOverride:undefined,savedRefundIntent:undefined});
 state.savedOrder=structuredClone(state.quote);
 state.authRpc=async(name,args)=>{state.authCalls.push({name,args});if(state.authError)throw new Error(state.authError);if(name==='workspace')return state.workspaceOverride!==undefined?state.workspaceOverride:{organization:{id:'00000000-0000-4000-8000-000000000001'}};if(name==='owner_workspace'){if(state.ownerOverride!==undefined)return state.ownerOverride;const manifest={schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Synthetic app',description:'Synthetic approved checkout version.',launchUrl:'https://developer.reylumi.com/connect',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:profile:read'],price:{currency:'usd',amountCents:1000,billing:'one-time-version'}};const canonical=JSON.stringify(manifest);state.approvedSha=createHash('sha256').update(canonical).digest('hex');return {salonId:'00000000-0000-4000-8000-000000000003',salonName:'Synthetic salon',observedAt:new Date().toISOString(),testPaymentsEnabled:true,catalog:[{id:'00000000-0000-4000-8000-000000000004',app_id:'00000000-0000-4000-8000-000000000009',version:'1.0.0',manifest,canonical,sha256:state.approvedSha,publisher:'Synthetic publisher',entitled:false,connectionReady:false}],installations:[]};}if(name==='finance_workspace')return state.financeOverride!==undefined?state.financeOverride:{testEnabled:true,orders:[structuredClone(state.savedOrder)],refundIntents:state.savedRefundIntent?[structuredClone(state.savedRefundIntent)]:[]};if(name==='commerce_workspace')return state.commerceOverride!==undefined?state.commerceOverride:{orders:[{...state.savedOrder,...state.savedOrderOverride}]};return name==='seller'?state.seller:state.quote;};
 state.serviceRpc=async(name,args)=>{state.applied.push({name,args});return {data:true,error:state.serviceError};};
 globalThis.fetch=async(url,options)=>{assert.match(url,/^https:\/\/api\.stripe\.com\/v1\//);assert.equal(options.headers.Authorization,'Bearer sk_test_fixture');const path=new URL(url).pathname.replace('/v1/','');state.calls.push({path,method:options.method,query:new URL(url).search,form:options.body?Object.fromEntries(new URLSearchParams(options.body)):null,idempotency:options.headers['Idempotency-Key'],account:options.headers['Stripe-Account']});const response=state.responses.get(path+new URL(url).search)??state.responses.get(path)??(path==='account'?{id:'acct_platform'}:null);if(!response)throw new Error(`Unexpected provider path ${path}`);return {ok:true,json:async()=>response};};
}
test.beforeEach(reset);
test('malformed quote timestamp stops before a provider request instead of bypassing stale-request reconciliation',async()=>{
 state.quote.created_at='not-a-date';state.responses.set('checkout/sessions',{id:'cs_test_fixture',livemode:false,currency:'usd',mode:'payment',status:'open',client_reference_id:'00000000-0000-4000-8000-000000000002',amount_total:1000,metadata:{market_platform_order:'00000000-0000-4000-8000-000000000002'},url:'https://checkout.stripe.com/c/test'});
 await assert.rejects(adapter.startTestCheckout('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',validCheckoutSha()));assert.equal(state.calls.length,0);
});
test('quote tenant/version/currency/money/provider-account faults stop before provider calls',async()=>{
 const original={...state.quote};for(const change of [{salon_id:'00000000-0000-4000-8000-000000000099'},{version_id:'00000000-0000-4000-8000-000000000099'},{currency:'eur'},{amount_cents:1001},{amount_cents:'1000'},{fee_cents:1001},{fee_cents:-1},{buyer_id:null},{account_id:'acct_foreign'},{checkout_id:'cs_live_invalid'},{created_at:'not-a-date'},{created_at:new Date(Date.now()+86400000).toISOString()}]){state.calls=[];state.quote={...original,...change};await assert.rejects(adapter.startTestCheckout(original.salon_id,original.version_id,validCheckoutSha()));assert.equal(state.calls.length,0);}
 state.quote=original;for(const commerceOverride of [null,{}, {orders:[]},{orders:[original,original]}]){state.commerceOverride=commerceOverride;await assert.rejects(adapter.startTestCheckout(original.salon_id,original.version_id,validCheckoutSha()));assert.equal(state.calls.length,0);}
});
test('unverified approved catalog or hash stops before even creating a quote',async()=>{
 const valid=await state.authRpc('owner_workspace');for(const ownerOverride of [null,{}, {...valid,testPaymentsEnabled:false},{...valid,salonId:'00000000-0000-4000-8000-000000000099'},{...valid,catalog:[]},{...valid,catalog:[{...valid.catalog[0],sha256:'f'.repeat(64)}]}]){state.ownerOverride=ownerOverride;state.authCalls=[];await assert.rejects(adapter.startTestCheckout(state.quote.salon_id,state.quote.version_id,validCheckoutSha()));assert.equal(state.authCalls.some(c=>c.name==='quote'),false);assert.equal(state.calls.length,0);}
});
test('seller org/type/timestamp faults stop before provider calls and existing account identity must match',async()=>{
 const original={...state.seller};for(const change of [{organization_id:'00000000-0000-4000-8000-000000000099'},{testEnabled:'false'},{charges_enabled:'true'},{account_id:undefined},{account_id:'invalid'},{updated_at:'not-a-date'}]){state.calls=[];state.seller={...original,...change};await assert.rejects(adapter.startSellerOnboarding());assert.equal(state.calls.length,0);}
 state.seller={...original,account_id:'acct_seller'};state.responses.set('accounts/acct_seller',{id:'acct_foreign',metadata:{market_platform_organization:original.organization_id},charges_enabled:false,payouts_enabled:false,details_submitted:false});await assert.rejects(adapter.refreshSellerStatus(),/identity mismatch/);assert.equal(state.applied.length,0);
});
test('new and existing checkout responses bind saved session/order/currency/amount before exposing a URL',async()=>{
 const valid={id:'cs_test_fixture',livemode:false,currency:'usd',mode:'payment',status:'open',client_reference_id:state.quote.id,amount_total:1000,metadata:{market_platform_order:state.quote.id},url:'https://checkout.stripe.com/c/test'};
 for(const change of [{currency:'eur'},{amount_total:999},{client_reference_id:'foreign'},{metadata:{market_platform_order:'foreign'}},{status:'complete'},{mode:'subscription'},{livemode:true}]){state.applied=[];state.responses.set('checkout/sessions',{...valid,...change});await assert.rejects(adapter.startTestCheckout(state.quote.salon_id,state.quote.version_id,validCheckoutSha()));assert.equal(state.applied.length,0);}
 state.quote.checkout_id=valid.id;state.savedOrder.checkout_id=valid.id;state.responses.set('checkout/sessions/'+valid.id,valid);assert.equal(await adapter.startTestCheckout(state.quote.salon_id,state.quote.version_id,validCheckoutSha()),valid.url);state.responses.set('checkout/sessions/'+valid.id,{...valid,id:'cs_test_foreign'});await assert.rejects(adapter.startTestCheckout(state.quote.salon_id,state.quote.version_id,validCheckoutSha()));
});
test('missing or false provider persistence confirmation cannot report a refreshed seller status',async()=>{
 state.seller.account_id='acct_seller';state.responses.set('accounts/acct_seller',{id:'acct_seller',metadata:{market_platform_organization:state.seller.organization_id},charges_enabled:false,payouts_enabled:false,details_submitted:false});
 for(const value of [null,false,{},'true']){state.applied=[];state.serviceRpc=async(name,args)=>{state.applied.push({name,args});return {data:value,error:null};};await assert.rejects(adapter.refreshSellerStatus(),/reconcil/);assert.equal(state.applied.length,1,'No automatic persistence retry');}
});
test('onboarding honors real developer authority and stores only provider status; return URL does not verify seller',async()=>{
 state.seller.testEnabled=false;await assert.rejects(adapter.startSellerOnboarding(),/configuration/);assert.equal(state.calls.length,0);
 state.seller.testEnabled=true;state.responses.set('accounts',{id:'acct_seller',metadata:{market_platform_organization:'00000000-0000-4000-8000-000000000001'},charges_enabled:false,payouts_enabled:false,details_submitted:false});state.responses.set('account_links',{url:'https://connect.stripe.com/setup/test'});
 assert.equal(await adapter.startSellerOnboarding(),'https://connect.stripe.com/setup/test');assert.equal(state.calls.find(c=>c.path==='accounts').idempotency,'market-seller-00000000-0000-4000-8000-000000000001');assert.deepEqual(state.applied[0].args,{p_organization:'00000000-0000-4000-8000-000000000001',p_account:'acct_seller',p_charges:false,p_payouts:false,p_details:false});assert.equal(state.calls.find(c=>c.path==='accounts').form['controller[losses][payments]'],'application');
});
test('interrupted checkout uses saved quote and stable provider idempotency; never grants entitlement',async()=>{
 state.responses.set('checkout/sessions',{id:'cs_test_fixture',livemode:false,currency:'usd',mode:'payment',status:'open',client_reference_id:'00000000-0000-4000-8000-000000000002',amount_total:1000,metadata:{market_platform_order:'00000000-0000-4000-8000-000000000002'},url:'https://checkout.stripe.com/c/test'});
 await adapter.startTestCheckout('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',validCheckoutSha());await adapter.startTestCheckout('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',validCheckoutSha());
 assert.ok(state.calls.filter(c=>c.path==='checkout/sessions').every(c=>c.idempotency==='market-order-00000000-0000-4000-8000-000000000002'));
 assert.equal(state.calls.find(c=>c.path==='checkout/sessions').form['payment_intent_data[transfer_data][destination]'],'acct_seller');assert.ok(state.applied.every(c=>c.name==='market_platform_checkout_apply'));
 state.quote.created_at='2020-01-01T00:00:00Z';state.savedOrder.created_at=state.quote.created_at;await assert.rejects(adapter.startTestCheckout('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004',validCheckoutSha()),/reconciliation/);
});
test('provider account mismatch and production Supabase destination prevent financial side effects',async()=>{
 state.responses.set('account',{id:'acct_wrong'});await assert.rejects(adapter.startSellerOnboarding(),/does not match/);assert.equal(state.applied.length,0);
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://production.supabase.co';state.calls=[];await assert.rejects(adapter.startSellerOnboarding(),/isolated local/);assert.equal(state.calls.length,0);
});
function paidEvent({refunded=0,disputed=false,live=false,account}={}){
 if(refunded>0)state.responses.set('refunds?charge=ch_fixture&limit=100',{data:[{id:'re_fixture',charge:'ch_fixture',amount:1000,currency:'usd',status:'succeeded',metadata:{market_platform_order:'00000000-0000-4000-8000-000000000002'}}],has_more:false});
 state.responses.set('events/evt_fixture',{id:'evt_fixture',type:'checkout.session.completed',livemode:live,created:1793163600,account,data:{object:{id:'cs_test_fixture'}}});
 state.responses.set('checkout/sessions/cs_test_fixture',{id:'cs_test_fixture',livemode:false,currency:'usd',mode:'payment',client_reference_id:'00000000-0000-4000-8000-000000000002',metadata:{market_platform_order:'00000000-0000-4000-8000-000000000002'},payment_status:'paid',amount_total:1000,payment_intent:{livemode:false,status:'succeeded',currency:'usd',amount_received:1000,application_fee_amount:100,transfer_data:{destination:'acct_seller'},metadata:{market_platform_order:'00000000-0000-4000-8000-000000000002'},latest_charge:{id:'ch_fixture',livemode:false,currency:'usd',amount:1000,paid:true,amount_refunded:refunded,disputed,transfer:'tr_fixture'}}});
}
test('reconciliation retrieves authoritative provider event and binds all entitlement fields',async()=>{
 paidEvent();await adapter.reconcileTestEvent('evt_fixture');assert.equal(state.applied[0].name,'market_platform_payment_apply');assert.deepEqual(state.applied[0].args,{p_event:'evt_fixture',p_kind:'checkout.session.completed',p_order:'00000000-0000-4000-8000-000000000002',p_checkout:'cs_test_fixture',p_charge:'ch_fixture',p_amount:1000,p_fee:100,p_account:'acct_seller',p_refunded:0,p_disputed:false,p_transfer:'tr_fixture',p_observed:new Date(1793163600000).toISOString()});
});
test('refunds, disputes, live mode, foreign account and amount mismatches fail safely',async()=>{
 paidEvent({refunded:1000});await adapter.reconcileTestEvent('evt_fixture');assert.equal(state.applied.find(c=>c.name==='market_platform_payment_apply').args.p_refunded,1000);assert.equal(state.applied.at(-1).name,'market_platform_refund_observation_for_order_apply');
 paidEvent({disputed:true});state.responses.set('disputes',{data:[{status:'needs_response'}],has_more:false});await adapter.reconcileTestEvent('evt_fixture');assert.equal(state.applied.at(-1).args.p_disputed,true);
 paidEvent({live:true});const count=state.applied.length;await assert.rejects(adapter.reconcileTestEvent('evt_fixture'),/Test event/);assert.equal(state.applied.length,count);
 paidEvent({account:'acct_foreign'});await adapter.reconcileTestEvent('evt_fixture');assert.equal(state.applied.length,count);
 paidEvent();state.responses.get('checkout/sessions/cs_test_fixture').amount_total=999;await assert.rejects(adapter.reconcileTestEvent('evt_fixture'),/amount mismatch/);assert.equal(state.applied.length,count);
});
function refundFixture() {
 const order='00000000-0000-4000-8000-000000000002';
 state.savedOrder={...state.savedOrder,state:'paid',checkout_id:'cs_test_fixture',charge_id:'ch_fixture',refunded_cents:0,disputed:false,transfer_id:'tr_fixture',observed_at:new Date().toISOString()};
 state.savedRefundIntent={id:'00000000-0000-4000-8000-000000000010',order_id:order,charge_id:'ch_fixture',amount_cents:1000,status:'requested',refund_id:null,created_at:new Date().toISOString(),observed_at:null};
 state.quote={...structuredClone(state.savedOrder),refund_intent:structuredClone(state.savedRefundIntent)};
 state.responses.set('charges/ch_fixture',{id:'ch_fixture',livemode:false,currency:'usd',paid:true,disputed:false,amount:1000,amount_refunded:0,application_fee_amount:100,transfer_data:{destination:'acct_seller'},transfer:'tr_fixture'});
 state.responses.set('refunds?charge=ch_fixture&limit=100',{data:[],has_more:false});
 // Refund has no guaranteed livemode property; test context is the retrieved charge.
 state.responses.set('refunds',{id:'re_fixture',charge:'ch_fixture',amount:1000,currency:'usd',status:'pending',metadata:{market_platform_order:order}});
 return order;
}
test('full refund binds saved financial order/intent, checks test charge and persists pending status without granting/revoking entitlement',async()=>{
 const order=refundFixture();assert.equal(await adapter.requestFullTestRefund(order),'pending');assert.deepEqual(state.authCalls.map(c=>c.name),['refund_quote','finance_workspace']);
 const call=state.calls.find(c=>c.path==='refunds'&&c.method==='POST');assert.equal(call.idempotency,'market-full-refund-'+order);assert.equal(call.form.reverse_transfer,'true');assert.equal(call.form.refund_application_fee,'true');
 assert.deepEqual(state.applied,[{name:'market_platform_refund_observation_apply',args:{p_intent:state.savedRefundIntent.id,p_refund:'re_fixture',p_status:'pending'}}]);
});
test('malformed refund quote or independent order/intent mismatch never reaches provider',async()=>{
 const order=refundFixture(),valid=structuredClone(state.quote);
 for(const change of [{id:'00000000-0000-4000-8000-000000000099'},{charge_id:'ch_foreign'},{amount_cents:'1000'},{amount_cents:-1},{fee_cents:1001},{refunded_cents:1},{disputed:true},{state:'revoked'},{currency:'eur'},{checkout_id:'cs_live_bad'},{observed_at:'bad'},{refund_intent:null},{refund_intent:{...valid.refund_intent,created_at:'bad'}},{refund_intent:{...valid.refund_intent,status:'succeeded'}}]){
  state.quote={...structuredClone(valid),...change};state.calls=[];await assert.rejects(adapter.requestFullTestRefund(order));assert.equal(state.calls.length,0);
 }
 state.quote=valid;
 for(const finance of [null,{}, {testEnabled:false,orders:[state.savedOrder],refundIntents:[state.savedRefundIntent]}, {testEnabled:true,orders:[state.savedOrder,state.savedOrder],refundIntents:[state.savedRefundIntent]}, {testEnabled:true,orders:[{...state.savedOrder,charge_id:'ch_foreign'}],refundIntents:[state.savedRefundIntent]}, {testEnabled:true,orders:[state.savedOrder],refundIntents:[{...state.savedRefundIntent,amount_cents:999}]}]){
  state.financeOverride=finance;state.calls=[];await assert.rejects(adapter.requestFullTestRefund(order));assert.equal(state.calls.length,0);
 }
});
test('existing provider refund is recovered after lost response or expired idempotency window; no second POST',async()=>{
 const order=refundFixture();state.quote.refund_intent.created_at=new Date(Date.now()-48*3600000).toISOString();state.savedRefundIntent.created_at=state.quote.refund_intent.created_at;state.quote.created_at=new Date(Date.now()-72*3600000).toISOString();state.savedOrder.created_at=state.quote.created_at;
 state.responses.set('refunds?charge=ch_fixture&limit=100',{data:[state.responses.get('refunds')],has_more:false});
 assert.equal(await adapter.requestFullTestRefund(order),'pending');assert.equal(state.calls.filter(c=>c.method==='POST').length,0);assert.equal(state.applied.at(-1).args.p_refund,'re_fixture');
 state.calls=[];state.quote.refund_intent={...state.quote.refund_intent,refund_id:'re_fixture',status:'pending',observed_at:new Date().toISOString()};state.savedRefundIntent=structuredClone(state.quote.refund_intent);state.responses.set('refunds/re_fixture',{...state.responses.get('refunds'),status:'succeeded'});
 assert.equal(await adapter.requestFullTestRefund(order),'succeeded');assert.equal(state.calls.filter(c=>c.method==='POST').length,0);assert.equal(state.applied.at(-1).args.p_status,'succeeded');
});
test('stale unobserved request, paginated/foreign/partial/conflicting refunds and unsafe charge prevent new POST',async()=>{
 const order=refundFixture(),charge=structuredClone(state.responses.get('charges/ch_fixture'));
 for(const change of [{livemode:true},{currency:'eur'},{amount:999},{paid:false},{disputed:true},{application_fee_amount:101},{transfer_data:{destination:'acct_foreign'}},{transfer:'tr_foreign'},{amount_refunded:-1}]){
  state.responses.set('charges/ch_fixture',{...charge,...change});state.calls=[];await assert.rejects(adapter.requestFullTestRefund(order));assert.equal(state.calls.filter(c=>c.method==='POST').length,0);
 }
 state.responses.set('charges/ch_fixture',charge);const refund=state.responses.get('refunds');
 for(const listed of [{data:[],has_more:true},{data:[{...refund,amount:500}],has_more:false},{data:[{...refund,charge:'ch_foreign'}],has_more:false},{data:[{...refund,metadata:{market_platform_order:'foreign'}}],has_more:false},{data:[refund,refund],has_more:false}]){
  state.responses.set('refunds?charge=ch_fixture&limit=100',listed);state.calls=[];await assert.rejects(adapter.requestFullTestRefund(order));assert.equal(state.calls.filter(c=>c.method==='POST').length,0);
 }
 state.responses.set('refunds?charge=ch_fixture&limit=100',{data:[],has_more:false});state.quote.created_at=new Date(Date.now()-72*3600000).toISOString();state.savedOrder.created_at=state.quote.created_at;state.quote.refund_intent.created_at=new Date(Date.now()-48*3600000).toISOString();state.savedRefundIntent.created_at=state.quote.refund_intent.created_at;
 state.calls=[];await assert.rejects(adapter.requestFullTestRefund(order),/interrupted refund/);assert.equal(state.calls.filter(c=>c.method==='POST').length,0);
});
test('wrong provider refund identity/money/status never records success; persisted acknowledgement must be true',async()=>{
 const order=refundFixture(),valid=state.responses.get('refunds');
 for(const change of [{id:'bad'},{charge:'ch_foreign'},{amount:999},{currency:'eur'},{metadata:{}},{status:'unknown'},{livemode:true}]){
  state.responses.set('refunds',{...valid,...change});state.applied=[];await assert.rejects(adapter.requestFullTestRefund(order));assert.equal(state.applied.length,0);
 }
 state.responses.set('refunds',valid);state.serviceRpc=async()=>({data:null,error:null});await assert.rejects(adapter.requestFullTestRefund(order),/reconciliation/);
});

test('Connect event retrieval and payout accounting stay in the signed connected-account context',async()=>{
 state.responses.set('events/evt_payout',{id:'evt_payout',livemode:false,type:'payout.paid',account:'acct_seller',created:1793163600,data:{object:{id:'po_fixture'}}});
 state.responses.set('payouts/po_fixture',{id:'po_fixture',livemode:false,amount:900,currency:'usd',status:'paid'});
 await adapter.reconcileTestEvent('evt_payout','acct_seller');assert.ok(state.calls.filter(c=>c.path!=='account').every(c=>c.account==='acct_seller'));assert.equal(state.applied[0].name,'market_platform_payout_apply');assert.equal(state.applied[0].args.p_account,'acct_seller');
 await assert.rejects(adapter.reconcileTestEvent('evt_payout','acct_wrong'),/account mismatch/);
});

test('provider balance reconciliation binds linked sources and keeps negative movements separate',async()=>{
 paidEvent({refunded:1000});const charge=state.responses.get('checkout/sessions/cs_test_fixture').payment_intent.latest_charge;
 Object.assign(charge,{balance_transaction:'txn_charge',application_fee:'fee_fixture'});
 state.responses.set('refunds?charge=ch_fixture&limit=100',{data:[{id:'re_fixture',charge:'ch_fixture',balance_transaction:'txn_refund',amount:1000,currency:'usd',status:'succeeded',metadata:{market_platform_order:'00000000-0000-4000-8000-000000000002'}}],has_more:false});
 state.responses.set('transfers/tr_fixture',{id:'tr_fixture',source_transaction:'ch_fixture',destination:'acct_seller',livemode:false,balance_transaction:'txn_transfer',amount_reversed:1000});
 state.responses.set('transfers/tr_fixture/reversals',{data:[{id:'trr_fixture',transfer:'tr_fixture',balance_transaction:'txn_reversal'}],has_more:false});
 state.responses.set('application_fees/fee_fixture',{id:'fee_fixture',charge:'py_seller',originating_transaction:'ch_fixture',account:'acct_seller',livemode:false,balance_transaction:'txn_fee',amount_refunded:100});
 state.responses.set('application_fees/fee_fixture/refunds',{data:[{id:'fr_fixture',fee:'fee_fixture',balance_transaction:'txn_feeRefund'}],has_more:false});
 for(const [id,source,amount,fee] of [['charge','ch_fixture',1000,59],['refund','re_fixture',-1000,0],['transfer','tr_fixture',-1000,0],['reversal','trr_fixture',1000,0],['fee','fee_fixture',100,0],['feeRefund','fr_fixture',-100,0]])state.responses.set('balance_transactions/txn_'+id,{id:'txn_'+id,source,amount,fee,net:amount-fee,currency:'usd',created:1793163600});
 await adapter.reconcileTestEvent('evt_fixture');const rows=state.applied.filter(c=>c.name==='market_platform_balance_apply');assert.equal(rows.length,6);assert.equal(rows.reduce((sum,r)=>sum+r.args.p_net,0),-59,'Full refund leaves the observed processing fee, without inventing who contractually bears it');
 assert.ok(rows.every(r=>r.args.p_account==='acct_platform'));
 state.responses.get('balance_transactions/txn_charge').source='ch_foreign';await assert.rejects(adapter.reconcileTestEvent('evt_fixture'),/payment source/);
});
