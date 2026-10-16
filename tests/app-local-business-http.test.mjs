import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
async function compile(entry,stubs){const out=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'claims-fixture',setup(b){b.onResolve({filter:/.*/},a=>{const key=Object.keys(stubs).find(key=>a.path===key||a.path.endsWith('/'+key));return key?{path:key,namespace:'fixture'}:undefined});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:stubs[a.path]}));}}]});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))}
const wire=(status,body)=>({status,body:JSON.stringify(body),headers:{'content-type':'application/json','cache-control':'private, no-store'}});
test('business suggestions bridge preserves exact read parameters and composes other methods/hosts unchanged',async()=>{
  const{createAppLocalBusinessHttpFetch}=await compile('lib/app-local-business-http-client.ts',{'app-local-host':'export const getAppLocalHost=()=>({isNative:false})'});const old=globalThis.location;globalThis.location=new URL('reylumi-app://bundle/salons/new');
  try{const calls=[],pass=[],host={isNative:true,read:async(name,args,options)=>{calls.push({name,args,options});return{scope:options.scope,data:wire(503,{matches:[],error:'Original unavailable'})}},command:async()=>{throw Error('Suggestions must not write')}};
    const fetch=createAppLocalBusinessHttpFetch({scope:()=> 'scope-a',host:()=>host,fetch:async(...args)=>{pass.push(args);return new Response('previous-adapter')}});
    const response=await fetch('/api/business-claims/matches?name=Salon+%26+Spa&phone=%2B15125550100&unit=12');
    assert.equal(response.status,503);assert.equal((await response.json()).error,'Original unavailable');assert.deepEqual(calls[0].args,{name:'Salon & Spa',phone:'+15125550100',unit:'12'});assert.equal(calls[0].name,'http.business-claims.matches');
    for(const url of['reylumi-app://foreign/api/business-claims/matches','//foreign.example/api/business-claims/matches','/api/staff/create-appointment'])assert.equal(await(await fetch(url)).text(),'previous-adapter');
    await fetch('/api/business-claims/matches',{method:'POST',body:'{}'});assert.equal(pass.length,4);assert.equal(calls.length,1);
    await assert.rejects(fetch('/api/business-claims/matches?name=a&name=b'),/Unsupported/);await assert.rejects(fetch('/api/business-claims/matches?token=secret'),/Unsupported/);
  }finally{if(old===undefined)delete globalThis.location;else globalThis.location=old}
});
test('read cancellation and scope changes reject old salon suggestions without retry',async()=>{
  const{createAppLocalBusinessHttpFetch}=await compile('lib/app-local-business-http-client.ts',{'app-local-host':'export const getAppLocalHost=()=>({isNative:false})'});let scope='scope-a',resolve,attempts=0;
  const fetch=createAppLocalBusinessHttpFetch({scope:()=>scope,host:()=>({isNative:true,read:async()=>{attempts++;return new Promise(done=>resolve=done)}}),fetch:async()=>{throw Error('No fallback')}});
  const abort=new AbortController(),pending=fetch('/api/business-claims/matches?name=A',{signal:abort.signal});abort.abort();resolve({scope:'scope-a',data:wire(200,{matches:[{id:'private'}]})});await assert.rejects(pending,{name:'AbortError'});assert.equal(attempts,1);
  const changed=fetch('/api/business-claims/matches?name=B');scope='scope-b';resolve({scope:'scope-a',data:wire(200,{matches:[{id:'private'}]})});await assert.rejects(changed,/account changed/);assert.equal(attempts,2);
});
async function serverFixture(){
  const state=globalThis.claimsFixture={scope:'scope-a',user:{id:'viewer-a',status:'active'},calls:[],headers:{cookie:'fixture-only'},rpcError:null,hold:null};
  const api=await compile('lib/app-local-business-http-server.ts',{'server-only':'','next/headers':'export const headers=async()=>new Headers(globalThis.claimsFixture.headers);','request-business-context':'export const getRequestBusinessContext=async()=>globalThis.claimsFixture;','experience-context':'export const getExperienceContext=context=>({scope:context.scope});','users/current-user':'export const getCurrentKingUser=async()=>globalThis.claimsFixture.user;','supabase/server':'export const createAuthenticatedSupabaseServerClient=async()=>({rpc:async(name,args)=>{const s=globalThis.claimsFixture;s.calls.push({name,args});if(s.hold)await s.hold;return{data:[{id:"match",name:"Existing salon"}],error:s.rpcError}}});','business-claim-diagnostics':'export const withBusinessClaimLookupDiagnostics=async(name,run)=>run();'});
  return{state,api};
}
test('server uses the real active-account suggestions handler, bounded original RPC fields and original failure status',async()=>{
  const{state,api}=await serverFixture();
  await assert.rejects(api.readAppLocalBusinessHttpResource('http.business-claims.matches',{name:'A'},{scope:'other'}),{status:409});assert.deepEqual(state.calls,[]);
  state.user.status='suspended';let result=await api.readAppLocalBusinessHttpResource('http.business-claims.matches',{name:'A'},{scope:'scope-a'});assert.equal(result.data.status,401);assert.deepEqual(state.calls,[]);
  state.user.status='active';result=await api.readAppLocalBusinessHttpResource('http.business-claims.matches',{name:'A'.repeat(200),phone:'5125550100',address:'Road',unit:'2',city:'Austin',state:'TX'},{scope:'scope-a'});
  assert.equal(result.data.status,200);assert.equal(result.data.headers['cache-control'],'private, no-store');assert.equal(state.calls[0].name,'find_business_claim_matches');assert.deepEqual(state.calls[0].args,{p_name:'A'.repeat(160),p_phone:'5125550100',p_address:'Road',p_unit:'2',p_city:'Austin',p_state:'TX'});
  state.rpcError={message:'DB unavailable'};result=await api.readAppLocalBusinessHttpResource('http.business-claims.matches',{name:'A'},{scope:'scope-a'});assert.equal(result.data.status,503);assert.deepEqual(JSON.parse(result.data.body),{matches:[],error:'Could not check existing salons. Please try again.'});
});
test('invalid/denied/cancelled business reads never expose a late RPC result or arbitrary endpoint',async()=>{
  const{state,api}=await serverFixture();assert.equal(await api.readAppLocalBusinessHttpResource('unknown',{}, {scope:'scope-a'}),null);
  await assert.rejects(api.readAppLocalBusinessHttpResource('http.business-claims.matches',{path:'/other'},{scope:'scope-a'}),{status:400});state.headers['x-reylumi-auth-unavailable']='1';await assert.rejects(api.readAppLocalBusinessHttpResource('http.business-claims.matches',{}, {scope:'scope-a'}),{status:503});assert.deepEqual(state.calls,[]);delete state.headers['x-reylumi-auth-unavailable'];
  let done;state.hold=new Promise(resolve=>done=resolve);const abort=new AbortController();const pending=api.readAppLocalBusinessHttpResource('http.business-claims.matches',{name:'A'},{scope:'scope-a',signal:abort.signal});while(!state.calls.length)await new Promise(resolve=>setImmediate(resolve));abort.abort();done();await assert.rejects(pending,{name:'AbortError'});assert.equal(state.calls.length,1);
});
