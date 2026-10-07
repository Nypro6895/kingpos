import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
function moduleFrom(file,dependencies){
  const exports={};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,require:name=>name==='@/lib/settings-target-context'?{withSettingsTarget:async(_id,fn)=>fn()}:dependencies[name]??{},FormData,Error,process});
  return exports;
}
test('unchecking portable permissions does not silently restore default privileges',async()=>{
 const writes=[];
 const query={update(input){writes.push(input);return this;},eq(){return this;},select(){return this;},async maybeSingle(){return {data:{id:'key'},error:null};}};
 const caps=require('typescript').transpileModule(readFileSync('lib/pos-portable-capabilities.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const capabilities={};vm.runInNewContext(caps,{exports:capabilities});
 const api=moduleFrom('app/settings/direct-pos-actions.ts',{
  '@/lib/current-context':{getCurrentBusinessContext:async()=>({user:{id:'user'},salonId:'salon'}),isSalonManageContext:()=>true},
  '@/lib/permissions':{requirePermission:async()=>{}},
  '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>({from:()=>query})},
  '@/lib/pos-portable-capabilities':capabilities,'node:crypto':require('node:crypto'),'next/cache':{revalidatePath(){}},
 });
 const form=new FormData();form.set('action','capabilities');form.set('key_id','key');
 const result=await api.saveDirectPortableAccess('salon',form);
 assert.equal(result.ok,true);assert.deepEqual(Array.from(writes[0].capabilities),['portable.pos.use']);
 form.append('capabilities','portable.book.create');
 assert.equal((await api.saveDirectPortableAccess('salon',form)).ok,true);
 assert.deepEqual(Array.from(writes[1].capabilities).sort(),['portable.book.create','portable.book.view','portable.pos.use']);
});
test('profile appearance and verification reject a different selected salon before reading or writing',async()=>{
 let reads=0,writes=0;
 const deps={
  '@/lib/current-context':{getCurrentBusinessContext:async()=>({user:{id:'user'},currentSalon:{id:'changed'}})},
  '@/lib/permissions':{hasPermission:async()=>true},
  '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>{reads++;return {from(){writes++;throw Error('unexpected write');}};}},
  '@/lib/salon-profile-preferences-server':{readSalonProfilePreferences:async()=>{reads++;}},
  '@/lib/salon-profile-preferences':{DEFAULT_PROFILE_PREFERENCES:{}},
  'node:crypto':require('node:crypto'),
 };
 const appearance=moduleFrom('app/settings/salon-profile-preferences-actions.ts',deps);
 assert.match((await appearance.loadSalonProfilePreferencesAction('original')).error,/selected salon changed/);
 assert.match((await appearance.saveSalonProfilePreferencesAction({},'original')).error,/selected salon changed/);
 const verification=moduleFrom('app/settings/salon-verification-actions.ts',deps);
 assert.match((await verification.loadSalonVerificationAction('original')).error,/selected salon changed/);
 assert.match((await verification.beginSalonVerificationAction(new FormData(),'original')).error,/selected salon changed/);
 assert.match((await verification.confirmSalonVerificationAction('request','123456','original')).error,/selected salon changed/);
 assert.equal(reads,0);assert.equal(writes,0);
});
test('own booking preferences cannot be saved to a different staff salon',async()=>{
 let calls=0;
 const api=moduleFrom('app/staff/appointments/staff-preferences-actions.ts',{
  '@/lib/current-context':{getCurrentStaffBusinessContext:async()=>({user:{id:'user'},currentStaffSalon:{id:'changed'}})},
  '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>{calls++;return {};}}
 });
 const result=await api.staffBookingPreferencesAction({preference:'online',enabled:false},'original');
 assert.equal(result.ok,false);assert.match(result.error,/selected staff salon changed/);assert.equal(calls,0);
});

test('rotating a POS passcode replaces its session signature and used keys cannot be deleted',async()=>{
 const writes=[], required=[], key={id:'key',access_id:'FrontDesk',last_login_at:'2026-10-06T12:00:00Z',last_used_at:null};
 const query={select(){return this;},eq(){return this;},update(patch){writes.push(patch);return this;},async maybeSingle(){return {data:key,error:null};}};
 const capabilities=moduleFrom('lib/pos-portable-capabilities.ts',{});
 const api=moduleFrom('app/settings/direct-pos-actions.ts',{
  '@/lib/current-context':{getCurrentBusinessContext:async()=>({user:{id:'user'},salonId:'salon'}),isSalonManageContext:()=>true},
  '@/lib/permissions':{requirePermission:async code=>required.push(code)},
  '@/lib/supabase/server':{createAuthenticatedSupabaseServerClient:async()=>({from:()=>query})},
  '@/lib/pos-portable-capabilities':capabilities,'node:crypto':require('node:crypto'),'next/cache':{revalidatePath(){}},
 });
 const form=new FormData();form.set('action','passcode');form.set('key_id','key');form.set('passcode','567890');
 assert.equal((await api.saveDirectPortableAccess('salon',form)).ok,true);
 assert.equal(required[0],"salon_settings.manage");
 assert.equal(writes[0].passcode_digest,require('node:crypto').createHash('sha256').update(`frontdesk:567890:${writes[0].passcode_salt}`).digest('hex'));
 form.set('action','delete');form.set('confirmed','on');const denied=await api.saveDirectPortableAccess('salon',form);assert.equal(denied.ok,false);assert.match(denied.error,/Only unused/);assert.equal(writes.length,1);
});
