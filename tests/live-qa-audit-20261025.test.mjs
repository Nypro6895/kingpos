import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
function load(path,deps={},extra="") {
 const exports={};const code=ts.transpileModule(readFileSync(path,'utf8')+extra,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',code)(name=>{if(name==='server-only')return {};if(name in deps)return deps[name];throw Error(name);},exports);return exports;
}
test('PostgREST scheduling validation remains actionable without exposing DB details',()=>{
 const m=load('lib/booking-domain/errors.ts');
 const text='Professional is unavailable: check service eligibility, working hours, breaks, time off, and overlapping appointments.';
 assert.deepEqual(m.bookingFailureFromUnknown({code:'P0001',message:text}),{ok:false,error:{code:'availability_conflict',message:text,field:'staffId'}});
 assert.equal(m.bookingFailureFromUnknown({code:'23P01',message:'private SQL'}).error.field,'startLocal');
 const unknown=m.bookingFailureFromUnknown({code:'23503',message:'private SQL'});
 assert.equal(Object.hasOwn(unknown.error,'field'),false);assert.ok(!JSON.stringify(unknown).includes('private SQL'));
});
test('Customer instants render in salon timezone across midnight and DST',()=>{
 const {formatCustomerDateTime:fmt}=load('lib/customer-date-time.ts');
 assert.match(fmt('2026-10-26T15:00:00Z','America/Chicago'),/Oct 26, 2026, 10:00 AM/);
 assert.match(fmt('2026-10-24T03:57:00Z','America/Chicago'),/Oct 23, 2026, 10:57 PM/);
 assert.match(fmt('2026-12-01T16:00:00Z','America/Chicago'),/10:00 AM/);
 assert.match(fmt('2026-10-26T15:00:00Z','America/Los_Angeles'),/8:00 AM/);
 const {bookingDate}=load('lib/portable-booking-layout.ts');
 assert.equal(bookingDate('2026-10-24T03:57:00Z','America/Chicago'),'2026-10-23');
});
test('Staff defaults to current semi-monthly period even before the final five days',()=>{
 const m=load('lib/staff-payroll-period.ts');const setting={cycle_type:'semi_monthly'};
 for(const [day,start] of [['01','01'],['15','01'],['16','16'],['24','16'],['31','16']]){
  assert.equal(m.staffPayPeriodChoices(setting,`2026-10-${day}`,[]).defaultPeriod.startDate,`2026-10-${start}`);
 }
 const owner=load('lib/payroll.ts',new Proxy({}, {has:()=>true,get:(_,name)=>name==='@/lib/staff-payroll-period'?m:{}}));
 assert.equal(owner.resolvePayrollPeriod({salonSetting:setting,referenceDate:new Date('2026-10-24T12:00Z')}).startDate,'2026-10-16');
 assert.equal(owner.resolvePayrollPeriod({salonSetting:setting,referenceDate:new Date('2026-10-24T12:00Z'),preset:'semi_monthly_first'}).startDate,'2026-10-01');
 assert.equal(owner.resolvePayrollPeriod({salonSetting:setting,referenceDate:new Date('2026-11-01T00:00Z'),timezone:'America/Chicago'}).startDate,'2026-10-16');
});
test('Cancelled and no-show rows remain visible without inflating booked count',()=>{
 const {countBookedAppointments:count}=load('lib/booking-count.ts');
 assert.equal(count(['cancelled','no_show','confirmed','pending','completed'].map(normalizedStatus=>({normalizedStatus}))),3);
});
test('Dashboard deadline resolves failure and handles a late rejection',async()=>{
 const {withDashboardDeadline}=load('lib/dashboard-deadline.ts');
 assert.equal(await withDashboardDeadline(Promise.resolve(42),10),42);
 await assert.rejects(withDashboardDeadline(new Promise(()=>{}),5),/retry/);
 await assert.rejects(withDashboardDeadline(Promise.reject(Error('offline')),100),/offline/);
});
test('Owner atomic RPC rolls back customer and linking when booking or reference write fails',async()=>{
 const db=new PGlite();const salon='00000000-0000-4000-8000-000000000001';const user='00000000-0000-4000-8000-000000000002';
 try{
 await db.exec(`create role anon;create role authenticated;
 create table users(id uuid primary key,status text);insert into users values('${user}','active');
 create table customers(id uuid primary key default gen_random_uuid(),location_id uuid,name text,phone text,email text,customer_user_id uuid,updated_by_user_id uuid);
 create table bookings(id uuid primary key default gen_random_uuid(),salon_id uuid,source_reference_type text check(source_reference_type<>'fail'),source_reference_id text,updated_by_user_id uuid);
 create function current_public_user_id() returns uuid language sql as $$select '${user}'::uuid$$;
 create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select true$$;
 create function create_booking_customer_identity(p_salon uuid,p_name text,p_phone text,p_email text,p_user uuid,p_actor uuid,p_source text) returns jsonb language plpgsql as $$declare c customers%rowtype;begin insert into customers(location_id,name) values(p_salon,p_name) returning * into c;return jsonb_build_object('customer',to_jsonb(c));end$$;
 create function create_canonical_booking(p_actor_source text,p_confirmation_mode text,p_confirmation_status text,p_customer_id uuid,p_customer_user_id uuid,p_end_at timestamptz,p_idempotency_key text,p_internal_notes text,p_lines jsonb,p_overbooking_override_reason text,p_public_notes text,p_salon_id uuid,p_source text,p_start_at timestamptz,p_status text) returns uuid language plpgsql as $$declare b uuid;begin if p_status='fail' then raise exception 'Professional is unavailable';end if;insert into bookings(salon_id) values(p_salon_id) returning id into b;return b;end$$;`);
 await db.exec(readFileSync('supabase/migrations/20261025060000_owner_booking_atomic.sql','utf8'));
 const call=(status='pending',customer={name:'Seed QA'},ref=null)=>db.query('select create_owner_booking_atomic($1,$2,$3,null) as result',[JSON.stringify({p_salon_id:salon,p_status:status}),JSON.stringify(customer),ref]);
 const count=async table=>Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
 await assert.rejects(call('fail'),/unavailable/);assert.equal(await count('customers'),0);assert.equal(await count('bookings'),0);
 await assert.rejects(call('pending',{name:'Seed QA'},'fail'),/check constraint/);assert.equal(await count('customers'),0);assert.equal(await count('bookings'),0);
 const first=(await call()).rows[0].result;assert.equal(await count('customers'),1);assert.equal(await count('bookings'),1);
 await assert.rejects(call('fail',{id:first.customer_id,user_id:user}),/unavailable/);
 assert.equal((await db.query('select customer_user_id from customers')).rows[0].customer_user_id,null);
 await call('pending',{id:first.customer_id,user_id:user});assert.equal((await db.query('select customer_user_id from customers')).rows[0].customer_user_id,user);
 await db.exec('create or replace function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select false$$');
 await assert.rejects(call(),/permission/);assert.equal(await count('customers'),1);
 }finally{await db.close();}
});

test('Deferred customer resolution performs no creation or account linking before the booking transaction',async()=>{
 const errors=load('lib/booking-domain/errors.ts');const match=load('lib/customer-identity-match.ts');let rows=[];const calls=[];
 const m=load('lib/booking-domain/customer-identity.ts',{'@/lib/customer-identity-match':match,'@/lib/booking-domain/errors':errors});
 const client={rpc:async(name)=>{calls.push(name);assert.equal(name,'booking_customer_identity_matches');return {data:rows,error:null};},from:()=>{throw Error('No writes allowed');}};
 const input={deferWrites:true,salonId:'salon',customer:{name:'Nene',phone:'4145550199'},supabase:client};
 const proposal=await m.resolveBookingCustomer(input);assert.equal(proposal.ok,true);assert.equal(proposal.data.created,true);assert.equal(proposal.data.customer.phone,'+14145550199');
 rows=[{id:'existing',name:'Nene',phone:'+14145550199',customer_user_id:null}];
 const existing=await m.resolveBookingCustomer(input);assert.equal(existing.ok,true);assert.equal(existing.data.created,false);assert.equal(existing.data.customer.id,'existing');assert.equal(calls.length,2);
});
test('Payroll refuses to report missing receipts as empty data after a DB failure',async()=>{
 const deps=new Proxy({}, {has:()=>true,get:(_,name)=>name==='@/lib/salon-business-clock'?{getSalonBusinessTimezone:async()=> 'America/Chicago'}:name==='@/lib/daily-pos-report'?{getUtcBoundsForLocalDate:()=>({openedFrom:'start',openedTo:'end'})}:{}});
 const m=load('lib/payroll.ts',deps,'\nexports.testClosingRows = loadDailyClosingRows; exports.testAnalytics = loadPayrollServiceAnalytics;');
 const query={select(){return this},eq(){return this},gte(){return this},lte(){return this},order(){return this},range(){return this},returns:async()=>({data:null,error:{code:'timeout'}})};
 await assert.rejects(m.testClosingRows({supabase:{from:()=>query},salon:{id:'salon'}},{startDate:'2026-10-01',endDate:'2026-10-15'}),/couldn't be loaded/);
 await assert.rejects(m.testAnalytics({supabase:{from:()=>query},salon:{id:'salon'}},{startDate:'2026-10-01',endDate:'2026-10-15'}),/couldn't be loaded/);
});
test('US phone display formats complete numbers and preserves international input',()=>{
 const {bookingPhoneDisplay:fmt}=load('lib/booking-phone-display.ts');assert.equal(fmt('+14145550199'),'(414) 555-0199');assert.equal(fmt('4145550199'),'(414) 555-0199');assert.equal(fmt('+84901234567'),'+84901234567');assert.equal(fmt('414'),'414');
});

test('Portable and appointment navigation copy keeps its Unicode punctuation',()=>{
 const portable=readFileSync('app/my-place/my-place-client.tsx','utf8');
 const appointments=readFileSync('app/(app)/my-bookings/page.tsx','utf8');
 assert.ok(portable.includes('salon’s Portable ID'));
 assert.ok(!portable.includes('salon?s Portable ID'));
 assert.ok(appointments.includes('Appointments here ·'));
});
