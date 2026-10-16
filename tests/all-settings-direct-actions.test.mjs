import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
function fixture({owner=true,canClose=true,status='active'}={}) {
  const writes=[],paths=[];
  const context={user:{id:'user'},salonId:'salon',accountId:'account',currentSalon:{id:'salon',name:'Test Salon'},currentMembership:{owner},workspaceType:'salon',salonMode:'manage'};
  const setting={business_name:'Old name',public_discovery_enabled:true,allow_staff_applications:true,operating_timezone_iana:'America/New_York',email:'salon@example.com',website:'https://example.com'};
  const dependencies={
    '@/lib/current-context':{getCurrentBusinessContext:async()=>context,isSalonManageContext:c=>c.workspaceType==='salon'&&c.salonMode==='manage',isOwnerMembership:m=>m.owner},
    '@/lib/permissions':{hasPermission:async()=>owner,requirePermission:async()=>{if(!owner)throw Error('Denied');}},
    '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>({})},
    '@/lib/salon-settings':{getCurrentSalonSetting:async()=>({setting}),updateCurrentSalonSetting:async input=>{if(!owner)throw Error('Denied');writes.push({action:'profile',input});}},
    '@/lib/salon-operating-status':{updateCurrentSalonOperatingHours:async input=>writes.push({action:'hours',input})},
    '@/lib/staff':{createStaff:async input=>writes.push({action:'create-staff',input}),updateStaffDirectoryBatch:async input=>writes.push({action:'staff',input})},
    '@/lib/payroll':{updateSalonPayrollSetting:async input=>writes.push({action:'pay-cycle',input}),updateStaffPayrollSetting:async input=>writes.push({action:'payroll',input})},
    '@/lib/salon-lifecycle':{getSalonLifecycle:async()=>({lifecycleStatus:status}),getSalonClosureReview:async()=>({canClose}),disableSalon:async input=>writes.push({action:'disable',input}),reactivateSalon:async input=>writes.push({action:'reactivate',input}),closeSalonPermanently:async input=>writes.push({action:'close',input})},
    '@/app/bookings/actions':{updateBookingSettingsAction:async input=>{writes.push({action:'booking',input});return {ok:false,message:'Instant booking is not ready.'};}},
    '@/lib/owner-transfer':{relinquishSalonOwnership:async input=>writes.push({action:'leave',input})},
    'next/cache':{revalidatePath:path=>paths.push(path)},'node:path':require('node:path'),'node:fs/promises':require('node:fs/promises'),
  };
  const code=ts.transpileModule(readFileSync('app/settings/direct-settings-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const exports={};vm.runInNewContext(code,{exports,require:name=>name==='@/lib/settings-target-context'?{withSettingsTarget:async(_id,fn)=>fn()}:dependencies[name]??{},FormData,Error,process});
  return {api:exports,writes,paths};
}
test('editing salon information preserves unrelated discovery, staff and contact settings',async()=>{
  const f=fixture();assert.equal((await f.api.saveDirectSalonProfile('salon',{business_name:'New name',phone:'123'})).ok,true);
  const saved=f.writes[0].input;assert.equal(saved.business_name,'New name');assert.equal(saved.public_discovery_enabled,true);assert.equal(saved.allow_staff_applications,true);assert.equal(saved.operating_timezone_iana,'America/New_York');assert.equal(saved.email,'salon@example.com');
});
test('a salon changed in another window cannot receive profile, hours, booking, staff, payroll or lifecycle mutations',async()=>{
  const f=fixture();
  for(const result of [await f.api.saveDirectSalonProfile('other',{}),await f.api.saveDirectHours('other',{}),await f.api.saveDirectBooking('other',{}),await f.api.saveDirectStaff('other',{}),await f.api.saveDirectPayroll('other',{}),await f.api.runDirectLifecycle('other','disable',new FormData())]){assert.equal(result.ok,false);assert.match(result.error,/selected salon changed/);}
  assert.equal(f.writes.length,0);
});
test('booking readiness errors return inline without a redirect or false success',async()=>{
  const f=fixture(),result=await f.api.saveDirectBooking('salon',{});assert.equal(result.ok,false);assert.equal(result.error,'Instant booking is not ready.');
});
test('salon status requires ownership, acknowledgement and the correct state',async()=>{
  const form=new FormData();form.set('confirmed','on');
  const denied=fixture({owner:false});assert.equal((await denied.api.runDirectLifecycle('salon','disable',form)).ok,false);assert.equal(denied.writes.length,0);
  const unconfirmed=fixture();assert.equal((await unconfirmed.api.runDirectLifecycle('salon','disable',new FormData())).ok,false);assert.equal(unconfirmed.writes.length,0);
  const wrongState=fixture({status:'disabled'});assert.equal((await wrongState.api.runDirectLifecycle('salon','disable',form)).ok,false);assert.equal(wrongState.writes.length,0);
});
test('permanent closure rechecks blockers and requires the salon name and backup choice',async()=>{
  const form=new FormData();form.set('confirmed','on');form.set('confirmation_name','Test Salon');form.set('backup_acknowledged','on');
  const blocked=fixture({canClose:false});assert.equal((await blocked.api.runDirectLifecycle('salon','close',form)).ok,false);assert.equal(blocked.writes.length,0);
  const allowed=fixture();assert.equal((await allowed.api.runDirectLifecycle('salon','close',form)).ok,true);assert.equal(allowed.writes[0].action,'close');
  form.set('confirmation_name','wrong');const wrongName=fixture();assert.equal((await wrongName.api.runDirectLifecycle('salon','close',form)).ok,false);assert.equal(wrongName.writes.length,0);
});
test('staff payroll and pay-cycle saves retain their distinct domain operations',async()=>{
  const f=fixture();await f.api.saveDirectPayroll('salon',{cycleType:'monthly',biweeklyAnchorDate:null});await f.api.saveDirectPayroll('salon',{staffId:'staff',effectiveFrom:'2026-10-06'});assert.equal(f.writes[0].action,'pay-cycle');assert.equal(f.writes[1].action,'payroll');
});
test('All Settings no longer contains the navigation-only overview fallback',()=>{
  const source=readFileSync('app/settings/all-settings-client.tsx','utf8');assert.doesNotMatch(source,/Open full setup|SettingOverviewDetail|settingQuickItems|Open full security setup/);assert.match(source,/DirectSettingsPanel/);assert.match(source,/SalonListPanel initialCreate/);assert.match(source,/LoginSecurityPanel/);
});
