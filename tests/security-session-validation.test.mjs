import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=ts.transpileModule(readFileSync('lib/supabase/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const sid='20000000-0000-4000-8000-000000000001';
class Unavailable extends Error{}
class Rejected extends Error{}
function fixture({allowed=true,error=null,cookie='tracking',authorization=null,identity=true,registered=true}={}){
 let sessionReads=0;
 let enrollments=0;
 const values=new Map([['sb-access-token','cookie-access'],['sb-refresh-token','cookie-refresh']]);
 if(cookie)values.set('kingpos-login-session-id',cookie);
 const client={auth:{getUser:async()=>({data:{user:identity?{id:'user'}:null},error:null})},
  from(){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{status:'active'},error:null})};return q;},
  rpc:(name,_args,options)=>{
   if(name==='check_account_login_session')return {abortSignal(signal){assert.ok(signal instanceof AbortSignal);enrollments++;return Promise.resolve({data:{allowed:true,session_id:sid,registered:true},error:null});}};
   assert.equal(name,'reylumi_account_session_state');assert.equal(options.get,true);sessionReads++;return Promise.resolve({data:allowed?{allowed:true,session_id:sid,registered}:{allowed:false},error});
  }};
 const deps={
  '@/lib/abuse-context':{safetyRequestHeaders:async()=>({})},'@supabase/supabase-js':{createClient:()=>client},
  '@/lib/account-security-shared':{ACCOUNT_LOGIN_SESSION_COOKIE:'kingpos-login-session-id',isAccountLoginSessionId:v=>/^[a-f0-9-]{36}$/i.test(v??'')},
  '@/lib/users/account-status':{isDeniedKingUserStatus:s=>s!=='active'},'@/lib/users/user-select':{USER_SELECT:'*'},
  'next/headers':{headers:async()=>new Headers(authorization===null?{}:{authorization}),cookies:async()=>({get:n=>values.has(n)?{value:values.get(n)}:undefined})},
  './session-policy':{},'./auth-rest':{AuthAvailabilityError:Unavailable,assertAuthAvailable:()=>{},supabaseDeadlineFetch(){}},
  './auth-rejection':{AuthRejectionError:Rejected,isConfirmedAuthRejection:e=>e?.code==='bad_jwt'},
  '@/lib/read-context-scope':{getReadRequestTiming:()=>null,memoizeReadValidation:(_k,_a,read)=>read()},'node:crypto':require('node:crypto')};
 const exports={};vm.runInNewContext(source,{exports,Headers,AbortSignal,console:{error(){}},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture'}},require:n=>{assert.ok(n in deps,n);return deps[n];}});
 return {...exports,reads:()=>sessionReads,enrollments:()=>enrollments};
}
test('bound provider session remains usable without optional tracking cookie',async()=>{
 const f=fixture({cookie:null});assert.ok(await f.createAuthenticatedSupabaseServerClient());assert.equal((await f.getSupabaseAuthUser()).id,'user');assert.equal(await f.getCurrentAppLoginSessionId(),sid);
});
test('removing or swapping tracking cookie never restores a rejected session on either app auth path',async()=>{
 for(const cookie of [null,'forged','30000000-0000-4000-8000-000000000001']){
  const f=fixture({allowed:false,cookie});assert.equal(await f.createAuthenticatedSupabaseServerClient(),null);assert.equal(await f.getSupabaseAuthUser(),null);assert.equal(await f.getCurrentAppLoginSessionId(),null);
 }
});
test('missing migration and transport outage are unavailable, never successful legacy access',async()=>{
 for(const error of [{code:'PGRST202'},{code:'42P01'},{code:'fetch_failed'}]){
  const f=fixture({error});assert.equal(await f.createAuthenticatedSupabaseServerClient(),null);await assert.rejects(f.createAuthenticatedSupabaseServerClient({throwOnUnavailable:true}),Unavailable);await assert.rejects(f.getSupabaseAuthUser(),Unavailable);
 }
});
test('provider pre-request revocation is a confirmed rejection, not an outage',async()=>{
 const f=fixture({error:{code:'PT401'}});assert.equal(await f.createAuthenticatedSupabaseServerClient(),null);assert.equal(await f.getSupabaseAuthUser(),null);await assert.rejects(f.createAuthenticatedSupabaseServerClient({throwOnRejected:true}),Rejected);
});
test('asserted Authorization never falls back to cookie identity or borrows its refresh token',async()=>{
 for(const authorization of ['Basic invalid','Bearer','Bearer foreign-access','']){
  const f=fixture({authorization});assert.equal(await f.getSupabaseSessionTokensFromRequest(),null);
  if(!authorization.includes('foreign')){assert.equal(await f.getAccessTokenFromRequest(),null);assert.equal(await f.createAuthenticatedSupabaseServerClient(),null);assert.equal(f.reads(),0);}
 }
 const same=fixture({authorization:'bearer cookie-access'});assert.deepEqual({...await same.getSupabaseSessionTokensFromRequest()},{accessToken:'cookie-access',refreshToken:'cookie-refresh'});
});
test('invalid provider identity cannot reach session enrollment',async()=>{
 const f=fixture({identity:false});assert.equal(await f.createAuthenticatedSupabaseServerClient(),null);assert.equal(f.reads(),0);
});
test('new native/callback session enrolls display metadata only for an explicit security operation',async()=>{
 const f=fixture({registered:false,cookie:null,authorization:'Bearer native-access'});
 assert.ok(await f.createAuthenticatedSupabaseServerClient());assert.equal(f.enrollments(),0);
 assert.equal(await f.getCurrentAppLoginSessionId(),sid);assert.equal(f.enrollments(),1);
});
