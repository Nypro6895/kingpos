import test from 'node:test';import assert from 'node:assert/strict';import{build}from'esbuild';import{mkdirSync}from'node:fs';import{createRequire}from'node:module';
mkdirSync('artifacts/owner-financial-attention/unit',{recursive:true});
await build({entryPoints:['app/api/shop-money/route.ts'],bundle:true,platform:'node',format:'cjs',outfile:'artifacts/owner-financial-attention/unit/shop-api.cjs',external:['next/server'],plugins:[{name:'auth-fixture',setup(b){b.onResolve({filter:/^@\//},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('current-context')?'export const getCurrentBusinessContext=async()=>globalThis.fixture.context;export const isOwnerMembership=m=>m?.role_code==="OWNER";':path.endsWith('supabase/server')?'export const createAuthenticatedSupabaseServerClient=async()=>({rpc:async(...args)=>{globalThis.fixture.calls.push(args);return globalThis.fixture.result;}});':'export const readOwnerFinancialAttention=async()=>({salonId:"salon",viewerId:"owner",items:[],total:0});'}));}}]});
const require=createRequire(import.meta.url),{NextRequest}=require('next/server'),{GET,POST}=require('../artifacts/owner-financial-attention/unit/shop-api.cjs');
const reset=()=>globalThis.fixture={context:{user:{id:'owner'},currentSalon:{id:'salon'},currentMembership:{role_code:'OWNER'}},calls:[],result:{data:null,error:null}};

test('live Shop GET is owner-only, salon-bound, uncached and cannot invoke a write',async()=>{
 const read=(query)=>GET(new NextRequest('https://reylumi.com/api/shop-money?'+query));let f=reset();f.result={data:{days:[]},error:null};
 let response=await read('salonId=salon&start=2026-10-16&end=2026-10-31');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(f.calls,[['shop_money_read',{p_salon:'salon',p_start:'2026-10-16',p_end:'2026-10-31'}]]);
 f=reset();f.context.currentMembership.role_code='MANAGER';assert.equal((await read('salonId=salon')).status,403);assert.equal(f.calls.length,0);
 f=reset();assert.equal((await read('salonId=other')).status,409);assert.equal(f.calls.length,0);
 assert.equal((await read('op=collection&salonId=salon')).status,400);assert.equal((await read('salonId=salon&salonId=other')).status,400);
});
