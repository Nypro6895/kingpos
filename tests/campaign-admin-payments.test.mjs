import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['lib/campaign-payments.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'fixture',setup(b){b.onResolve({filter:/^(server-only|@\/lib\/explore-advertising|\.\/platform-payment)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='server-only'?'':a.path.endsWith('platform-payment')?'export async function paymentConfig(){return{enabled:false}};export async function paymentStripe(){throw Error("Unexpected provider request")}':'export function advertisingClient(){return globalThis.creditAdminClient}'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('admin reconciliation verifies order, currency, amount and completion without issuing another charge',async()=>{
 const id='30000000-0000-0000-0000-000000000001',original=globalThis.fetch,oldKey=process.env.CAMPAIGN_STRIPE_SECRET_KEY;
 process.env.CAMPAIGN_STRIPE_SECRET_KEY='test-only';let order={id,status:'processing',provider_reference:null,checkout_session_id:null};let balance=0,paid=false;const requests=[],writes=[];
 globalThis.creditAdminClient={from(){const q={select(){return q},eq(){return q},single:async()=>({data:order,error:null})};return q;},async rpc(name,input){writes.push({name,input});if(input.p_amount!==500)return{error:{message:'Payment amount mismatch'}};if(!paid){paid=true;balance+=500;}return{error:null};}};
 let intent={id:'pi_verified',metadata:{campaign_credit_order:id},status:'succeeded',currency:'usd',amount_received:500};let session={status:'complete',payment_status:'paid',metadata:{campaign_credit_order:id},payment_intent:'pi_verified'};
 globalThis.fetch=async(url,options)=>{requests.push({url:String(url),method:options.method});assert.equal(options.method,'GET','reconciliation must never confirm/create a charge');return Response.json(String(url).includes('checkout/sessions')?session:intent);};
 try{
  await assert.rejects(api.reconcileCampaignCreditOrder(id),/No new charge/);assert.equal(requests.length,0);
  await assert.rejects(api.reconcileCampaignCreditOrder(id,'https://untrusted.example'),/reference/);assert.equal(requests.length,0);
  intent={...intent,metadata:{campaign_credit_order:'another-order'}};await assert.rejects(api.reconcileCampaignCreditOrder(id,'pi_verified'),/belong/);assert.equal(writes.length,0);
  intent={...intent,metadata:{campaign_credit_order:id},status:'requires_action'};await assert.rejects(api.reconcileCampaignCreditOrder(id,'pi_verified'),/not complete/);assert.equal(writes.length,0);
  intent={...intent,status:'succeeded',currency:'eur'};await assert.rejects(api.reconcileCampaignCreditOrder(id,'pi_verified'),/not complete/);assert.equal(writes.length,0);
  intent={...intent,currency:'usd',amount_received:499};await assert.rejects(api.reconcileCampaignCreditOrder(id,'pi_verified'),/recorded/);assert.equal(balance,0);
  intent={...intent,amount_received:500};await assert.rejects(api.fulfillCreditPayment('pi_verified','another-order'),/belong/);await api.reconcileCampaignCreditOrder(id,'pi_verified');await api.reconcileCampaignCreditOrder(id,'pi_verified');assert.equal(balance,500,'fulfillment replay is idempotent');
  assert.equal(writes.at(-1).input.p_order,id);
  order={...order,checkout_session_id:'cs_checkout'};session={...session,metadata:{campaign_credit_order:'other'}};await assert.rejects(api.reconcileCampaignCreditOrder(id),/belong/);
  session={...session,metadata:{campaign_credit_order:id},payment_status:'unpaid'};await assert.rejects(api.reconcileCampaignCreditOrder(id),/not complete/);
  session={...session,payment_status:'paid'};await api.reconcileCampaignCreditOrder(id);assert.equal(balance,500);assert.ok(requests.every(r=>r.method==='GET'));
 }finally{globalThis.fetch=original;delete globalThis.creditAdminClient;if(oldKey===undefined)delete process.env.CAMPAIGN_STRIPE_SECRET_KEY;else process.env.CAMPAIGN_STRIPE_SECRET_KEY=oldKey;}
});
