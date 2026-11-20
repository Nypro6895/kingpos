import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

// Provider-free Auth acceptance. Admin generate_link creates the same one-use
// signup verification link without sending any email. Tokens stay in memory.
const output=process.env.BOOKING_TEST_OUTPUT_DIR||'artifacts/reward-practical-v3/auth/fixture';
process.env.BOOKING_TEST_OUTPUT_DIR=output;
const f=await startIsolatedSupabase('reward-auth-return',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});
const docker=process.env.TEST_DOCKER_PATH||(process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker');
const context=process.env.TEST_DOCKER_CONTEXT||(process.platform==='win32'?'desktop-linux':'default');
function command(args,input){return execFileSync(docker,['--context',context,...args],{input,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024}).trim();}
async function sourceSignup(){
 const stubs={
  '@/lib/supabase/session-policy':'export const writeLoginPolicy=()=>{};export const sessionCookieOptions=()=>({});',
  '@/lib/abuse-server':'export const createSignupTicket=async()=>"fixture-ticket";',
  '@/lib/advertising-attribution':'export const recordAdvertisingSignup=async()=>{};',
  '@/lib/supabase/server':`export const ACCESS_TOKEN_COOKIE='access',REFRESH_TOKEN_COOKIE='refresh';export const createSupabaseServerClient=()=>({auth:{signUp:async input=>globalThis.rewardAuthActual.signup(input)}});`,
  '@/lib/post-auth-routing':'export const getPostAuthWorkspaceNavigation=async input=>({redirectTo:input.requestedPath,workspace:null});export const fallbackPostAuthWorkspaceNavigation=()=>({redirectTo:"/explore",workspace:null});',
  '@/lib/supabase/auth-errors':'export const getSupabaseAuthErrorResponse=()=>({message:"Auth error",status:400});',
  '@/lib/current-context':'export const writeNormalizedWorkspaceContextCookies=()=>{};',
  'next/server':`export class NextResponse extends Response {cookies={set(){}};static json(value,init){return new NextResponse(JSON.stringify(value),{...init,headers:{'content-type':'application/json'}})}static redirect(url,status=307){return new NextResponse(null,{status,headers:{location:String(url)}})}}`,
 };
 const built=await build({entryPoints:['app/(app)/api/auth/signup/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'no-provider-signup',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
}
try{
 const service=command(['exec',f.evidence.containers.storage,'printenv','SERVICE_KEY']);
 const signup=await sourceSignup();
 const bundled=await build({entryPoints:['lib/signup-phone-routing.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const {signupPhonePath,resumeSignupPhonePath}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 const checks=[];
 for(const target of ['/explore/salons/'+randomUUID()+'#salon-rewards','/book/'+randomUUID()+'?service=manicure#booking']){
  const next=signupPhonePath(target),password='Fixture!'+randomBytes(24).toString('hex');
  const email='reward-confirm.'+randomUUID()+'@example.invalid';
  let generated;
  // Replace only the external signup/email boundary: production handler builds
  // redirect/context, isolated Auth creates an identical link without delivery.
  globalThis.rewardAuthActual={signup:async input=>{
   generated=f.http(9999,'/admin/generate_link','POST',{type:'signup',email:input.email,password:input.password,redirect_to:input.options.emailRedirectTo,data:input.options.data},service);
   assert.equal(generated.status,200);assert.ok(generated.data.action_link);
   return {data:{user:generated.data,session:null},error:null};
  }};
  const form=new FormData();for(const[k,v]of Object.entries({email,password,phone:'5035550100',next:target}))form.set(k,v);
  const created=await(await signup.POST(new Request('http://fixture.invalid/api/auth/signup',{method:'POST',headers:{accept:'application/json'},body:form}))).json();
  assert.equal(new URL(created.redirectTo,'http://fixture.invalid').searchParams.get('next'),next);
  const action=new URL(generated.data.action_link);
  const config=['url = '+JSON.stringify('http://127.0.0.1:9999'+action.pathname+action.search),'silent','show-error','include','max-time = 20'].join('\n');
  const raw=command(['exec','-i',f.evidence.containers.db,'curl','--config','-'],config);
  const status=Number(raw.match(/^HTTP\/\S+ (\d+)/)?.[1]);assert.ok(status===302||status===303);
  const location=raw.match(/^location:\s*(.+)$/im)?.[1]?.trim();assert.ok(location);
  const confirmed=new URL(location);assert.equal(confirmed.pathname,'/login');
  assert.equal(confirmed.searchParams.get('next'),next);
  const fragment=new URLSearchParams(confirmed.hash.slice(1));
  assert.ok(fragment.get('access_token'));assert.equal(confirmed.searchParams.has('code'),false);
  const login=f.http(9999,'/token?grant_type=password','POST',{email,password});
  assert.equal(login.status,200);assert.ok(login.data.user.email_confirmed_at);
  assert.equal(resumeSignupPhonePath(login.data.user,next),next);
  assert.equal(new URL(next,'http://fixture.invalid').searchParams.get('next'),target);
  // Verification links are one-use; replay cannot create another successful
  // Auth grant. Only the sanitized result shape is written, never URL tokens.
  const replay=command(['exec','-i',f.evidence.containers.db,'curl','--config','-'],config);
  const replayLocation=new URL(replay.match(/^location:\s*(.+)$/im)[1].trim());
  assert.equal(new URLSearchParams(replayLocation.hash.slice(1)).get('access_token'),null);
  checks.push({target,confirmationDestination:confirmed.pathname,onboardingNext:next,emailConfirmed:true,passwordLogin:true,implicitFragment:true,oneUseLink:true});
 }
 f.save('auth-return-result.json',{passed:true,checks,scope:'Actual isolated GoTrue confirmation and password login; routing functions are production source. No email/SMS sent. Phone OTP transport and actual Next form pages are separate acceptance.'});
 console.log('PASS actual isolated Auth signup confirmation, password login and exact nested salon/book return context (2 paths); no email/SMS sent.');
}finally{delete globalThis.rewardAuthActual;f.close();}
