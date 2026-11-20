import test from'node:test';import assert from'node:assert/strict';import{build}from'esbuild';import fs from'node:fs';import path from'node:path';import{pathToFileURL}from'node:url';
const salon='00000000-0000-4000-8000-000000000010';
test('Badge HTTP boundary is no-store, bounded and preserves session/device authority',async()=>{
 const out=path.resolve('artifacts/member-everywhere/http-route.mjs');fs.mkdirSync(path.dirname(out),{recursive:true});
 const stubs={
 'next/server':'export class NextResponse { static json(data,options){return Response.json(data,options)} }',
 'next/headers':'export async function cookies(){return{get:key=>globalThis.__badgeHttp.cookies[key]?{value:globalThis.__badgeHttp.cookies[key]}:undefined}}',
 '@/lib/supabase/server':`const client={rpc:async(name,args)=>{globalThis.__badgeHttp.calls.push({name,args});return{data:globalThis.__badgeHttp.rows,error:null}}};export async function createAuthenticatedSupabaseServerClient(){return globalThis.__badgeHttp.auth?client:null}export function createSupabaseServerClient(){return client}`,
 '@/lib/platform-admin/auth':'export async function getCurrentPlatformAdminContext(){return globalThis.__badgeHttp.signedAdmin?{userId:"example"}:null}',
 };
 await build({entryPoints:['app/api/membership/salon-badges/route.ts'],outfile:out,bundle:true,platform:'node',format:'esm',plugins:[{name:'local-auth-contract',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path]}));}}]});
 const {POST}=await import(pathToFileURL(out));
 const state=()=>globalThis.__badgeHttp={auth:false,signedAdmin:false,cookies:{},rows:[{salon_id:salon,valid_until:new Date(Date.now()+10000).toISOString(),price:'must not leak'}],calls:[]};
 const request=body=>new Request('https://fixture.invalid/api/membership/salon-badges',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
 let s=state(),response=await POST(request({ids:[salon]}));assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal(s.calls[0].name,'reylumi_membership_salon_badges');assert.deepEqual(Object.keys((await response.json()).badges[0]).sort(),['salon_id','valid_until']);
 s=state();s.auth=true;await POST(request({ids:[salon]}));assert.equal(s.calls[0].name,'reylumi_membership_scoped_badges');assert.equal(s.calls[0].args.p_admin,false);s.signedAdmin=true;await POST(request({ids:[salon]}));assert.equal(s.calls[1].args.p_admin,true);
 s=state();s.cookies={'kingpos-portable-pos-key-id':salon,'kingpos-portable-pos-session':'sample signature','kingpos-portable-local-lock':'1'};await POST(request({ids:[salon]}));assert.equal(s.calls.length,1);delete s.cookies['kingpos-portable-local-lock'];await POST(request({ids:[salon]}));assert.equal(s.calls.at(-1).name,'reylumi_membership_portable_badges');
 s=state();response=await POST(request({ids:[],reference:{kind:'display',value:'sample token'}}));assert.equal(response.status,200);assert.equal(s.calls[0].name,'reylumi_membership_reference_badge');
 for(const body of [{ids:['invalid']},{ids:Array(101).fill(salon)},{ids:[],reference:{kind:'arbitrary',value:'x'}},{ids:[],reference:{kind:'display',value:'x'.repeat(257)}}]){s=state();assert.equal((await POST(request(body))).status,400);assert.equal(s.calls.length,0);}
 }finally{delete globalThis.__badgeHttp;}
});
