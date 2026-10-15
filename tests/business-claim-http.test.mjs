import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,dependencies={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,URL,URLSearchParams,Response,Error,require(name){assert.ok(name in dependencies,name);return dependencies[name];},...globals});return exports;
}
function route({user={status:'active'},result={data:[],error:null},throws=false}={}){
 const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});if(throws)throw Error('private transport');return result;}};
 return {calls,...load('app/api/business-claims/matches/route.ts',{
 '@/lib/users/current-user':{getCurrentKingUser:async()=>user},
 '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>client},
 '@/lib/business-claim-diagnostics':{withBusinessClaimLookupDiagnostics:(_,fn)=>fn()},
 })};
}
test('suggestions GET requires an active authenticated user before any database call',async()=>{
 for(const user of [null,{status:'suspended'}]){const r=route({user});const res=await r.GET(new Request('https://app.test/api/business-claims/matches?name=Private'));
 assert.equal(res.status,401);assert.equal(r.calls.length,0);assert.equal(res.headers.get('cache-control'),'private, no-store');}
});
test('suggestions GET uses user-scoped RPC and bounded input, with no shared cache',async()=>{
 const r=route();const params=new URLSearchParams({name:'x'.repeat(180),phone:'p'.repeat(50),address:'a'.repeat(300),unit:'s'.repeat(200),city:'c'.repeat(200),state:'t'.repeat(200)});
 const res=await r.GET(new Request('https://app.test/api/business-claims/matches?'+params));
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.deepEqual(await res.json(),{matches:[],error:null});
 assert.equal(r.calls[0].name,'find_business_claim_matches');assert.deepEqual(Object.values(r.calls[0].args).map(s=>s.length),[160,40,250,100,100,100]);
});
test('database and network failures remain visible and reveal no SQL details',async()=>{
 for(const options of [{result:{data:null,error:{code:'57014',message:'private SQL'}}},{throws:true}]){
 const res=await route(options).GET(new Request('https://app.test/api/business-claims/matches'));assert.equal(res.status,503);
 assert.deepEqual(await res.json(),{matches:[],error:'Could not check existing salons. Please try again.'});}
});
test('browser lookup is GET, cancellation-aware and fails closed on malformed or failed responses',async()=>{
 let response=Response.json({matches:[{salon_id:'one'}],error:null}),call;
 const api=load('lib/business-claim-client.ts',{}, {fetch:async(...args)=>{call=args;return response;}});
 const controller=new AbortController(),input={name:'A & B',phone:'',address:'',unit:'',city:'Madison',state:'WI'};
 assert.equal((await api.findBusinessClaimMatches(input,controller.signal)).matches.length,1);
 assert.equal(call[1].method,undefined);assert.equal(call[1].signal,controller.signal);assert.equal(call[1].cache,'no-store');assert.equal(new URL(call[0],'https://app.test').searchParams.get('name'),'A & B');
 for(const invalid of [Response.json({matches:[]},{status:200}),Response.json({matches:[],error:null},{status:503}),new Response('invalid')]){response=invalid;const result=await api.findBusinessClaimMatches(input,controller.signal);assert.equal(result.matches.length,0);assert.ok(result.error);}
});
test('workspace open checks current membership and destination before selecting a claimed salon',async()=>{
 const current={id:'manage:salon',defaultHref:'/salon-profile'},writes=[];
 const api=load('app/(app)/workspace/open/route.ts',{
 '@/lib/auth-routing':{loginHrefForReturnPath:p=>'/login?next='+encodeURIComponent(p)},
 '@/lib/current-context':{getCurrentBusinessContext:async()=>({user:{id:'owner'},workspaceOptions:[current]}),getWorkspaceLandingHref:w=>w.defaultHref,isWorkspaceDestinationAllowed:(_,href)=>href==='/salon-profile',setNormalizedWorkspaceContext:async w=>writes.push(w.id)},
 'next/cache':{revalidatePath(){}},'next/server':{NextResponse:{redirect:url=>Response.redirect(url,307)}},
 });
 for(const query of ['workspace_id=manage:revoked&destination=/salon-profile','workspace_id=manage:salon&destination=https://evil.invalid','workspace_id=manage:salon&destination=/admin']){
 const res=await api.GET(new Request('https://app.test/workspace/open?'+query));assert.match(res.headers.get('location'),/^https:\/\/app.test\/my-place\?error=/);}
 assert.equal(writes.length,0);
 const good=await api.GET(new Request('https://app.test/workspace/open?workspace_id=manage:salon&destination=/salon-profile'));
 assert.equal(good.headers.get('location'),'https://app.test/salon-profile');assert.deepEqual(writes,['manage:salon']);
});
