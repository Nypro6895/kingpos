import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('Gift receipt API derives its salon, rejects locked Portable and invalid requests, and never caches credentials',async()=>{
 const replacements={
  'next/headers':`export async function cookies(){return {get:key=>{const value=globalThis.__giftDeliveryFixture.cookies[key];return value?{value}:undefined}};}`,
  '@/lib/current-context':`export async function getCurrentBusinessContext(){return {currentSalon:globalThis.__giftDeliveryFixture.ownerSalon?{id:globalThis.__giftDeliveryFixture.ownerSalon}:null};}`,
  '@/lib/supabase/server':`const db={rpc:async(name,args)=>{const f=globalThis.__giftDeliveryFixture;f.calls.push({name,args});return name==='get_pos_portable_access_context'?{data:f.portableSalon?{salon_id:f.portableSalon}:null}:{data:f.reply,error:f.error};}};export async function createAuthenticatedSupabaseServerClient(){return globalThis.__giftDeliveryFixture.signedIn?db:null;}export function createSupabaseServerClient(){return db;}`,
 };
 const compiled=await build({entryPoints:['app/api/gift-cards/ticket-delivery/route.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'isolated-auth',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'auth'}:undefined);b.onLoad({filter:/.*/,namespace:'auth'},a=>({contents:replacements[a.path],loader:'js'}));}}]});
 const {POST}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 const reset=values=>globalThis.__giftDeliveryFixture={cookies:{},calls:[],signedIn:false,reply:{deliveryStatus:'ready',token:'fixture-only'},...values};
 const ticketId='00000000-0000-4000-8000-000000000001',saleId='00000000-0000-4000-8000-000000000002';
 const request=(data={ticketId,saleId},origin='http://127.0.0.1:5000')=>{const r=new Request('http://127.0.0.1:5000/api/gift-cards/ticket-delivery',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});r.nextUrl=new URL(r.url);return r;};
 try{
  reset({signedIn:true,ownerSalon:'authorized-owner-salon'});let response=await POST(request({ticketId,saleId,salonId:'injected-foreign-salon'}));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(globalThis.__giftDeliveryFixture.calls.at(-1).args.p_salon,'authorized-owner-salon');
  reset({cookies:{'kingpos-portable-pos-key-id':'fixture-key','kingpos-portable-pos-session':'fixture-signature'},portableSalon:'authorized-portable-salon'});response=await POST(request());assert.equal(response.status,200);assert.equal(globalThis.__giftDeliveryFixture.calls.at(-1).args.p_salon,'authorized-portable-salon');
  reset({cookies:{'kingpos-portable-pos-key-id':'fixture-key','kingpos-portable-pos-session':'fixture-signature','kingpos-portable-local-lock':'1'},portableSalon:'authorized-portable-salon',ownerSalon:'owner-fallback',signedIn:true});response=await POST(request());assert.equal(response.status,400);assert.match((await response.json()).error,/Unlock/);assert.equal(globalThis.__giftDeliveryFixture.calls.length,0,'local lock cannot fall through to owner or Portable RPC');
  reset();response=await POST(request());assert.equal(response.status,400);assert.equal((await response.json()).token,undefined);assert.equal(globalThis.__giftDeliveryFixture.calls.length,0);
  reset({signedIn:true,ownerSalon:'owner'});response=await POST(request({ticketId:'bad',saleId}));assert.equal(response.status,400);assert.equal(globalThis.__giftDeliveryFixture.calls.length,0);
  response=await POST(request(undefined,'https://foreign.invalid'));assert.equal(response.status,403);assert.equal(globalThis.__giftDeliveryFixture.calls.length,0);
  reset({signedIn:true,ownerSalon:'owner',error:{message:'POS access required'},reply:null});response=await POST(request());assert.equal(response.status,400);assert.equal((await response.json()).token,undefined);
 }finally{delete globalThis.__giftDeliveryFixture;}
});
