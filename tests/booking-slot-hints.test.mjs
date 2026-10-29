import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import ts from 'typescript';import{execFileSync}from'node:child_process';
const baseline=execFileSync('git',['show','4ab83c86c0bb4ef842dd47f1566db8069a4ed8a5:app/bookings/booking-workspace-client.tsx'],{encoding:'utf8',maxBuffer:4*1024*1024});
const names=new Set(['dateParts','toLocalInputValue','timeZoneParts','timeZoneOffsetMs','zonedDateTimeToUtcIso','selectedServices','totalDraftMinutes','lineConflicts','generateRealSlots']);
const source=ts.createSourceFile('baseline.tsx',baseline,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const snippets=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(source));assert.equal(snippets.length,names.size);
async function compile(contents){const r=await build({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'});const m={exports:{}};new Function('module','exports',r.outputFiles[0].text)(m,m.exports);return m.exports;}
const old=await compile(snippets.join('\n')+'\nexport{generateRealSlots,toLocalInputValue,zonedDateTimeToUtcIso};');
const api=await compile('export * from "./lib/booking-slot-hints";');
const date='2026-10-29';const utc=time=>old.zonedDateTimeToUtcIso(date,time,'America/Chicago');
function rule(staff_id=null,type='working',start='09:00',end='17:00',extra={}){return{salon_id:'salon',staff_id,rule_type:type,day_of_week:4,starts_at_local:start,ends_at_local:end,is_active:true,effective_start_date:null,effective_end_date:null,...extra};}
function fixture(){return {bookings:[],date,loadedDates:[date],lines:[{serviceId:'service',staffId:'kim'}],slotIntervalMinutes:15,cleanupBufferMinutes:5,timezone:'America/Chicago',toUTC:old.zonedDateTimeToUtcIso,toLocal:old.toLocalInputValue,options:{customers:[],staff:[{id:'kim',salon_id:'salon',is_active:true},{id:'other',salon_id:'salon',is_active:true}],services:[{id:'service',salon_id:'salon',is_active:true,duration_minutes:25}],assignments:[{staff_id:'kim',service_id:'service',salon_id:'salon',is_active:true,custom_duration_minutes:null,effective_start_date:null,effective_end_date:null}],availabilityRules:[rule()],timeBlocks:[]}};}
const times=f=>api.generateBookingSlotHints(f).map(x=>x.slice(11));
function booking(start,end,status='confirmed',lineStatus='scheduled'){return{normalizedStatus:status,lines:[{assigned_staff_id:'kim',scheduled_start_at:utc(start),scheduled_end_at:utc(end),line_status:lineStatus}]};}

test('exact uploaded59 generator falsely offers next-day slots using only today calendar; new hints require the loaded date',()=>{
 const f=fixture();f.loadedDates=['2026-10-28'];assert(old.generateRealSlots(f).includes(date+'T09:15'));assert.deepEqual(times(f),[]);
});
test('status, staff, service, source and search filters never imply an absent reservation is free time',()=>{
 const range={days:[{date}]},filters={query:'',serviceId:null,source:null,staffId:null,status:null};assert.deepEqual(api.bookingHintCalendarDates(range,filters),[date]);
 for(const key of Object.keys(filters))assert.deepEqual(api.bookingHintCalendarDates(range,{...filters,[key]:'filtered'}),[],key);
});
test('fresh next-day conflict rejects the physically failed09:15 and10:00 but retains the successful13:00 control',()=>{
 const f=fixture();f.bookings=[booking('09:30','10:05')];const result=times(f);assert(!result.includes('09:15'));assert(!result.includes('10:00'));assert(result.includes('13:00'));
});
test('staff-specific effective working hours replace shared hours rather than widening the schedule',()=>{
 const f=fixture();f.options.availabilityRules.push(rule('kim','working','11:00','17:00'));assert(old.generateRealSlots(f).includes(date+'T09:15'));const result=times(f);assert(!result.includes('09:15'));assert(result.includes('11:00'));
 f.options.availabilityRules[1].effective_start_date='2026-10-30';assert(times(f).includes('09:15'));
});
test('service eligibility is required and effective dates/inactive or foreign-salon links do not become choices',()=>{
 const f=fixture();assert.deepEqual(api.bookingHintStaff(f.options,'service',date).map(x=>x.id),['kim']);f.options.assignments[0].effective_end_date='2026-10-28';assert.deepEqual(times(f),[]);
 f.options.assignments[0].effective_end_date=null;f.options.assignments[0].salon_id='other';assert.deepEqual(api.bookingHintStaff(f.options,'service',date),[]);
});
test('dated breaks, time off and existing active lines exclude overlapping suggestions',()=>{
 const f=fixture();f.options.availabilityRules.push(rule('kim','break','12:00','12:30'));assert(!times(f).includes('11:45'));assert(times(f).includes('12:30'));
 f.options.timeBlocks=[{staff_id:null,is_active:true,cancelled_at:null,starts_at:utc('13:00'),ends_at:utc('14:00')}];assert(!times(f).includes('13:00'));f.options.timeBlocks[0].cancelled_at=utc('08:00');assert(times(f).includes('13:00'));
 f.bookings=[booking('13:00','14:00','confirmed','cancelled')];assert(times(f).includes('13:00'));f.bookings[0].lines[0].line_status='scheduled';assert(!times(f).includes('13:00'));
});
test('every sequential service respects its own professional schedule and custom duration plus cleanup',()=>{
 const f=fixture();f.options.assignments.push({...f.options.assignments[0],staff_id:'other'});f.lines.push({serviceId:'service',staffId:'other'});f.options.availabilityRules.push(rule('other','working','14:00','17:00'));assert(!times(f).includes('13:00'));assert(times(f).includes('13:30'));
 f.lines.pop();f.options.assignments[0].custom_duration_minutes=60;f.cleanupBufferMinutes=15;assert(!times(f).includes('16:00'));assert(times(f).includes('15:45'));
});
test('invalid intervals, no professional and unbounded selections cannot create loops or apparently available slots',()=>{
 const f=fixture();f.slotIntervalMinutes=0;assert.deepEqual(times(f),[]);f.slotIntervalMinutes=1;assert(times(f).length<=200);f.lines[0].staffId='';assert.deepEqual(times(f),[]);
});
