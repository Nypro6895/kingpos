import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHmac,randomBytes} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
async function bundle(file,stubs={}){
 const out=await build({entryPoints:[path.join(root,file)],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'isolate',setup(api){api.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'stub'}));api.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'stub'}:undefined);api.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path]||'',loader:'ts'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
test('shared card provider: encrypted secrets, signature replay checks, exact recurring price, safe API requests',async()=>{
 const savedKey=process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY;const savedFetch=globalThis.fetch;
 process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const provider=await bundle('lib/platform-payment.ts',{'./market-payments':`export const marketServiceClient=()=>({from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:globalThis.__config,error:null})}}});`});
 const rules=await bundle('lib/market-card-rules.ts');
 try{
  const config={secretKey:'sk_live_fake',publishableKey:'pk_live_fake',webhookSecret:'whsec_fake',webhookId:'we_fake',accountId:'acct_fake',enabled:true,mode:'live',version:2};
  const encrypted=provider.encryptPayment(config);assert.ok(!encrypted.includes(config.secretKey));globalThis.__config={encrypted_config:encrypted,version:3};assert.equal((await provider.paymentConfig()).version,3);assert.equal((await provider.paymentConfig()).secretKey,config.secretKey);assert.equal(provider.publicPayment(config).secretKey,undefined);assert.equal(provider.publicPayment(config).webhookSecret,undefined);
  const body='{"id":"evt_demo"}',ts=1000,mac=createHmac('sha256',config.webhookSecret).update(ts+'.'+body).digest('hex');assert.equal(provider.paymentSignature(body,`t=${ts},v1=${mac}`,config.webhookSecret,1000000),true);assert.equal(provider.paymentSignature(body+'x',`t=${ts},v1=${mac}`,config.webhookSecret,1000000),false);assert.equal(provider.paymentSignature(body,`t=${ts},v1=${mac}`,config.webhookSecret,1400000),false);assert.equal(provider.paymentSignature(body,'t=NaN,v1=abc',config.webhookSecret),false);
  const price={currency:'usd',unit_amount:199,recurring:{interval:'month',interval_count:1}};assert.equal(rules.validCardQuote({items:{data:[{quantity:1,price}]}},199),true);assert.equal(rules.validCardQuote({items:{data:[{quantity:2,price}]}},199),false);assert.equal(rules.validCardQuote({items:{data:[{quantity:1,price:{...price,currency:'eur'}}]}},199),false);
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');assert.equal(options.headers['Stripe-Version'],'2024-06-20');assert.equal(options.headers['Idempotency-Key'],'purchase-fixed-id');assert.equal(options.body,'amount=199');return {ok:true,json:async()=>({id:'cs_fake'})}};
  assert.equal((await provider.paymentStripe('checkout/sessions',new URLSearchParams({amount:'199'}),'purchase-fixed-id',config)).id,'cs_fake');
  globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({error:{message:config.secretKey}})});await assert.rejects(provider.paymentStripe('account',undefined,undefined,config),error=>error.message.includes('401')&&!error.message.includes(config.secretKey));
 }finally{globalThis.fetch=savedFetch;delete globalThis.__config;if(savedKey===undefined)delete process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY;else process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY=savedKey;}
});
