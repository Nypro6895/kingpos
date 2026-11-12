import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(entry,stubs={}){
 const built=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){
  b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}

test('posting preflight requires server phone proof while signup admission remains rate limited',async()=>{
 globalThis.phoneGate={verified:false,calls:[]};
 const {assertAbuseRequest}=await load('lib/abuse-server.ts',{
  'server-only':'',
  '@supabase/supabase-js':`export const createClient=()=>({rpc:async(name)=>{globalThis.phoneGate.calls.push(name);return {error:null,data:name==='account_has_verified_post_phone'?globalThis.phoneGate.verified:{allowed:true}};}});`,
  '@/lib/abuse-context':'export const getSafetyContext=async()=>({deviceHash:"fixture-device",ipHash:"fixture-ip"});',
  '@/lib/users/current-user':'export const getCurrentKingUser=async()=>({id:"fixture-user"});',
  '@/lib/abuse-signals':'export const abuseHash=()=>"fixture-hash";',
  'botid/server':'export const checkBotId=async()=>({isBot:false});',
 });
 const saved={url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,vercel:process.env.VERCEL};
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.example';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.VERCEL='0';
 try{
  await assert.rejects(assertAbuseRequest('post'),/Verify your phone/);
  assert.deepEqual(globalThis.phoneGate.calls,['account_has_verified_post_phone']);
  globalThis.phoneGate.verified=true;await assertAbuseRequest('post');
  assert.equal(globalThis.phoneGate.calls.at(-1),'abuse_preflight');
  globalThis.phoneGate.calls=[];await assertAbuseRequest('signup','fixture@example.test');
  assert.deepEqual(globalThis.phoneGate.calls,['abuse_preflight']);
 }finally{
  for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:saved.url,SUPABASE_SERVICE_ROLE_KEY:saved.key,VERCEL:saved.vercel})){
   if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
  delete globalThis.phoneGate;
 }
});

test('staff invitation signup also validates a unique phone and starts OTP onboarding',async()=>{
 globalThis.staffPhoneSignup={duplicate:false,calls:[]};
 const {POST}=await load('app/(app)/api/staff/invite/signup/route.ts',{
  '@/lib/supabase/session-policy':'export const writeLoginPolicy=()=>{};export const sessionCookieOptions=()=>({});',
  '@/lib/abuse-server':'export const getAbuseErrorResponse=()=>null;export const createSignupTicket=async()=>"fixture-ticket";',
  '@/lib/signup-phone-availability':'export const isSignupPhoneAvailable=async()=>!globalThis.staffPhoneSignup.duplicate;',
  '@/lib/advertising-attribution':'export const recordAdvertisingSignup=async()=>{};',
  '@/lib/supabase/server':`export const ACCESS_TOKEN_COOKIE='a',REFRESH_TOKEN_COOKIE='r';export const getSupabaseCookieOptions=()=>({});export const createUserScopedSupabaseServerClient=()=>null;export const createSupabaseServerClient=()=>({auth:{signUp:async input=>{globalThis.staffPhoneSignup.calls.push(input);return {data:{user:{id:'fixture'},session:null},error:null};}}});`,
  '@/lib/supabase/auth-errors':'export const getSupabaseAuthErrorResponse=()=>({message:"Auth error",status:400});',
  '@/lib/current-context':`export const CURRENT_MANAGE_SALON_COOKIE='m',CURRENT_STAFF_SALON_COOKIE='s',LEGACY_CURRENT_SALON_COOKIE='l',SELECTED_WORKSPACE_COOKIE='w';export const getStaffWorkspaceId=()=>'';`,
  '@/lib/staff-salon-connections':`export const getStaffInviteByToken=async()=>({status:'pending',is_expired:false,target:{has_account_target:false,masked_email:'f***@example.test'},staff:{display_name:'Fixture'},salon:{id:'salon'},request_id:'invite'});export const verifyStaffInviteEmail=async()=>({requires_existing_account:false,email_matches:true});`,
  '@/lib/staff-profile':'export const initializeStaffProfileDefaultsForStaffId=async()=>{};',
  '@/lib/users/current-user':'export const getKingUserForAuthUser=async()=>null;',
  'next/server':`export class NextResponse extends Response {static json(value,init){return new NextResponse(JSON.stringify(value),{...init,headers:{'content-type':'application/json'}})}}`,
 });
 const request=phone=>{const data=new FormData();for(const [key,value] of Object.entries({token:'invite',email:'fixture@example.test',password:'fixture-password',...(phone?{phone}:{})}))data.set(key,value);return new Request('https://fixture.example/api/staff/invite/signup',{method:'POST',body:data});};
 try{
  assert.equal((await POST(request())).status,400);
  globalThis.staffPhoneSignup.duplicate=true;assert.equal((await POST(request('5035550100'))).status,409);
  assert.equal(globalThis.staffPhoneSignup.calls.length,0);
  globalThis.staffPhoneSignup.duplicate=false;const response=await POST(request('5035550100'));assert.equal(response.status,200);
  assert.equal(globalThis.staffPhoneSignup.calls[0].options.data.signup_phone,'+15035550100');
  assert.equal(globalThis.staffPhoneSignup.calls[0].options.data.signup_phone_complete,false);
 }finally{delete globalThis.staffPhoneSignup;}
});

test('onboarding survives return-path sanitization and resumes without redirect loops',async()=>{
 const {signupPhonePath,resumeSignupPhonePath}=await load('lib/signup-phone-routing.ts');
 const {sanitizeAuthReturnPath,resolvePostAuthRoute}=await load('lib/auth-routing.ts');
 const pending={user_metadata:{signup_phone:'+15035550100',signup_phone_complete:false}};
 const onboarding=signupPhonePath('/activity');
 assert.equal(sanitizeAuthReturnPath(onboarding),onboarding);
 assert.equal(resumeSignupPhonePath(pending,onboarding),onboarding);
 assert.equal(resumeSignupPhonePath(pending,'//outside.example'),'/welcome/phone?next=%2Factivity');
 assert.equal(resumeSignupPhonePath({user_metadata:{...pending.user_metadata,signup_phone_complete:true}},'/activity'),'/activity');
 assert.equal(resumeSignupPhonePath({user_metadata:{}},'/activity'),'/activity');
 assert.equal(resolvePostAuthRoute({requestedPath:onboarding,workspaces:[{id:'personal',type:'personal',salonMode:null}]}).redirectTo,onboarding);
});

test('signup API validates phone, keeps it untrusted until OTP, and preserves email-confirmation return',async()=>{
 globalThis.signupFixture={calls:[],session:true};
 const {POST}=await load('app/(app)/api/auth/signup/route.ts',{
  '@/lib/supabase/session-policy':'export const writeLoginPolicy=()=>{};export const sessionCookieOptions=()=>({});',
  '@/lib/abuse-server':'export const getAbuseErrorResponse=()=>null;export const createSignupTicket=async()=>"fixture-ticket";',
  '@/lib/signup-phone-availability':`export const isSignupPhoneAvailable=async()=>{if(globalThis.signupFixture.unavailable)throw Error('offline');return !globalThis.signupFixture.duplicate;};`,
  '@/lib/advertising-attribution':'export const recordAdvertisingSignup=async()=>{};',
  '@/lib/supabase/server':`export const ACCESS_TOKEN_COOKIE='access',REFRESH_TOKEN_COOKIE='refresh';export const createSupabaseServerClient=()=>({auth:{signUp:async input=>{globalThis.signupFixture.calls.push(input);return {data:{user:{id:'fixture'},session:globalThis.signupFixture.session?{access_token:'fixture-access',refresh_token:'fixture-refresh'}:null},error:null};}}});`,
  '@/lib/post-auth-routing':'export const getPostAuthWorkspaceNavigation=async input=>({redirectTo:input.requestedPath,workspace:null});export const fallbackPostAuthWorkspaceNavigation=()=>({redirectTo:"/explore",workspace:null});',
  '@/lib/supabase/auth-errors':'export const getSupabaseAuthErrorResponse=()=>({message:"Auth error",status:400});',
  '@/lib/current-context':'export const writeNormalizedWorkspaceContextCookies=()=>{};',
  'next/server':`export class NextResponse extends Response {cookies={set(){}};static json(value,init){return new NextResponse(JSON.stringify(value),{...init,headers:{'content-type':'application/json'}})}static redirect(url,status){return new NextResponse(null,{status,headers:{location:String(url)}})}}`,
 });
 const request=(phone)=>{const data=new FormData();data.set('email','User@example.test');data.set('password','fixture-pass');data.set('display_name','Mary');if(phone!==undefined)data.set('phone',phone);return new Request('https://app.example.test/api/auth/signup',{method:'POST',headers:{accept:'application/json'},body:data});};
 try{
  assert.equal((await POST(request())).status,400);assert.equal((await POST(request('555'))).status,400);
  assert.equal(globalThis.signupFixture.calls.length,0);
  globalThis.signupFixture.duplicate=true;
  const duplicate=await POST(request('5035550100'));assert.equal(duplicate.status,409);
  assert.match((await duplicate.json()).error,/already used by another account/);
  assert.equal(globalThis.signupFixture.calls.length,0);
  globalThis.signupFixture.duplicate=false;globalThis.signupFixture.unavailable=true;
  assert.equal((await POST(request('5035550100'))).status,503);
  assert.equal(globalThis.signupFixture.calls.length,0);
  globalThis.signupFixture.unavailable=false;
  const created=await POST(request('(503) 555-0100'));assert.equal(created.status,200);
  assert.equal((await created.json()).redirectTo,'/welcome/phone?next=%2Factivity');
  const input=globalThis.signupFixture.calls[0];assert.equal(input.options.data.signup_phone,'+15035550100');
  assert.equal(input.options.data.signup_phone_complete,false);assert.equal(input.phone,undefined);
  assert.equal(input.email,'user@example.test');
  assert.equal(new URL(input.options.emailRedirectTo).searchParams.get('next'),'/welcome/phone?next=%2Factivity');
  globalThis.signupFixture.session=false;
  const confirmed=await(await POST(request('5035550100'))).json();
  assert.equal(new URL(confirmed.redirectTo,'https://app.example.test').searchParams.get('next'),'/welcome/phone?next=%2Factivity');
 }finally{delete globalThis.signupFixture;}
});

test('onboarding actions require the same confirmed Auth identity and keep completion retryable',async()=>{
 globalThis.signupActionFixture={confirmed:false,calls:[],rejectSelection:false};
 const {loadSignupHistoryAction,finishSignupPhoneAction}=await load('app/signup/phone/actions.ts',{
  '@/lib/customer-identity-claims':`export const claimCustomersForVerifiedPhone=async()=>{globalThis.signupActionFixture.calls.push('claim');return {ok:true,data:{linkedCount:0,selectionRequired:true}};};`,
  '@/lib/customer-phone-verification':'export const recordCustomerVerifiedPhoneFromAuth=async()=>({ok:true});',
  '@/lib/users/current-user':'export const getCurrentKingUser=async()=>({id:"public-user",auth_user_id:"auth-user"});',
  '@/lib/supabase/server':`export const createAuthenticatedSupabaseAuthSessionServerClient=async()=>({auth:{getUser:async()=>({data:{user:{id:'auth-user',phone:'+15035550100',phone_confirmed_at:globalThis.signupActionFixture.confirmed?'now':null}},error:null}),updateUser:async()=>{globalThis.signupActionFixture.calls.push('complete');return {error:null}}}});
   export const createAuthenticatedSupabaseServerClient=async()=>({from:()=>({update:()=>({eq:async()=>({error:null})})}),rpc:async(name,args)=>{globalThis.signupActionFixture.calls.push([name,args]);return {error:null,data:name==='get_my_phone_history_profiles'?{ok:true,profiles:[{id:'00000000-0000-4000-8000-000000000001',name:'Mary',salonName:'Salon',linked:false}]}:{ok:!globalThis.signupActionFixture.rejectSelection}};}});`,
  'next/cache':'export const revalidatePath=()=>{};',
 });
 try{
  assert.ok((await loadSignupHistoryAction()).error);assert.ok((await finishSignupPhoneAction({customerIds:[],nextPath:'/activity'})).error);
  assert.equal(globalThis.signupActionFixture.calls.length,0);
  globalThis.signupActionFixture.confirmed=true;
  const loaded=await loadSignupHistoryAction();assert.equal(loaded.profiles.length,1);
  globalThis.signupActionFixture.rejectSelection=true;
  assert.ok((await finishSignupPhoneAction({customerIds:['00000000-0000-4000-8000-000000000001'],nextPath:'/activity'})).error);
  assert.ok(!globalThis.signupActionFixture.calls.includes('complete'));
  globalThis.signupActionFixture.rejectSelection=false;
  assert.equal((await finishSignupPhoneAction({customerIds:[],nextPath:'https://outside.example'})).redirectTo,'/activity');
  assert.equal((await finishSignupPhoneAction({customerIds:[],nextPath:'/welcome/phone'})).redirectTo,'/activity');
 }finally{delete globalThis.signupActionFixture;}
});
