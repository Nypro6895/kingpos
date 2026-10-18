import test from 'node:test';import assert from 'node:assert/strict';import {build}from'esbuild';
const bundle=await build({entryPoints:['lib/campaign-payments.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'isolated',setup(b){b.onResolve({filter:/^(server-only|@\/lib\/explore-advertising|\.\/platform-payment)$/},a=>({path:a.path,namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},a=>({loader:'js',contents:a.path==='server-only'?'':a.path.endsWith('platform-payment')?'export async function paymentConfig(){return{enabled:false}};export async function paymentStripe(){throw Error("No provider configured")}':'export function advertisingClient(){throw Error("No global client allowed")}'}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('card setup verifies owner, salon, provider completion and customer before storing only a verified method',async()=>{
 const original=globalThis.fetch;process.env.CAMPAIGN_STRIPE_SECRET_KEY='test-only';process.env.CAMPAIGN_STRIPE_WEBHOOK_SECRET='test-only';
 const salonId='10000000-0000-0000-0000-000000000001',userId='00000000-0000-0000-0000-000000000001',setup='40000000-0000-0000-0000-000000000001';
 const writes=[];const owner={salonId,userId,client:{rpc:async(name,input)=>{writes.push({name,input});return{error:null}}}};
 let session={mode:'setup',status:'complete',customer:'cus_test',setup_intent:'seti_test',metadata:{campaign_owner:userId,campaign_salon:salonId,campaign_card_setup:setup}},intent={status:'succeeded',customer:'cus_test',payment_method:'pm_test'};
 globalThis.fetch=async url=>Response.json(String(url).includes('/setup_intents/')?intent:session);
 try{
  await assert.rejects(api.finishCampaignCardSetup(owner,'https://untrusted.example'),/Reopen/);
  session={...session,metadata:{...session.metadata,campaign_owner:'other'}};await assert.rejects(api.finishCampaignCardSetup(owner,'cs_test'),/not complete/);assert.equal(writes.length,0);
  session={...session,metadata:{...session.metadata,campaign_owner:userId}};intent={...intent,customer:'cus_other'};await assert.rejects(api.finishCampaignCardSetup(owner,'cs_test'),/not complete/);assert.equal(writes.length,0);
  intent={...intent,customer:'cus_test',status:'requires_action'};await assert.rejects(api.finishCampaignCardSetup(owner,'cs_test'),/not complete/);
  intent={...intent,status:'succeeded'};await api.finishCampaignCardSetup(owner,'cs_test');assert.deepEqual(writes,[{name:'campaign_save_card',input:{p_setup:setup,p_owner:userId,p_customer:'cus_test',p_method:'pm_test'}}]);
 }finally{globalThis.fetch=original;delete process.env.CAMPAIGN_STRIPE_SECRET_KEY;delete process.env.CAMPAIGN_STRIPE_WEBHOOK_SECRET;}
});
test('cancelled checkout is expired at the provider before releasing its pending order',async()=>{
 const original=globalThis.fetch;process.env.CAMPAIGN_STRIPE_SECRET_KEY='test-only';
 const events=[];let sessionStatus='open';let order={checkout_session_id:'cs_test',status:'pending',automatic:false};
 const owner={salonId:'10000000-0000-0000-0000-000000000001',userId:'00000000-0000-0000-0000-000000000001',client:{from(){const q={select(){return q},eq(){return q},single:async()=>({data:order,error:null}),update(payload){events.push(['database',payload]);return q},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q}}};
 globalThis.fetch=async(url,options)=>{events.push(['provider',String(url),options.method]);return Response.json({status:String(url).endsWith('/expire')?'expired':sessionStatus});};
 try{
  assert.equal(await api.cancelCampaignCheckout(owner,'30000000-0000-0000-0000-000000000001'),true);
  assert.deepEqual(events.map(e=>e[0]),['provider','provider','database']);assert.equal(events[1][2],'POST');assert.deepEqual(events[2][1],{status:'cancelled'});
  events.length=0;sessionStatus='complete';assert.equal(await api.cancelCampaignCheckout(owner,'30000000-0000-0000-0000-000000000001'),false);assert.equal(events.length,1);
  order={...order,automatic:true};await assert.rejects(api.cancelCampaignCheckout(owner,'30000000-0000-0000-0000-000000000001'),/cancelled/);
  await assert.rejects(api.cancelCampaignCheckout(owner,'other'),/cancelled/);
 }finally{globalThis.fetch=original;delete process.env.CAMPAIGN_STRIPE_SECRET_KEY;}
});
