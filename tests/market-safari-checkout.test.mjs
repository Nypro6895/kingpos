import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(process.env.MARKET_SYSTEM_SOURCE||'.');
const url='https://checkout.stripe.com/c/pay/cs_hosted';
async function actions(){
 const mocks={
  '@/lib/market-plugins':`export async function marketPluginContext(){const c=globalThis.safariFixture;if(c.denied)throw Error('Not authorized');return{salonId:'salon',client:{async rpc(name,args){c.reservations.push({name,args});return {data:c.rows.shift()??c.row,error:null}}}}}`,
  '@/lib/market-payments':`export function marketServiceClient(){const c=globalThis.safariFixture;return{from(){const q={update(v){c.updates.push(v);return q},eq(){return q},in(){return q},then(resolve,reject){return Promise.resolve({error:null}).then(resolve,reject)}};return q}}}`,
  '@/lib/platform-payment':`export async function paymentConfig(){return {enabled:true,mode:'live',webhookSecret:'secret',publishableKey:'pk'}} export async function paymentStripe(path,form,key){const c=globalThis.safariFixture;c.provider.push({path,form:form?Object.fromEntries(form):null,key});if(path.endsWith('/expire')){if(c.expireFailure)throw Error('Session already complete');return {status:'expired'}} if(form)return {id:'cs_new',url:c.url,client_secret:'secret'};return c.session}`,
  '@/lib/market-card':`export async function syncCardSubscription(id){globalThis.safariFixture.synced.push(id);return true}`,
  '@/lib/market-tax':`export async function applyMarketTaxToCheckout(){}`,
  'next/cache':`export function revalidatePath(){}`,
 };
 const out=await build({entryPoints:[path.join(root,'app/market/card-payment-actions.ts')],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':root},plugins:[{name:'fixture',setup(api){api.onResolve({filter:/.*/},a=>mocks[a.path]?{path:a.path,namespace:'stub'}:undefined);api.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:mocks[a.path]}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
function fixture(){const c={rows:[],row:{id:'purchase',amount_cents:100,created_at:new Date().toISOString(),snapshot:{name:'Booking policy',checkout_ui_mode:'hosted'}},reservations:[],provider:[],updates:[],synced:[],url,session:{id:'cs_old',status:'open',client_secret:'oldsecret'}};globalThis.safariFixture=c;return c;}
test('native checkout uses hosted Stripe and never exposes an embedded client secret',async t=>{
 const a=await actions();
 try{
  await t.test('hosted checkout has success/cancel links and keeps payment authority on server',async()=>{const c=fixture();assert.deepEqual(await a.startCardCheckout('booking-policy',true),{checkoutUrl:url});assert.equal(c.reservations[0].name,'market_card_reserve_safari');const form=c.provider[0].form;assert.equal(form.ui_mode,'hosted');assert.equal(form.return_url,undefined);assert.equal(form.redirect_on_completion,undefined);assert.equal(form.success_url,'https://reylumi.com/market/payment-return');assert.deepEqual(c.synced,[]);});
  await t.test('an old embedded session is expired before a hosted replacement is reserved',async()=>{const c=fixture();c.rows=[{...c.row,id:'old',session_id:'cs_old',snapshot:{name:'Booking policy'}},c.row];assert.deepEqual(await a.startCardCheckout('booking-policy',true),{checkoutUrl:url});assert.deepEqual(c.provider.map(x=>x.path),['checkout/sessions/cs_old','checkout/sessions/cs_old/expire','checkout/sessions']);assert.equal(c.reservations.length,2);assert.equal(c.provider[2].key,'market-card:purchase');});
  await t.test('ambiguous expiry never creates a second checkout',async()=>{const c=fixture();c.rows=[{...c.row,id:'old',session_id:'cs_old',snapshot:{}}];c.expireFailure=true;const r=await a.startCardCheckout('booking-policy',true);assert.match(r.message,/already complete/);assert.equal(r.checkoutUrl,undefined);assert.equal(r.clientSecret,undefined);assert.equal(c.reservations.length,1);});
  await t.test('legacy lost acknowledgements recreate the original embedded payload before expiring it',async()=>{const c=fixture();c.rows=[{...c.row,id:'legacy',snapshot:{name:'Booking policy'}},c.row];await a.startCardCheckout('booking-policy',true);assert.equal(c.provider[0].form.ui_mode,'embedded');assert.equal(c.provider[0].key,'market-card:legacy');assert.equal(c.provider[1].path,'checkout/sessions/cs_new/expire');assert.equal(c.provider[2].form.ui_mode,'hosted');});
  await t.test('provider completion is reconciled without another purchase',async()=>{const c=fixture();c.row.session_id='cs_old';c.session={status:'complete',subscription:'sub_verified'};assert.equal((await a.startCardCheckout('booking-policy',true)).complete,true);assert.deepEqual(c.synced,['sub_verified']);assert.equal(c.provider.length,1);});
  await t.test('untrusted payment links and unauthorized callers fail closed',async()=>{for(const malicious of ['https://checkout.stripe.com.evil.test/c/pay/cs','http://checkout.stripe.com/c/pay/cs','https://user@checkout.stripe.com/c/pay/cs','https://checkout.stripe.com:8443/c/pay/cs','https://evil.test/']){const c=fixture();c.url=malicious;const result=await a.startCardCheckout('booking-policy',true);assert.equal(result.checkoutUrl,undefined);assert.ok(result.message);}const c=fixture();c.denied=true;await a.startCardCheckout('booking-policy',true);assert.equal(c.provider.length,0);});
 }finally{delete globalThis.safariFixture;}
});

test('Safari reservation freezes presentation while sharing the original owner/concurrency gate',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create table market_card_purchases(id uuid default gen_random_uuid(),snapshot jsonb default '{}',salon_id uuid,plugin text);
   create function market_card_reserve(p_salon uuid,p_plugin text) returns jsonb language plpgsql security definer as $$declare r market_card_purchases%rowtype;begin if current_setting('test.owner',true) is distinct from 'yes' then raise exception 'owner required';end if;select * into r from market_card_purchases where salon_id=p_salon and plugin=p_plugin;if r.id is null then insert into market_card_purchases(salon_id,plugin) values(p_salon,p_plugin) returning * into r;end if;return to_jsonb(r);end$$;
  `);
  await db.exec(fs.readFileSync('supabase/migrations/202610140001_market_safari_checkout.sql','utf8'));
  await assert.rejects(db.query('select market_card_reserve_safari(gen_random_uuid(),$1)',['plugin']),/owner required/);
  await db.exec("set test.owner='yes'");
  const salon='00000000-0000-4000-8000-000000000001';
  const hosted=(await db.query('select market_card_reserve_safari($1,$2) r',[salon,'plugin'])).rows[0].r;
  assert.equal(hosted.snapshot.checkout_ui_mode,'hosted');
  assert.equal((await db.query('select market_card_reserve($1,$2) r',[salon,'plugin'])).rows[0].r.id,hosted.id);
  assert.equal((await db.query('select market_card_reserve($1,$2) r',[salon,'other'])).rows[0].r.snapshot.checkout_ui_mode,'embedded');
 }finally{await db.close();}
});
