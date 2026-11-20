import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(entry,stubs){
 const output=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'auth-boundaries',setup(b){
  b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:process.cwd()}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
}
const responseStub=`export class NextResponse extends Response {cookies={set(){},delete(){}};static json(value,init){return new NextResponse(JSON.stringify(value),{...init,headers:{'content-type':'application/json'}})}static redirect(url,status=307){return new NextResponse(null,{status,headers:{location:String(url)}})}}`;

test('reward signup → email-confirmation login → verified-phone completion retains exact salon/book destination',async()=>{
 const fixture=globalThis.rewardAuthContinuity={calls:[],user:{id:'auth-user',phone:'+15035550100',phone_confirmed_at:null,user_metadata:{signup_phone:'+15035550100',signup_phone_complete:false}}};
 const stubs={
  '@/lib/supabase/session-policy':'export const REMEMBER_LOGIN_SECONDS=3600;export const writeLoginPolicy=()=>{};export const sessionCookieOptions=()=>({});',
  '@/lib/abuse-server':'export const createSignupTicket=async()=>"fixture-ticket";export const assertAbuseRequest=async()=>{};export const getAbuseErrorResponse=()=>({error:"Security check unavailable",status:503,challengeRequired:false});',
  '@/lib/advertising-attribution':'export const recordAdvertisingSignup=async()=>{};',
  '@/lib/supabase/server':`const fixture=()=>globalThis.rewardAuthContinuity;
   const client=()=>({auth:{signUp:async input=>{fixture().calls.push(input);return {data:{user:fixture().user,session:null},error:null}},signInWithPassword:async()=>({data:{user:fixture().user,session:{access_token:'fixture-access',refresh_token:'fixture-refresh'}},error:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal1',nextLevel:'aal1'}}),listFactors:async()=>({data:{}})},getUser:async()=>({data:{user:fixture().user},error:null}),updateUser:async({data})=>{Object.assign(fixture().user.user_metadata,data);return {error:null}}}});
   export const ACCESS_TOKEN_COOKIE='access',REFRESH_TOKEN_COOKIE='refresh';export const createSupabaseServerClient=client;
   export const clearPendingMfaSessionCookieWriter=()=>{},setPendingMfaSessionCookieWriter=()=>{},getSupabaseCookieOptions=()=>({});
   export const createAuthenticatedSupabaseAuthSessionServerClient=async()=>client();
   export const createAuthenticatedSupabaseServerClient=async()=>({from:()=>({update:()=>({eq:async()=>({error:null})})}),rpc:async()=>({data:{ok:true,profiles:[]},error:null})});`,
  '@/lib/post-auth-routing':`import {resolvePostAuthRoute} from '@/lib/auth-routing';export const getPostAuthWorkspaceNavigation=async input=>({...resolvePostAuthRoute({requestedPath:input.requestedPath,workspaces:[{id:'personal',type:'personal',salonMode:null}]}),workspace:null});export const fallbackPostAuthWorkspaceNavigation=()=>({redirectTo:'/explore',workspace:null});`,
  '@/lib/supabase/auth-errors':'export const getSupabaseAuthErrorResponse=()=>({message:"Auth error",status:400});',
  '@/lib/current-context':'export const writeNormalizedWorkspaceContextCookies=()=>{},clearWorkspaceContextCookies=()=>{};',
  '@/lib/account-security':'export const recordAccountLoginForSession=async()=>{};',
  '@/lib/system-sms':'export const systemSmsReady=async()=>false;',
  '@/lib/customer-identity-claims':'export const claimCustomersForVerifiedPhone=async()=>({ok:true});',
  '@/lib/customer-phone-verification':'export const recordCustomerVerifiedPhoneFromAuth=async()=>({ok:true});',
  '@/lib/users/current-user':'export const getCurrentKingUser=async()=>({id:"public-user",auth_user_id:"auth-user"});',
  'next/cache':'export const revalidatePath=()=>{};',
  'next/server':responseStub,
 };
 try{
  const signup=await load('app/(app)/api/auth/signup/route.ts',stubs),login=await load('app/(app)/api/auth/login/route.ts',stubs);
  const {finishSignupPhoneAction}=await load('app/signup/phone/actions.ts',stubs);
  const paths=['/explore/salons/00000000-0000-4000-8000-000000000001#salon-rewards','/book/00000000-0000-4000-8000-000000000002?service=manicure#booking'];
  function form(path,target){const body=new FormData();body.set('email','user@example.invalid');body.set('password','Fixture!password');body.set('phone','5035550100');body.set('next',target);return new Request('http://fixture.invalid'+path,{method:'POST',headers:{accept:'application/json'},body});}
  for(const target of paths){
   fixture.user.phone_confirmed_at=null;fixture.user.user_metadata.signup_phone_complete=false;
   const created=await(await signup.POST(form('/api/auth/signup',target))).json();
   const waitingLogin=new URL(created.redirectTo,'http://fixture.invalid');assert.equal(waitingLogin.pathname,'/login');
   const onboarding=waitingLogin.searchParams.get('next');assert.equal(new URL(onboarding,'http://fixture.invalid').searchParams.get('next'),target);
   const confirmation=new URL(fixture.calls.at(-1).options.emailRedirectTo);
   assert.equal(confirmation.pathname,'/login','implicit signup confirmation must not require a PKCE callback code');
   assert.equal(confirmation.searchParams.get('next'),onboarding);
   const signedIn=await(await login.POST(form('/api/auth/login',onboarding))).json();assert.equal(signedIn.redirectTo,onboarding);
   const blocked=await finishSignupPhoneAction({customerIds:[],nextPath:target});assert.match(blocked.error,/Verify your phone/);
   assert.equal(fixture.user.user_metadata.signup_phone_complete,false);
   fixture.user.phone_confirmed_at='2026-11-02T00:00:00Z';
   const finished=await finishSignupPhoneAction({customerIds:[],nextPath:target});assert.equal(finished.redirectTo,target);assert.equal(fixture.user.user_metadata.signup_phone_complete,true);
  }
  const rejected=await finishSignupPhoneAction({customerIds:[],nextPath:'//outside.example/book'});assert.equal(rejected.redirectTo,'/activity');
 }finally{delete globalThis.rewardAuthContinuity;}
});
