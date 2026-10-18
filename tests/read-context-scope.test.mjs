import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { AsyncLocalStorage } from 'node:async_hooks';
const require=createRequire(import.meta.url);
const source=file=>readFileSync(file,'utf8');
function load(text,deps={},extra={}) {
  const exports={};vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>name==='server-only'?{}:deps[name]??require(name),URL,Request,Response,Headers,AbortController,DOMException,process,setTimeout,clearTimeout,...extra});return exports;
}
function fixture() {
  const scope=load(source('lib/read-context-scope.ts')),target=load(source('lib/scoped-business-context.ts')),request=new AsyncLocalStorage();let calls=0;
  const ast=ts.createSourceFile('current.ts',source('lib/current-context.ts'),ts.ScriptTarget.Latest,true);
  const wrapper=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='getCurrentBusinessContext'||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['getDefaultBusinessContext','businessReadKey'].includes(d.name.getText(ast)))).map(n=>n.getText(ast)).join('\n');
  const context=load(wrapper,{}, {cache:require('react').cache,scopedBusinessContext:target.scopedBusinessContext,memoizeReadContext:scope.memoizeReadContext,loadCurrentBusinessContext:async options=>{calls++;await new Promise(r=>setImmediate(r));return{user:{id:options.accessToken??request.getStore()?.viewer??'default',status:'active',language:'en'},currentWorkspace:{id:'salon'},workspaceType:'salon',salonMode:'manage',accountId:'account',currentSalon:{id:'salon',status:'active'},currentAccount:{status:'active'},currentMembership:{status:'active'},permissionCodes:[],permissions:[],activeRole:{code:'OWNER'},defaultRouteForCurrentContext:'/staff/today'}}});
  const current={...context,isSalonManageContext:()=>true,getCurrentStaffBusinessContext:()=>{throw Error('Staff resolution must not be replaced by owner memoization')}};
  const bounded=load(source('lib/bounded-get.ts'));
  const business=load(source('lib/request-business-context.ts'),{'@/lib/current-context':current,'@/lib/bounded-get':bounded});
  const experience=load(source('lib/experience-context.ts'));
  const deps={'next/headers':{headers:async()=>new Headers(),cookies:async()=>({get(){}})},'next/server':{connection:async()=>{}},'@/lib/request-business-context':business,'@/lib/read-context-scope':scope,'@/lib/current-context':current,'@/lib/experience-context':experience,'@/lib/experience-offline-policy':{EXPERIENCE_OFFLINE_MAX_AGE:86400000,getExperienceOfflinePath:path=>path},'@/lib/staff-portal-identity':{},'@/lib/supabase/server':{},'@/lib/staff-workdays':{},'@/lib/staff-account':{},'@/lib/bounded-get':bounded,'@/lib/staff-offline-binding-server':{},'@/lib/app-local-portable-context-server':{readAppLocalPortableContext:async()=>null},'@/lib/app-local-display-server':{readAppLocalDisplayContext:async()=>null}};
  deps['@/app/api/experience/offline-context/route']=load(source('app/api/experience/offline-context/route.ts'),deps);
  const route=load(source('app/api/app-local/context/route.ts'),deps);
  const before=load(execFileSync('git',['show','eedd852:app/api/app-local/context/route.ts'],{encoding:'utf8'}),deps);
  return{scope,target,request,current,route,before,calls:()=>calls};
}
const request=()=>new Request('https://reylumi.com/api/app-local/context?path=/pos&generation=read-context-test-device');

test('actual context and lease routes load business context once rather than twice',async()=>{
  const old=fixture(),next=fixture();const a=await old.before.GET(request()),b=await next.route.GET(request());
  assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(old.calls(),2);assert.equal(next.calls(),1);
  const body=await b.json();assert.equal(body.grant.kind,'owner');assert.equal(body.context.scope,body.grant.scope);
});
test('overlapping HTTP requests never share viewer context',async()=>{
  const f=fixture();const values=await Promise.all(['alice','bob'].map(viewer=>f.request.run({viewer},()=>f.route.GET(request()).then(r=>r.json()))));
  assert.deepEqual(values.map(v=>v.context.viewerId),['alice','bob']);assert.notEqual(values[0].context.scope,values[1].context.scope);assert.equal(f.calls(),2);
});
test('nested read operations share in-flight work, while writes and later requests read afresh',async()=>{
  const f=fixture();await f.scope.runWithReadContext(async()=>{const [a,b]=await Promise.all([f.current.getCurrentBusinessContext(),f.scope.runWithReadContext(()=>f.current.getCurrentBusinessContext())]);assert.equal(a,b)});assert.equal(f.calls(),1);
  await f.scope.runWithReadContext(()=>f.current.getCurrentBusinessContext());assert.equal(f.calls(),2);
  await f.current.getCurrentBusinessContext();await f.current.getCurrentBusinessContext();assert.equal(f.calls(),4);
});
test('explicit credentials and Settings target overrides cannot borrow the default identity',async()=>{
  const f=fixture();await f.scope.runWithReadContext(async()=>{
    const original=await f.current.getCurrentBusinessContext();const explicit=await f.current.getCurrentBusinessContext({accessToken:'explicit-user'});assert.equal(explicit.user.id,'explicit-user');assert.notEqual(explicit,original);
    const target={user:{id:'same-user'},currentSalon:{id:'other-salon'}};await f.target.runInBusinessContext(target,async()=>assert.equal(await f.current.getCurrentBusinessContext(),target));
    assert.equal(await f.current.getCurrentBusinessContext(),original);
  });assert.equal(f.calls(),2);
});
test('a rejected identity is never replaced with stale data from an earlier request',async()=>{
  const f=fixture(),key=Symbol('failed');let calls=0;
  await f.scope.runWithReadContext(async()=>{const read=()=>f.scope.memoizeReadContext(key,async()=>{calls++;throw Error('unavailable')});await Promise.all([assert.rejects(read(),/unavailable/),assert.rejects(read(),/unavailable/)]);});assert.equal(calls,1);
  const value=await f.scope.runWithReadContext(()=>f.scope.memoizeReadContext(key,async()=>{calls++;return'fresh'}));assert.equal(value,'fresh');assert.equal(calls,2);
});
