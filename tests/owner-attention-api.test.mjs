import test from 'node:test';import assert from 'node:assert/strict';import{build}from'esbuild';import{mkdirSync}from'node:fs';import{createRequire}from'node:module';
mkdirSync('artifacts/owner-financial-attention/unit',{recursive:true});
await build({entryPoints:['app/api/owner-attention/route.ts'],bundle:true,platform:'node',format:'cjs',outfile:'artifacts/owner-financial-attention/unit/api.cjs',external:['next/server'],plugins:[{name:'auth-fixture',setup(b){b.onResolve({filter:/^@\//},args=>({path:args.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('current-context')?'export const getCurrentBusinessContext=async()=>globalThis.fixture.context;export const isOwnerMembership=m=>m?.role_code==="OWNER";':path.endsWith('supabase/server')?'export const createAuthenticatedSupabaseServerClient=async()=>({rpc:async(...args)=>{globalThis.fixture.calls.push(args);return globalThis.fixture.result;}});':'export const readOwnerFinancialAttention=async()=>({salonId:"salon",viewerId:"owner",items:[],total:0});'}));}}]});
const require=createRequire(import.meta.url),{NextRequest}=require('next/server'),{GET,POST}=require('../artifacts/owner-financial-attention/unit/api.cjs');
const reset=()=>globalThis.fixture={context:{user:{id:'owner'},currentSalon:{id:'salon'},currentMembership:{role_code:'OWNER'}},calls:[],result:{data:null,error:null}};
const post=(body,origin='https://reylumi.com')=>POST(new NextRequest('https://reylumi.com/api/owner-attention',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)}));
const action={op:'ignore',salonId:'salon',viewerId:'owner',item:'discount:1'};
test('API refuses unauthenticated, manager, cross-salon and changed-viewer writes before RPC',async()=>{
 let f=reset();f.context.user=null;assert.equal((await post(action)).status,401);
 f=reset();f.context.currentMembership.role_code='MANAGER';assert.equal((await post(action)).status,403);assert.equal(f.calls.length,0);
 f=reset();assert.equal((await post({...action,salonId:'other'})).status,409);assert.equal((await post({...action,viewerId:'other'})).status,409);assert.equal(f.calls.length,0);
});
test('Ignore routes only to the owner metadata RPC; stale keys are not accepted',async()=>{
 const f=reset();assert.equal((await post(action)).status,200);assert.deepEqual(f.calls,[['owner_financial_attention_action',{p_salon:'salon',p_item:'discount:1',p_action:'ignore'}]]);
 f.result={error:{code:'40001'}};assert.equal((await post(action)).status,409);
 assert.equal((await post({...action,op:'review_closing'})).status,400);
});
test('API bounds requests and rejects foreign origins and unknown GET arguments',async()=>{
 reset();assert.equal((await post(action,'https://foreign.example')).status,403);assert.equal((await post({...action,item:'x'.repeat(2200)})).status,400);
 assert.equal((await GET(new NextRequest('https://reylumi.com/api/owner-attention?salonId=salon&unknown=1'))).status,400);
 assert.equal((await GET(new NextRequest('https://reylumi.com/api/owner-attention?salonId=other'))).status,409);
 assert.equal((await GET(new NextRequest('https://reylumi.com/api/owner-attention?salonId=salon'))).status,200);
});
