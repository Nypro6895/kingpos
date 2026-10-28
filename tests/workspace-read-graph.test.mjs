import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const result=await build({stdin:{contents:`export * from './lib/current-context';export * from './lib/read-context-scope';export * from './lib/workspace-read-graph';export * from './lib/settings-target-context';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'context-boundaries',setup(b){
 b.onResolve({filter:/^(react|next\/headers|server-only)$|(?:^|\/)supabase\/server$|(?:^|\/)users\/current-user$/},({path})=>({path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'js',contents:path==='react'?'export const cache=f=>f;':path==='next/headers'?'export const cookies=async()=>({get:key=>globalThis.__dal.cookie[key]?{value:globalThis.__dal.cookie[key]}:undefined});':path==='server-only'?'':path.endsWith('users/current-user')?'export const getCurrentKingUser=async()=>globalThis.__dal.user;export const getKingUserForAuthUser=async()=>globalThis.__dal.user;':`export const getAccessTokenFromRequest=async()=>globalThis.__dal.token??null;export const createAuthenticatedSupabaseServerClient=async()=>{await globalThis.__dal.authGate;return globalThis.__dal.client;};export const createSupabaseServerClient=()=>globalThis.__dal.client;export const createUserScopedSupabaseServerClient=()=>globalThis.__dal.client;`}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function fixture(){
 const date='2026-10-27T00:00:00Z',account={id:'account',name:'Salon account',status:'active',created_at:date,updated_at:date};
 const role={id:'role',account_id:account.id,name:'Owner',code:'OWNER',description:null,is_system:true,created_at:date,updated_at:date};
 const member={id:'membership',account_id:account.id,user_id:'user',role_id:role.id,status:'active',joined_at:date,created_at:date,updated_at:date};
 const salon={id:'salon',account_id:account.id,name:'Fixture salon',phone:null,address_line1:null,address_line2:null,city:null,state:null,postal_code:null,country:'US',latitude:null,longitude:null,status:'active',created_at:date,updated_at:date};
 const graph={version:1,userId:'user',bootstrapRequired:false,accountMemberships:[member],salonMemberships:[],accounts:[account],roles:[role],locations:[salon],staff:[{id:'staff',salon_id:salon.id}],profiles:[{salon_id:salon.id,public_profile_logo_path:null}],grants:[{role_id:role.id,code:'reports.view'}]};
 const f={graph,cookie:{},user:{id:'user',auth_user_id:'auth',email:'fixture@example.invalid',display_name:'Fixture',status:'active',created_at:date},rest:0,rpc:0,error:null};
 const tables={accounts:graph.accounts,roles:graph.roles,account_memberships:graph.accountMemberships,salon_memberships:graph.salonMemberships,locations:graph.locations,staff:[{...graph.staff[0],account_user_id:'user',is_active:true}],salon_settings:graph.profiles,role_permissions:[{role_id:role.id,permission_id:'permission'}],permissions:[{id:'permission',code:'reports.view'}]};
 f.client={rpc:async name=>{f.rpc++;return name==='read_my_workspace_graph_v1'?{data:f.graph,error:f.error}:{data:[],error:null};},from:name=>{
  f.rest++;let rows=[...(tables[name]??[])];const q={select(){return q;},eq(k,v){rows=rows.filter(r=>r[k]===v);return q;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return q;},order(){return q;},returns(){return q;},then(resolve){return Promise.resolve({data:rows,error:null}).then(resolve);}};return q;
 }};
 globalThis.__dal=f;return f;
}
test('ordinary read overlaps self graph with full authentication but cannot expose it before admission',async()=>{const f=fixture();f.token='fixture-token';let finish;f.authGate=new Promise(r=>finish=r);let settled=false;const pending=api.runWithReadContext(()=>api.getCurrentBusinessContext()).then(x=>{settled=true;return x;});await new Promise(setImmediate);assert.equal(f.rpc,1);assert.equal(settled,false);finish();const out=await pending;assert.equal(out.user.id,'user');assert.equal(f.rpc,1);});
test('staged graph preserves identity matching, auth denial and fresh final gates',async()=>{let f=fixture();f.token='fixture-token';f.graph.userId='different';await assert.rejects(api.runWithReadContext(()=>api.getCurrentBusinessContext()),/identity/);f=fixture();f.token='fixture-token';f.user=null;f.error={code:'42501'};const denied=await api.runWithReadContext(()=>api.getCurrentBusinessContext());assert.equal(denied.user,null);assert.deepEqual(denied.workspaceOptions,[]);for(const final of [false,true]){f=fixture();f.token='fixture-token';let finish;f.authGate=new Promise(r=>finish=r);const pending=final?api.runWithReadContext(()=>api.runWithFreshReadValidation(()=>api.getCurrentBusinessContext())):api.getCurrentBusinessContext();await new Promise(setImmediate);assert.equal(f.rpc,0);finish();await pending;assert.equal(f.rpc,1);}});
test('batched graph preserves complete legacy context for personal, account, owner and staff; no bootstrap or REST fan-out',async()=>{
 for(const selected of ['personal','account:account','manage:salon','staff:salon']){
  const f=fixture();f.cookie[api.SELECTED_WORKSPACE_COOKIE]=selected;
  process.env.KINGPOS_WORKSPACE_DAL_RPC='0';const old=await api.runWithReadContext(()=>api.getCurrentBusinessContext());const legacyReads=f.rest;
  f.rest=0;f.rpc=0;delete process.env.KINGPOS_WORKSPACE_DAL_RPC;
  const next=await api.runWithReadContext(()=>api.getCurrentBusinessContext());assert.deepEqual(next,old,selected);
  assert.equal(f.rest,0);assert.equal(f.rpc,1);assert(legacyReads>5);
 }
});
test('graph failure cannot become an empty or successful workspace; nested fallback cannot borrow another graph',async()=>{
 const f=fixture();f.error={code:'42501'};await assert.rejects(api.loadWorkspaceReadGraph(f.client,'user'),/unavailable/);
 f.error=null;await assert.rejects(api.loadWorkspaceReadGraph(f.client,'another-user'),/identity/);
 await api.runWithWorkspaceReadGraph(f.graph,async()=>{assert.equal(api.currentWorkspaceReadGraph(),f.graph);await api.runWithWorkspaceReadGraph(undefined,async()=>assert.equal(api.currentWorkspaceReadGraph(),undefined));assert.equal(api.currentWorkspaceReadGraph(),f.graph);});
 assert.equal(api.currentWorkspaceReadGraph(),undefined);
 f.error={code:'PGRST202'};assert.equal(await api.loadWorkspaceReadGraph(f.client,'user'),null);
});
test('target permission reuse stays inside ordinary read request; writes and final probes reload grants',async()=>{
 const f=fixture();f.cookie[api.SELECTED_WORKSPACE_COOKIE]='manage:salon';
 await api.runWithReadContext(async()=>{await api.getCurrentBusinessContext();f.rest=0;await api.resolveSettingsTarget('salon');assert.equal(f.rest,0);
  await api.runWithFreshReadValidation(()=>api.resolveSettingsTarget('salon'));assert(f.rest>=2);
 });
 f.rest=0;await api.resolveSettingsTarget('salon');assert(f.rest>=2);
});
test('selected workspace projection equals original fresh builder without reloading identity or grants',async()=>{
 const f=fixture();
 for(const id of ['personal','account:account','manage:salon','staff:salon']){
  let projected;
  await api.runWithReadContext(async()=>{
   const source=await api.getCurrentBusinessContext();const rpc=f.rpc,rest=f.rest;
   projected=await api.projectSelectedWorkspaceRead(source,id);
   assert.equal(f.rpc,rpc);assert.equal(f.rest,rest);
   await assert.rejects(api.runWithFreshReadValidation(()=>api.projectSelectedWorkspaceRead(source,id)),/fresh workspace/);
  });
  f.cookie[api.SELECTED_WORKSPACE_COOKIE]=id;
  const independent=await api.runWithReadContext(()=>api.getCurrentBusinessContext());assert.deepEqual(projected,independent,id);
 }
});
test('projection cannot cross request, impersonate a context or select removed workspaces',async()=>{
 const f=fixture();let saved;
 await api.runWithReadContext(async()=>{saved=await api.getCurrentBusinessContext();await assert.rejects(api.projectSelectedWorkspaceRead({...saved},'manage:salon'),/fresh workspace/);await assert.rejects(api.projectSelectedWorkspaceRead(saved,'manage:other'),/fresh workspace/);});
 await api.runWithReadContext(()=>assert.rejects(api.projectSelectedWorkspaceRead(saved,'manage:salon'),/fresh workspace/));
 await assert.rejects(api.projectSelectedWorkspaceRead(saved,'manage:salon'),/fresh workspace/);
 f.graph.locations.length=0;f.graph.staff.length=0;
 await api.runWithReadContext(async()=>{const next=await api.getCurrentBusinessContext();await assert.rejects(api.projectSelectedWorkspaceRead(next,'manage:salon'),/fresh workspace/);});
});
