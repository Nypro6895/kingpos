import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';

test('booking action enforces salon and permission, changes only booking fields, preserves assignment metadata',async()=>{
 const compiled=await build({entryPoints:['app/settings/staff-hours-booking-actions.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'server-stubs',setup(b){b.onResolve({filter:/^@\/|^next\/cache$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.includes('current-context')?'export const getCurrentBusinessContext=async()=>globalThis.fixture.context;':a.path.includes('settings-target')?'export const withSettingsTarget=async(id,fn)=>fn();':a.path.includes('permissions')?'export const requirePermission=async(p)=>{globalThis.fixture.permissions.push(p);if(globalThis.fixture.deny)throw Error("denied");};':a.path.includes('supabase')?'export const createAuthenticatedSupabaseServerClient=async()=>globalThis.fixture.client;':'export const revalidatePath=p=>globalThis.fixture.paths.push(p);'}));}}]});
 const fixture={context:{user:{id:'user'},currentSalon:{id:'salon'}},permissions:[],paths:[],writes:[],deny:false};
 const original={id:'assignment',salon_id:'salon',staff_id:'ny',service_id:'mani',is_active:true,online_bookable:true,custom_price:55,custom_duration_minutes:70,effective_start_date:'2026-11-01',effective_end_date:null};
 fixture.client={from(table){let mutation=null;const chain={select(){return chain},eq(){return chain},single:async()=>{if(mutation){fixture.writes.push({table,...mutation});return{data:{id:'ny'}};}return{data:{id:'ny',is_active:true}};},update(data){mutation={data};return chain},upsert:async(data)=>{fixture.writes.push({table,data});return{}},then(resolve){resolve({data:table==='services'?[{id:'mani',is_active:true,online_booking_enabled:true},{id:'pedi',is_active:true,online_booking_enabled:true}]:[original]});}};return chain;}};
 const module={exports:{}};vm.runInNewContext(compiled.outputFiles[0].text,{module,exports:module.exports,globalThis:{fixture},Set,Error});
 const save=module.exports.saveStaffHoursBooking;
 assert.equal((await save({salonId:'other',staffId:'ny',enabled:true})).ok,false);assert.equal(fixture.writes.length,0);
 fixture.deny=true;assert.equal((await save({salonId:'salon',staffId:'ny',enabled:true})).ok,false);assert.equal(fixture.writes.length,0);fixture.deny=false;
 assert.equal((await save({salonId:'salon',staffId:'ny',enabled:true})).ok,true);assert.deepEqual(JSON.parse(JSON.stringify(fixture.writes[0].data)),{online_booking_enabled:true});
 assert.equal((await save({salonId:'salon',staffId:'ny',serviceIds:['foreign']})).ok,false);assert.equal(fixture.writes.length,1);
 assert.equal((await save({salonId:'salon',staffId:'ny',serviceIds:['pedi']})).ok,true);
 const rows=fixture.writes[1].data;const old=rows.find(r=>r.service_id==='mani');assert.equal(old.online_bookable,false);assert.equal(old.is_active,true);assert.equal(old.custom_price,55);assert.equal(old.custom_duration_minutes,70);assert.equal(old.effective_start_date,'2026-11-01');
 assert.equal(rows.find(r=>r.service_id==='pedi').online_bookable,true);assert.ok(fixture.permissions.includes('services.manage'));assert.ok(fixture.paths.includes('/book/salon'));
});
