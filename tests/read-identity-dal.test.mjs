import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({stdin:{contents:`export * from './lib/supabase/server';export * from './lib/read-context-scope';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'identity-transport',setup(b){
 b.onResolve({filter:/^@supabase\/supabase-js$|^next\/headers$|^server-only$|(?:^|\/)abuse-context$/},({path})=>({path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:path==='server-only'?'':path==='next/headers'?`export const headers=async()=>new Headers({authorization:'Bearer '+globalThis.__identity.token});export const cookies=async()=>({get:key=>key==='kingpos-login-session-id'?{value:globalThis.__identity.session}:undefined});`:path.endsWith('abuse-context')?'export const safetyRequestHeaders=async()=>({});':`export const createClient=()=>globalThis.__identity.client;export const isAuthSessionMissingError=()=>false;`}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function fixture(){
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-public-key';
 const f={token:'fixture-token',session:'12345678-1234-4234-8234-123456789abc',status:'active',revoked:null,counts:{auth:0,profile:0,session:0}};
 f.client={auth:{getUser:async()=>{f.counts.auth++;return{data:{user:{id:'auth'}},error:null};}},from:name=>{
  const q={select(){return q;},eq(){return q;},async maybeSingle(){if(name==='users'){f.counts.profile++;return{data:{id:'public',auth_user_id:'auth',display_name:'Fixture',status:f.status},error:null};}f.counts.session++;return{data:{revoked_at:f.revoked},error:null};}};return q;
 }};globalThis.__identity=f;return f;
}
test('provider identity, full profile and session are each read once per request across strict callers',async()=>{
 const f=fixture();
 await api.runWithReadContext(async()=>{
  const [a,b]=await Promise.all([api.createAuthenticatedSupabaseServerClient({throwOnUnavailable:true}),api.createAuthenticatedSupabaseServerClient({throwOnUnavailable:true,throwOnRejected:true})]);
  assert(a&&b);await api.getSupabaseAuthUser();
  assert.equal((await api.readPublicUserProfileForAuthIdentity(f.client,f.token,'auth')).data.display_name,'Fixture');
 });
 assert.deepEqual(f.counts,{auth:1,profile:1,session:1});
 await api.runWithReadContext(()=>api.createAuthenticatedSupabaseServerClient({throwOnRejected:true}));
 assert.deepEqual(f.counts,{auth:2,profile:2,session:2});
});
test('final revocation probe bypasses all shared reads; later request sees suspension; writes are fresh',async()=>{
 const f=fixture();
 await api.runWithReadContext(async()=>{
  assert(await api.createAuthenticatedSupabaseServerClient({throwOnRejected:true}));f.revoked='2026-10-27T00:00:00Z';
  await assert.rejects(api.runWithFreshReadValidation(()=>api.createAuthenticatedSupabaseServerClient({throwOnRejected:true})),e=>e.status===401);
 });
 f.revoked=null;f.status='suspended';
 await assert.rejects(api.runWithReadContext(()=>api.createAuthenticatedSupabaseServerClient({throwOnRejected:true})),e=>e.status===403);
 f.status='active';await api.createAuthenticatedSupabaseServerClient();f.status='suspended';assert.equal(await api.createAuthenticatedSupabaseServerClient(),null);
});

test('each final probe verifies afresh but shares its own provider/profile/session reads',async()=>{
 const f=fixture();
 await api.runWithReadContext(async()=>{
  await api.createAuthenticatedSupabaseServerClient({throwOnRejected:true});
  const probe=()=>api.runWithFreshReadValidation(async()=>{
   const values=await Promise.all([api.createAuthenticatedSupabaseServerClient({throwOnRejected:true}),api.createAuthenticatedSupabaseServerClient({throwOnUnavailable:true})]);
   assert(values.every(Boolean));await api.getSupabaseAuthUser();
  });
  await Promise.all([probe(),probe()]);
  assert.deepEqual(f.counts,{auth:3,profile:3,session:3},'page plus two independent final probes');
  f.revoked='2026-10-27T00:00:00Z';
  await assert.rejects(api.runWithFreshReadValidation(()=>api.createAuthenticatedSupabaseServerClient({throwOnRejected:true})),e=>e.status===401);
 });
});
