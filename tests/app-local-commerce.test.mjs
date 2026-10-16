import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('commerce projections preserve owner authority, never charge on reads, and remove unavailable payment orders',async()=>{
 const state=globalThis.commerceFixture={context:{scope:'owner-a',user:{id:'viewer-a'},currentSalon:{id:'salon-a',name:'Salon A'}},calls:[],installed:true,denied:false,available:true,orders:[{id:'11111111-1111-4111-8111-111111111111',status:'pending',total_cents:2000}],rows:[]};
 const modules={
  'server-only':'',
  'request-business-context':'export async function getRequestBusinessContext(){return globalThis.commerceFixture.context}',
  'experience-context':'export const getExperienceContext=c=>({scope:c.scope})',
  'market-plugins':'export async function marketPluginContext(){const s=globalThis.commerceFixture;if(s.denied)throw Error("denied");return{salonId:s.context.currentSalon.id}}',
  'market-bank-billing':'export async function marketBankBillingState(){const s=globalThis.commerceFixture;s.calls.push("billing-read");return{available:s.available,orders:s.orders}}',
  'booking-deposit':'export async function bookingDepositState(){return{installed:true}}',
  'booking-deposit-market':'export async function bookingDepositPurchaseState(){return{paid:true}}',
  '@/app/campaigns/credit-actions':'export async function campaignWalletAction(){const s=globalThis.commerceFixture;s.calls.push("wallet-read");return{installed:s.installed}}',
  'owner-campaigns':`export async function ownerCampaignSettings(){return{}}export async function requireCampaignOwner(){const s=globalThis.commerceFixture;if(s.denied)throw Object.assign(Error('denied'),{status:403});return{context:s.context,salonId:s.context.currentSalon.id,client:{from(table){s.calls.push(table);const q={select(){return q},eq(){return q},order(){return q},limit(){return Promise.resolve({data:s.rows,error:null})},update(){throw Error('A read must not write')},delete(){throw Error('A read must not write')}};return q}}}}`,
  'explore-advertising':'export function advertisingClient(){throw Error("Public campaigns are not used in this test")}',
 };
 const out=await build({entryPoints:['lib/app-local-commerce-server.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'original-authority',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(modules).find(k=>a.path===k||a.path.endsWith('/'+k));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:modules[a.path]}));}}]});
 const{readAppLocalCommerceResource:read}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
 await assert.rejects(read('owner.campaigns',{}, {scope:'other'}),{status:409});assert.equal(state.calls.length,0);
 state.denied=true;await assert.rejects(read('owner.campaigns',{}, {scope:'owner-a'}),{status:403});assert.equal(state.calls.length,0);state.denied=false;
 const first=await read('owner.campaigns',{}, {scope:'owner-a'});assert.deepEqual(state.calls,['wallet-read','owner_campaigns']);assert.deepEqual(first.data.initialCampaigns,[]);
 const unchanged=await read('owner.campaigns',{}, {scope:'owner-a',etag:first.etag});assert.equal(unchanged.status,304);assert.equal('data'in unchanged,false);
 const args={orderId:state.orders[0].id};const order=await read('owner.market-order',args,{scope:'owner-a'});assert.equal(order.data.order.total_cents,2000);
 state.available=false;await assert.rejects(read('owner.market-order',args,{scope:'owner-a'}),{status:503});state.available=true;state.orders=[];await assert.rejects(read('owner.market-order',args,{scope:'owner-a'}),{status:404});
 state.context.user=null;await assert.rejects(read('owner.deposit-settings',{}, {scope:'owner-a'}),{status:401});
});
