import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url), ts=require('typescript');
function moduleFrom(file,dependencies){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>dependencies[name]??{},Error});return exports;}
function fixture(){
 const scope=moduleFrom('lib/scoped-business-context.ts',{'node:async_hooks':require('node:async_hooks')});
 const accounts=[{id:'business',name:'My Business'}],salons=['owned','managed','work'].map(id=>({id,name:id,account_id:'business',status:'active'}));
 const original={user:{id:'user'},workspaceType:'personal',salonId:null,availableAccounts:accounts,availableManageSalons:salons.slice(0,2),availableStaffSalons:[salons[2]],workspaceOptions:salons.map((s,i)=>({id:s.id,salonId:s.id,salonMode:i===2?'staff':'manage',roleLabel:i===0?'Owner':i===1?'Manager':'Staff'})),salonMemberships:[{salon_id:'owned',status:'active',role:{code:'OWNER'}},{salon_id:'managed',status:'active',role:{code:'MANAGER'}}],accountMemberships:[]};
 const current={getCurrentBusinessContext:async()=>scope.scopedBusinessContext()??original,isOwnerMembership:m=>m?.role?.code==='OWNER',getCurrentRolePermissionCodesForMembership:async m=>m.role.code==='OWNER'?['account.manage']:['services.view']};
 const api=moduleFrom('lib/settings-target-context.ts',{'./current-context':current,'./scoped-business-context':scope});
 return {scope,current,api,original};
}
test('personal workspace can edit authorized salon without changing selected workspace',async()=>{
 const f=fixture();await f.api.withSettingsTarget('owned',async()=>{const c=await f.current.getCurrentBusinessContext();assert.equal(c.salonId,'owned');assert.equal(c.salonMode,'manage');assert.equal(c.currentMembership.role.code,'OWNER');});
 assert.equal(await f.current.getCurrentBusinessContext(),f.original);assert.equal(f.original.salonId,null);
});
test('staff target cannot acquire salon management permissions or access another salon',async()=>{
 const f=fixture();const c=await f.api.resolveSettingsTarget('work','staff');assert.equal(c.currentMembership,null);assert.equal(c.permissionCodes.length,0);assert.equal(c.currentStaffSalon.id,'work');
 let calls=0;for(const [id,mode] of [['work','manage'],['owned','staff'],['stranger','auto']])await assert.rejects(f.api.withSettingsTarget(id,async()=>calls++,mode),/access/);assert.equal(calls,0);
});
test('concurrent salon operations keep independent targets and restore context after failure',async()=>{
 const f=fixture();let releaseA,releaseB;const gateA=new Promise(r=>releaseA=r),gateB=new Promise(r=>releaseB=r);
 const a=f.api.withSettingsTarget('owned',async()=>{await gateA;assert.equal((await f.current.getCurrentBusinessContext()).salonId,'owned');releaseB();throw Error('save failed');});
 const b=f.api.withSettingsTarget('managed',async()=>{releaseA();await gateB;const c=await f.current.getCurrentBusinessContext();assert.equal(c.salonId,'managed');assert.deepEqual(Array.from(c.permissionCodes),['services.view']);});
 const results=await Promise.allSettled([a,b]);assert.equal(results[0].status,'rejected');assert.equal(results[1].status,'fulfilled');assert.equal(await f.current.getCurrentBusinessContext(),f.original);
});
test('account ownership takes precedence over a narrower direct membership',async()=>{
 const f=fixture();f.original.accountMemberships.push({account_id:'business',status:'active',role:{code:'OWNER'}});assert.equal((await f.api.resolveSettingsTarget('managed','manage')).currentMembership.role.code,'OWNER');
});
