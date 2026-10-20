import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

const load = (file, dependencies = {}) => {
  const exports = {}, code = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(key=>{assert.ok(Object.hasOwn(dependencies,key),`${file}: unexpected ${key}`);return dependencies[key];},exports);
  return exports;
};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const generation='staff-online-access-fixture-20261020';
const experience=load('lib/experience-context.ts',{'server-only':{},'node:crypto':crypto});
const shape=load('lib/staff-offline-binding.ts');
const policy=load('lib/experience-offline-policy.ts',{'./staff-offline-binding':shape});
const approved={version:1,staffId:id(30),viewerId:id(1),salonId:id(20),revision:id(50),approvedAt:'2026-01-01T00:00:00Z',revoked:false};
function fixture(options={}){
  const context={user:{id:id(1),auth_user_id:id(101),status:'active',language:'en'},accountId:id(10),currentSalon:{id:id(20),account_id:id(10),status:'active'},currentStaffSalon:{id:id(20)},currentAccount:{id:id(10),status:'active'},currentWorkspace:{id:`staff:${id(20)}`,type:'salon',salonMode:'staff',salonId:id(20),accountId:id(10)},salonMode:'staff',workspaceType:'salon',activeRole:{code:'STAFF'},permissionCodes:[],permissions:[],defaultRouteForCurrentContext:'/staff/my-work'};
  options.changeContext?.(context);
  const staff=options.noStaff?null:{id:id(30),salon_id:id(20)},calls=[];
  const proof={version:1,state:'missing',staffId:id(30),viewerId:id(1),salonId:id(20),accountId:id(10)};
  const client=options.noClient?null:{rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='get_my_staff_offline_binding')return{data:options.approved??null,error:options.offlineError?{code:'SYNTHETIC'}:null};
    assert.equal(name,'get_my_staff_online_access');
    assert.deepEqual(args,{p_staff_id:id(30),p_salon_id:id(20),p_account_id:id(10)});
    if(options.rpcThrows)throw Error('Synthetic transport failure');
    return{data:Object.hasOwn(options,'proof')?options.proof:proof,error:options.onlineError?{code:'SYNTHETIC'}:null};
  }};
  const supabase={'@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>client}};
  const deadline={'@/lib/bounded-get':{runReadWithDeadline:async(promise,ms)=>{assert.equal(ms,8000);if(options.timeout)throw Object.assign(Error('Synthetic deadline'),{status:503});return promise;}}};
  const online=load('lib/staff-online-access-server.ts',{'server-only':{},...supabase,...deadline,'@/lib/experience-context':experience});
  const binding=load('lib/staff-offline-binding-server.ts',{'server-only':{},...supabase,...deadline,'./staff-offline-binding':shape});
  const headers={'next/headers':{headers:async()=>new Headers(options.authUnavailable?{'x-reylumi-auth-unavailable':'1'}:{}),cookies:async()=>({get:()=>undefined})},'next/server':{connection:async()=>{}}};
  const scope={'@/lib/read-context-scope':{runWithReadContext:read=>read()}};
  const request={'@/lib/request-business-context':{getRequestBusinessContext:async()=>options.otherRootViewer?{...context,user:{...context.user,id:id(2)}}:context}};
  const current={'@/lib/current-context':{getCurrentStaffBusinessContext:async()=>context,isSalonManageContext:()=>false}};
  const identity={'@/lib/staff-portal-identity':{getStaffPortalIdentity:async()=>({context,staff})}};
  const offline=load('app/api/experience/offline-context/route.ts',{'node:crypto':crypto,...headers,...scope,...request,...current,...identity,...deadline,'@/lib/experience-context':experience,'@/lib/experience-offline-policy':policy,'@/lib/supabase/server':{},'@/lib/staff-workdays':{getCurrentStaffForSalon:async()=>staff},'@/lib/staff-account':{},'@/lib/staff-offline-binding-server':binding});
  const timing={measure:async(_name,read)=>read(),measureSync:(_name,read)=>read(),finish:response=>response};
  const route=load('app/api/app-local/context/route.ts',{...headers,...scope,...request,...current,...identity,'@/lib/experience-context':experience,'@/lib/experience-offline-policy':policy,'@/app/api/experience/offline-context/route':offline,'@/lib/staff-online-access-server':online,'@/lib/app-local-portable-context-server':{readAppLocalPortableContext:async()=>null},'@/lib/app-local-display-server':{readAppLocalDisplayContext:async()=>null},'@/lib/read-request-timing':{createReadRequestTiming:()=>timing}});
  const makeRequest=path=>new Request('https://fixture.invalid/api/app-local/context?'+new URLSearchParams({path,generation}),{headers:options.capabilityHeader===null?{}:{'X-Reylumi-Staff-Online-Access':options.capabilityHeader??'1'}});
  return{context,staff,proof,calls,online,async read(path='/staff/my-work'){const response=await route.GET(makeRequest(path));return{response,body:await response.json()};},async offlineRead(path='/staff/my-work'){const response=await offline.GET(makeRequest(path));return{response,body:await response.json()};}};
}

test('real context and offline handlers distinguish fresh eligible missing approval from protected offline access',async()=>{
  for(const path of ['/staff/my-work','/staff/workday','/staff/appointments','/staff/my-work?tab=payroll']){
    const f=fixture(),before=Date.now(),{response,body}=await f.read(path);
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(body.grantStatus,503);assert.equal(body.grant,null);assert.equal(body.offlineState,'online-only');assert.equal(body.access.staffWorkspace,true);assert.equal(body.access.ownerWorkspace,false);
    assert.deepEqual(body.staffOnlineAccess,{version:1,staffId:id(30),viewerId:id(1),salonId:id(20),scope:experience.getExperienceContext(f.context).scope});
    assert.ok(body.onlineValidatedAt>=before&&body.onlineValidatedAt<=Date.now());
    assert.deepEqual(f.calls.map(c=>c.name),['get_my_staff_offline_binding','get_my_staff_online_access']);
    const offline=await f.offlineRead(path);assert.equal(offline.response.status,503);assert.equal(offline.body.offlineState,'unconfirmed');assert.equal('staffOnlineAccess'in offline.body,false);
  }
});

test('approved, explicit revoked and generic lease outages never use missing-approval proof',async()=>{
  for(const options of [{approved},{approved:{...approved,revoked:true}},{offlineError:true}]){
    const f=fixture(options),{response,body}=await f.read();assert.equal(response.status,200);
    assert.equal('staffOnlineAccess'in body,false);assert.equal(f.calls.some(c=>c.name==='get_my_staff_online_access'),false);
    assert.equal(body.grantStatus,options.offlineError?503:options.approved.revoked?403:200);
    if(options.offlineError)assert.equal('offlineState'in body,false);
    if(options.approved&&!options.approved.revoked)assert.equal(body.grant.kind,'staff');
  }
});

test('older or unknown client capability preserves unconfirmed and never queries the new proof',async()=>{
  for(const capabilityHeader of [null,'','0','true','2','01','1,1']){
    const f=fixture({capabilityHeader}),{response,body}=await f.read();assert.equal(response.status,200);assert.equal(body.grantStatus,503);assert.equal(body.offlineState,'unconfirmed');assert.equal(body.grant,null);assert.equal('staffOnlineAccess'in body,false);assert.equal(f.calls.some(c=>c.name==='get_my_staff_online_access'),false);
  }
});

test('unconfirmed cannot become online-only from invalid, absent, mismatched or nonmissing proof responses',async()=>{
  const base=fixture().proof;
  for(const proof of [null,[],{},'missing',{...base,state:'binding-present'},{...base,state:'revoked'},{...base,state:'denied'},{...base,version:2},...['staffId','viewerId','salonId','accountId'].map(key=>({...base,[key]:id(99)}))]){
    const f=fixture({proof}),{response,body}=await f.read();assert.equal(response.status,200);assert.equal(body.grantStatus,503);assert.equal(body.grant,null);assert.equal(body.offlineState,'unconfirmed');assert.equal('staffOnlineAccess'in body,false);
  }
});

test('proof RPC failure cannot erase unconfirmed into a successful generic online503 envelope',async()=>{
  for(const options of [{onlineError:true},{rpcThrows:true}]){
    const f=fixture(options),{response,body}=await f.read();assert.equal(response.status,503);assert.deepEqual(body,{error:'Connect to verify your account'});assert.equal('onlineValidatedAt'in body,false);assert.equal('staffOnlineAccess'in body,false);
  }
  for(const options of [{noClient:true},{timeout:true}]){
    const f=fixture(options);await assert.rejects(f.online.getStaffOnlineOnlyAccess({context:f.context,staff:f.staff}));
  }
});

test('helper requires exact active selected Staff account/salon/workspace before querying new proof',async()=>{
  const changes=[
    c=>{c.user.status='inactive';},c=>{c.currentSalon.status='inactive';},c=>{c.currentAccount.status='inactive';},
    c=>{c.currentStaffSalon.id=id(99);},c=>{c.currentSalon.account_id=id(99);},c=>{c.accountId=id(99);},
    c=>{c.currentWorkspace.id='manage:'+id(20);},c=>{c.currentWorkspace.type='personal';},c=>{c.currentWorkspace.salonMode='manage';},
    c=>{c.currentWorkspace.salonId=id(99);},c=>{c.currentWorkspace.accountId=id(99);},c=>{c.workspaceType='personal';},c=>{c.salonMode='manage';},
    c=>{c.user.id='invalid';},c=>{c.currentSalon=null;},c=>{c.currentAccount=null;},c=>{c.currentWorkspace=null;},
  ];
  for(const changeContext of changes){const f=fixture({changeContext});assert.equal(await f.online.getStaffOnlineOnlyAccess({context:f.context,staff:f.staff}),null);assert.deepEqual(f.calls,[]);}
  const f=fixture();assert.equal(await f.online.getStaffOnlineOnlyAccess({context:f.context,staff:{...f.staff,salon_id:id(99)}}),null);assert.equal(await f.online.getStaffOnlineOnlyAccess({context:f.context,staff:null}),null);assert.deepEqual(f.calls,[]);
});

test('proof never crosses page family, account switch or auth-unavailable boundaries',async()=>{
  for(const path of ['/explore','/market','/staff/today','/staff/my-work/extra']){
    const f=fixture(),{body}=await f.read(path);assert.equal('staffOnlineAccess'in body,false);assert.equal(f.calls.some(c=>c.name==='get_my_staff_online_access'),false);
  }
  for(const [options,status]of [[{otherRootViewer:true},409],[{authUnavailable:true},503]]){
    const f=fixture(options),{response,body}=await f.read();assert.equal(response.status,status);assert.equal('staffOnlineAccess'in body,false);assert.deepEqual(f.calls,[]);
  }
  const f=fixture({noStaff:true}),{body}=await f.read();assert.equal(body.grantStatus,403);assert.equal('staffOnlineAccess'in body,false);assert.deepEqual(f.calls,[]);
});

test('online proof scope comes from current server context, never arbitrary RPC payload fields',async()=>{
  const base=fixture().proof,f=fixture({proof:{...Object.fromEntries(Object.entries(base).reverse()),scope:'v3:'+'b'.repeat(64),approved:true}});
  const proof=await f.online.getStaffOnlineOnlyAccess({context:f.context,staff:f.staff});assert.equal(proof.scope,experience.getExperienceContext(f.context).scope);assert.equal('approved'in proof,false);assert.equal('accountId'in proof,false);
});
