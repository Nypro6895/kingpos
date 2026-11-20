import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';

const baseline=process.env.IOS_COMMERCE_TEST_BASELINE;
if(baseline&&!/^[a-f0-9]{40}$/.test(baseline))throw Error('Expected a full source commit for baseline verification');
const baselineSources=new Map(baseline?['lib/market-payment-return.ts','app/market/payment-return-actions.ts','lib/campaign-payments.ts'].map(file=>[
  path.resolve(file),execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8'}),
]):[]);

// Actual source modules, synthetic state and in-memory provider/database transports.
// Any dependency outside these explicit boundaries is bundled, never contacted.
async function load(file,mocks,define={}){
  const built=await build({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':path.resolve('.')},define,
    plugins:[{name:'commerce-synthetic-boundaries',setup(api){
      api.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);
      api.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'ts'}));
      api.onLoad({filter:/\.(?:ts|tsx)$/},a=>baselineSources.has(a.path)?{contents:baselineSources.get(a.path),loader:'ts'}:undefined);
    }}]});
  return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
const returnMocks={
  'server-only':'',
  '@/lib/market-plugins':`export async function marketPluginContext(){const f=globalThis.__iosReturn;if(f.denied)throw Error('Owner access required');return {salonId:'salon_a'}}`,
  '@/lib/market-payments':`export function marketServiceClient(){const f=globalThis.__iosReturn;return {from(table){f.tables.push(table);const q={select(fields){f.fields=fields;return q},eq(k,v){f.filters.push([k,v]);return q},in(k,v){f.allowed=v;return q},order(k,v){f.sort=[k,v];return q},async limit(n){f.limit=n;return {data:f.rows,error:f.dbError?{message:'synthetic query failure'}:null}}};return q}}}`,
  '@/lib/platform-payment':`export async function paymentStripe(route,form){const f=globalThis.__iosReturn;f.provider.push({route,form});if(f.failures.includes(route))throw Error('PRIVATE_SYNTHETIC_PROVIDER_DETAIL');return f.sessions[route]??{status:'open',subscription:'sub_not_confirmed'}}`,
  '@/lib/market-card':`export async function syncCardSubscription(id){const f=globalThis.__iosReturn;f.synced.push(id);if(f.failures.includes(id))throw Error('PRIVATE_SYNTHETIC_PROVIDER_DETAIL');return f.paid[id]??false}`,
};
const returns=await load('lib/market-payment-return.ts',returnMocks);
const returnAction=await load('app/market/payment-return-actions.ts',returnMocks);
function returnFixture(changes={}){
  return globalThis.__iosReturn={rows:[],sessions:{},failures:[],paid:{},provider:[],synced:[],tables:[],filters:[],...changes};
}
const checked='Payment status checked.';
const pending='Payment confirmation is pending. Check payment status before paying again.';

test('return confirmation surfaces total and partial failures while every sibling is still checked',async()=>{
  try{
    let f=returnFixture({rows:[{plugin_id:'booksms',subscription_id:'sub_sms'},{plugin_id:'tax-company',session_id:'cs_tax'}],failures:['sub_sms','checkout/sessions/cs_tax']});
    assert.deepEqual(await returns.reconcileMarketPaymentReturn('salon_a'),{checked:0,failed:2});
    assert.deepEqual(f.synced,['sub_sms']);assert.equal(f.provider.length,1);
    f=returnFixture({rows:[{plugin_id:'booksms',session_id:'cs_sms'},{plugin_id:'booksms',subscription_id:'sub_old'},{plugin_id:'tax-company',subscription_id:'sub_tax'},{plugin_id:'booking-policy',session_id:'cs_open'}],sessions:{'checkout/sessions/cs_sms':{status:'complete',subscription:'sub_verified'}},failures:['sub_tax']});
    assert.deepEqual(await returns.reconcileMarketPaymentReturn('salon_a'),{checked:2,failed:1});
    assert.deepEqual(f.synced.sort(),['sub_tax','sub_verified']);assert.equal(f.synced.includes('sub_old'),false);
    assert.deepEqual(f.filters,[['salon_id','salon_a']]);assert.equal(f.limit,12);assert.ok(f.allowed.includes('booksms'));
    assert.ok(f.provider.every(call=>call.form===undefined));
  }finally{delete globalThis.__iosReturn;}
});

test('real return Server Action never labels failed reconciliation checked or leaks provider details',async()=>{
  try{
    for(const failures of [['sub_a'],['sub_a','sub_b']]){
      returnFixture({rows:[{plugin_id:'booksms',subscription_id:'sub_a'},{plugin_id:'tax-company',subscription_id:'sub_b'}],failures});
      const result=await returnAction.reconcileMarketReturnAction('salon_a');assert.deepEqual(result,{message:pending});assert.equal(JSON.stringify(result).includes('PRIVATE_SYNTHETIC'),false);
    }
    returnFixture({rows:[{plugin_id:'booksms',subscription_id:'sub_a'}],paid:{sub_a:true}});
    assert.deepEqual(await returnAction.reconcileMarketReturnAction('salon_a'),{message:checked});
  }finally{delete globalThis.__iosReturn;}
});

test('open, unpaid or empty saved-purchase checks grant no access from a return URL or subscription hint',async()=>{
  try{
    const f=returnFixture({rows:[{plugin_id:'booksms',session_id:'cs_pending'}],sessions:{'checkout/sessions/cs_pending':{status:'open',payment_status:'unpaid',subscription:'sub_unverified'}}});
    assert.deepEqual(await returns.reconcileMarketPaymentReturn('salon_a'),{checked:1,failed:0});assert.deepEqual(f.synced,[]);
    returnFixture();assert.deepEqual(await returns.reconcileMarketPaymentReturn('salon_a'),{checked:0,failed:0});
    const changed=returnFixture();assert.deepEqual(await returnAction.reconcileMarketReturnAction('salon_other?paid=true'),{message:pending});assert.deepEqual(changed.tables,[]);assert.deepEqual(changed.provider,[]);
    const denied=returnFixture({denied:true});assert.deepEqual(await returnAction.reconcileMarketReturnAction('salon_a'),{message:pending});assert.deepEqual(denied.tables,[]);
    const failed=returnFixture({dbError:true});assert.deepEqual(await returnAction.reconcileMarketReturnAction('salon_a'),{message:pending});assert.deepEqual(failed.provider,[]);
  }finally{delete globalThis.__iosReturn;}
});

const O='00000000-0000-4000-8000-000000000101';
function adClient(){
  const f=globalThis.__iosAd;
  return {from(table){const q={filters:[],op:'read',values:null,select(){return q},eq(k,v){q.filters.push([k,v]);return q},abortSignal(){return q},update(v){q.op='update';q.values=v;return q},insert(v){q.op='insert';q.values=v;return q},single(){return q.finish()},maybeSingle(){return q.finish()},async finish(){
    f.reads.push({table,op:q.op,filters:q.filters});
    if(q.op==='update'){if(f.updateError)return {error:{message:'synthetic update failure'}};f.writes.push({table,values:q.values,filters:q.filters});return {error:null};}
    if(q.op==='insert'){f.writes.push({table,values:q.values,filters:q.filters});return {error:null};}
    const row=table==='campaign_wallets'?f.wallet:table==='campaign_card_setups'?f.setup:f.order;
    const field={owner_id:'owner_id',salon_id:'salon_id',id:'id'};
    if(q.filters.some(([k,v])=>field[k]&&row?.[field[k]]!==v))return {data:null,error:null};
    return {data:row,error:null};
  },then(resolve,reject){return q.finish().then(resolve,reject)}};return q;},rpc(name,args){
    f.rpc.push({name,args});let result;
    if(name==='campaign_credit_order')result={data:O,error:null};
    else if(name==='campaign_credit_claim')result={data:f.claim,error:null};
    else{assert.ok(['campaign_credit_paid','campaign_save_card','campaign_credit_cancelled'].includes(name));result={data:true,error:f.rpcError?{message:'synthetic ledger failure'}:null};}
    const query={abortSignal(){return query},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};return query;
  }};
}
const adMocks={
  'server-only':'',
  './platform-payment':`export async function paymentConfig(){return {enabled:true,mode:'live',webhookSecret:'fixture',secretKey:'fixture-only-not-real'}} export async function paymentStripe(route,form,key){return globalThis.__iosAd.provider(route,form,key)}`,
  '@/lib/explore-advertising':`export function advertisingClient(){return globalThis.__iosAd.client()}`,
  '@/lib/reylumi-config':`export const REYLUMI_METADATA_BASE='https://reylumi.com'`,
  '@/lib/campaign-credit-queue':`export async function runCampaignCreditQueue(options){return globalThis.__iosAd.runQueue(options)}`,
};
const ads=await load('lib/campaign-payments.ts',adMocks,{'process.env.CAMPAIGN_STRIPE_SECRET_KEY':'undefined','process.env.CAMPAIGN_STRIPE_WEBHOOK_SECRET':'undefined'});
function adFixture(changes={}){
  const f=globalThis.__iosAd={order:{id:O,owner_id:'owner_a',salon_id:'salon_a',status:'pending',automatic:false,credits:500,amount_cents:500,checkout_session_id:'cs_saved'},wallet:{salon_id:'salon_a',payment_owner:'owner_other',stripe_customer:'cus_other',payment_revision:4},setup:{id:O,owner_id:'owner_a',salon_id:'salon_a',status:'pending',payment_revision:4},session:{id:'cs_saved',mode:'payment',status:'complete',payment_status:'paid',metadata:{campaign_credit_order:O},payment_intent:'pi_saved'},intent:{id:'pi_saved',status:'succeeded',currency:'usd',amount_received:500,metadata:{campaign_credit_order:O},customer:'cus_owner',payment_method:'pm_owner'},setupIntent:{id:'seti_saved',status:'succeeded',customer:'cus_owner',payment_method:'pm_owner'},calls:[],rpc:[],reads:[],writes:[],client:adClient,...changes};
  f.provider=async(route,form,key)=>{f.calls.push({route,form:form?Object.fromEntries(form):null,key});if(f.failRoute===route)throw Error('synthetic provider unavailable');if(route==='customers')return {id:'cus_newowner'};if(route==='checkout/sessions')return {id:'cs_new',url:f.checkoutUrl??'https://checkout.stripe.com/c/pay/fixture'};if(route.endsWith('/expire'))return {status:f.expiryStatus??'expired'};if(route.startsWith('checkout/sessions/'))return f.session;if(route.startsWith('payment_intents/'))return f.intent;if(route.startsWith('setup_intents/'))return f.setupIntent;throw Error('Unexpected synthetic provider route');};
  f.owner={client:adClient(),salonId:'salon_a',userId:'owner_a'};return f;
}

test('ad-credit checkout freezes stored amount/metadata and does not reuse another payer or grant credits',async()=>{
  try{
    const f=adFixture();assert.equal(await ads.createCreditCheckout(f.owner,500,false),'https://checkout.stripe.com/c/pay/fixture');
    const call=f.calls[0];assert.equal(call.route,'checkout/sessions');assert.equal(call.form['line_items[0][price_data][unit_amount]'],'500');assert.equal(call.form['metadata[campaign_credit_order]'],O);assert.equal(call.form['payment_intent_data[metadata][campaign_credit_order]'],O);assert.equal(call.form.customer,undefined);assert.equal(call.form['payment_intent_data[setup_future_usage]'],undefined);assert.equal(call.key,`campaign-checkout:${O}`);
    assert.equal(f.rpc.some(c=>c.name==='campaign_credit_paid'),false);assert.match(call.form.success_url,/salon=salon_a/);
    const bad=adFixture({checkoutUrl:'https://checkout.stripe.com.evil.test/c/pay/fixture'});await assert.rejects(ads.createCreditCheckout(bad.owner,500,false));assert.equal(bad.rpc.some(c=>c.name==='campaign_credit_paid'),false);
  }finally{delete globalThis.__iosAd;}
});

test('ad-credit return/retry cannot claim paid before owned order, verified intent and ledger acceptance',async()=>{
  try{
    let f=adFixture();f.session.status='open';assert.equal(await ads.confirmCampaignCheckout(f.owner,'cs_saved'),false);assert.equal(f.rpc.length,0);
    f=adFixture();f.order.owner_id='owner_other';await assert.rejects(ads.confirmCampaignCheckout(f.owner,'cs_saved'));assert.equal(f.rpc.length,0);
    f=adFixture();f.intent.status='requires_action';await assert.rejects(ads.confirmCampaignCheckout(f.owner,'cs_saved'));assert.equal(f.rpc.length,0);
    f=adFixture({rpcError:true});await assert.rejects(ads.confirmCampaignCheckout(f.owner,'cs_saved'));assert.equal(f.rpc[0].name,'campaign_credit_paid');
    f=adFixture();assert.equal(await ads.confirmCampaignCheckout(f.owner,'cs_saved'),true);assert.equal(await ads.confirmCampaignCheckout(f.owner,'cs_saved'),true);
    assert.equal(f.rpc.length,2);assert.deepEqual(f.rpc[0],f.rpc[1]);assert.equal(f.rpc[0].args.p_order,O);assert.equal(f.rpc[0].args.p_reference,'pi_saved');assert.equal(f.rpc[0].args.p_method,null);assert.ok(f.calls.every(c=>c.form===null));
  }finally{delete globalThis.__iosAd;}
});

test('ad-credit cancellation does not relabel completed or uncertain payment and only expires the saved session',async()=>{
  try{
    let f=adFixture();assert.equal(await ads.cancelCampaignCheckout(f.owner,O),false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,1);
    f=adFixture({failRoute:'checkout/sessions/cs_saved/expire'});f.session.status='open';await assert.rejects(ads.cancelCampaignCheckout(f.owner,O));assert.equal(f.writes.length,0);
    f=adFixture();f.session.status='open';assert.equal(await ads.cancelCampaignCheckout(f.owner,O),true);
    assert.deepEqual(f.calls.map(c=>c.route),['checkout/sessions/cs_saved','checkout/sessions/cs_saved/expire']);assert.equal(f.calls[1].key,`campaign-cancel:${O}`);assert.deepEqual(f.writes[0].values,{status:'cancelled'});assert.deepEqual(f.writes[0].filters,[['id',O],['status','pending']]);assert.equal(f.rpc.length,0);
    f=adFixture({updateError:true});f.session.status='open';await assert.rejects(ads.cancelCampaignCheckout(f.owner,O));assert.equal(f.writes.length,0);
  }finally{delete globalThis.__iosAd;}
});

function setupFixture(){const f=adFixture();f.session={id:'cs_saved',mode:'setup',status:'complete',customer:'cus_owner',setup_intent:'seti_saved',metadata:{campaign_card_setup:O,campaign_owner:'owner_a',campaign_salon:'salon_a'}};return f;}
test('card setup freezes its owner/revision and verification never enables an automatic purchase',async()=>{
  try{
    let f=adFixture();assert.equal(await ads.createCampaignCardSetup(f.owner),'https://checkout.stripe.com/c/pay/fixture');
    assert.deepEqual(f.calls.map(c=>c.route),['customers','checkout/sessions']);assert.equal(f.calls[0].form['metadata[campaign_owner]'],'owner_a');
    const saved=f.writes.find(w=>w.table==='campaign_card_setups');assert.equal(saved.values.payment_revision,4);assert.equal(saved.values.owner_id,'owner_a');assert.equal(f.calls[1].form.mode,'setup');assert.equal(f.calls[1].form['metadata[campaign_card_setup]'],saved.values.id);assert.equal(f.rpc.length,0);
    f=setupFixture();f.session.metadata.campaign_salon='salon_other';await assert.rejects(ads.finishCampaignCardSetup(f.owner,'cs_saved'));assert.equal(f.rpc.length,0);
    f=setupFixture();f.setupIntent.customer='cus_other';await assert.rejects(ads.finishCampaignCardSetup(f.owner,'cs_saved'));assert.equal(f.rpc.length,0);
    f=setupFixture();await ads.finishCampaignCardSetup(f.owner,'cs_saved');assert.deepEqual(f.rpc,[{name:'campaign_save_card',args:{p_setup:O,p_owner:'owner_a',p_customer:'cus_owner',p_method:'pm_owner'}}]);
    f=setupFixture();f.wallet.payment_revision=5;await ads.fulfillCampaignCardSetup('cs_saved');assert.equal(f.rpc.length,0);
    f=setupFixture();await ads.fulfillCampaignCardSetup('cs_saved');assert.equal(f.rpc.length,1);assert.equal(f.rpc[0].name,'campaign_save_card');assert.equal(f.calls.some(c=>c.route==='payment_intents'),false);
  }finally{delete globalThis.__iosAd;}
});

test('automatic credit retry reads its saved provider reference and preserves the frozen claim instead of charging again',async()=>{
  const previousFetch=globalThis.fetch,f=adFixture();
  f.wallet={...f.wallet,payment_owner:'owner_a',installed:true,auto_topup_enabled:true,topup_credits:500};
  f.order={...f.order,automatic:true,status:'processing'};
  f.claim={provider_reference:'pi_saved',amount:500,customer:'cus_frozen',method:'pm_frozen'};
  f.intent.status='processing';
  const requests=[];
  globalThis.fetch=async(value,init)=>{const url=new URL(value);assert.equal(url.origin,'https://api.stripe.com');assert.equal(url.pathname,'/v1/payment_intents/pi_saved');requests.push({method:init.method,path:url.pathname,body:init.body});return Response.json(f.intent);};
  f.runQueue=async options=>{assert.equal(await options.paymentReady(),true);await options.topUp('salon_a',Date.now()+30000);return {ok:true};};
  try{
    await assert.rejects(ads.processCampaignCreditQueue(),/needs attention/);assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');assert.equal(requests[0].body,undefined);assert.equal(f.rpc.some(c=>c.name==='campaign_credit_paid'),false);
    assert.ok(f.writes.every(w=>w.table==='campaign_credit_orders'));assert.equal(f.writes.some(w=>Object.hasOwn(w.values,'auto_topup_enabled')),false);
    const original={...f.claim};f.wallet.topup_credits=1500;f.order.status='processing';f.intent.status='succeeded';
    assert.deepEqual(await ads.processCampaignCreditQueue(),{ok:true});assert.deepEqual(f.claim,original);assert.equal(requests.length,3);assert.ok(requests.every(r=>r.method==='GET'&&r.body===undefined));
    const paid=f.rpc.filter(c=>c.name==='campaign_credit_paid');assert.equal(paid.length,1);assert.equal(paid[0].args.p_order,O);assert.equal(paid[0].args.p_reference,'pi_saved');assert.equal(paid[0].args.p_amount,500);
    assert.equal(f.rpc.filter(c=>c.name==='campaign_credit_claim').length,2);
  }finally{globalThis.fetch=previousFetch;delete globalThis.__iosAd;}
});

const cardEvents=await load('lib/market-card.ts',{
  'server-only':'',
  './platform-payment':`export async function paymentConfig(){return {}}export async function paymentStripe(route,form){const f=globalThis.__iosExpiry;f.provider.push({route,form});return f.event}`,
  './market-payments':`export function marketServiceClient(){const f=globalThis.__iosExpiry;return {from(table){if(table!=='market_card_events')throw Error('Unexpected event table');const q={values:null,select(){return q},eq(){return q},update(v){q.values=v;return q},async maybeSingle(){return {data:f.saved,error:null}},async upsert(v){f.saved={...v};return {error:null}},then(resolve,reject){f.saved={...f.saved,...q.values};f.states.push(f.saved.status);return Promise.resolve({error:null}).then(resolve,reject)}};return q}}}`,
  './campaign-payments':`export async function expireCreditCheckout(id){return globalThis.__iosAd.expireActual(id)}export async function fulfillCreditPayment(){throw Error('Unexpected credit fulfillment')}export async function fulfillCampaignCardSetup(){throw Error('Unexpected card setup')}`,
  './market-tax':`export async function recordMarketTaxInvoice(){throw Error('Unexpected invoice')}export function validateMarketTaxInvoice(){throw Error('Unexpected invoice')}`,
});
test('failed credit-checkout expiry remains a failed webhook, then same event retries without charge or fulfillment',async()=>{
  const f=adFixture({updateError:true});f.expireActual=ads.expireCreditCheckout;
  const event=globalThis.__iosExpiry={saved:null,states:[],provider:[],event:{id:'evt_expiry',livemode:true,type:'checkout.session.expired',data:{object:{id:'cs_saved',metadata:{campaign_credit_order:O}}}}};
  try{
    await assert.rejects(cardEvents.processCardEvent('evt_expiry'),/expiry needs retry/);assert.equal(event.saved.status,'failed');assert.deepEqual(event.states,['failed']);assert.equal(f.writes.length,0);
    f.updateError=false;await cardEvents.processCardEvent('evt_expiry');assert.equal(event.saved.status,'processed');assert.equal(event.saved.attempts,2);assert.deepEqual(f.writes[0].values,{status:'cancelled'});assert.deepEqual(f.writes[0].filters,[['id',O],['automatic',false],['status','pending']]);assert.equal(f.rpc.length,0);assert.equal(f.calls.length,0);
    assert.ok(event.provider.every(c=>c.route==='events/evt_expiry'&&c.form===undefined));
    const writes=f.writes.length;await cardEvents.processCardEvent('evt_expiry');assert.equal(f.writes.length,writes);assert.equal(event.provider.length,2);
  }finally{delete globalThis.__iosAd;delete globalThis.__iosExpiry;}
});
