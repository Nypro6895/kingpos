import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['lib/payroll-history-navigation.ts'],bundle:true,platform:'node',format:'esm',write:false});
const nav=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const id='a0000000-1111-4111-8111-000000000001';
const period={startDate:'2026-10-16',endDate:'2026-10-31',cycleType:'semi_monthly',preset:'semi_monthly_second',label:'October 16–31'};
const event=(source,extra={})=>({id,source_table:source,period_start:'2026-10-29',period_end:'2026-10-29',...extra});

test('old aggregate links resolve the ordinary accessible section without turning a malformed ID into a record',()=>{
 for(const params of [{tab:'history'},{tab:'history',inputEvent:'bad-id'},{tab:'record'},{tab:'history',inputEvent:' '+id},{tab:['history'],inputEvent:[id]},{tab:'history',inputEvent:null}]){
  assert.equal(nav.resolvePayrollContextTab(params,true,[]),'overview');
  assert.equal(nav.resolvePayrollContextTab(params,false,[]),'staff');
 }
});
test('an exact authorized input uses its existing Staff or Shop object context, independent of old tab labels',()=>{
 for(const source of ['staff_day','payroll_settings','staff_payroll_settings','payroll_period_staff_inputs','pos_ticket_staff_earnings'])assert.equal(nav.resolvePayrollContextTab({tab:'history',inputEvent:id},true,[event(source)]),'staff');
 for(const source of ['daily_report','pos_daily_closings'])assert.equal(nav.resolvePayrollContextTab({tab:'history',inputEvent:id},true,[event(source)]),'shop');
 assert.equal(nav.resolvePayrollContextTab({tab:'history',inputEvent:id},false,[event('daily_report')]),'record');
});
test('ticket and unknown or outside-period IDs retain an exact-record state rather than masquerading as Overview',()=>{
 assert.equal(nav.resolvePayrollContextTab({tab:'history',inputEvent:id},true,[event('ticket')]),'record');
 assert.equal(nav.resolvePayrollContextTab({tab:'history',inputEvent:id},true,[]),'record');
 assert.equal(nav.resolvePayrollContextTab({inputEvent:id.toUpperCase()},false,[]),'record');
});
test('ticket deep links use only the captured single business day, not current period or unvalidated supplied dates',()=>{
 const old=event('ticket',{period_start:'2025-01-03',period_end:'2025-01-03'});
 const href=nav.payrollRecordContextHref(old,period),url=new URL(href,'https://example.test');
 assert.equal(url.pathname,'/staff/today');assert.equal(url.searchParams.get('eventDate'),'2025-01-03');assert.equal(url.searchParams.get('inputEvent'),id);assert.equal(url.hash,'#input-history');
 for(const date of ['2026-02-30','2026-13-01','not-a-date'])assert.equal(nav.payrollRecordContextHref(event('ticket',{period_start:date,period_end:date}),period),undefined);
 assert.equal(nav.payrollRecordContextHref(event('ticket',{period_end:'2026-10-31'}),period),undefined);
 assert.equal(nav.payrollRecordContextHref(event('ticket',{id:'invalid'}),period),undefined);
});
test('related payroll navigation preserves the selected original period and never shifts it to an event date',()=>{
 const before=JSON.stringify(period),record=event('staff_day',{period_start:'2025-01-03',period_end:'2025-01-03'});
 const url=new URL(nav.payrollRecordContextHref(record,period),'https://example.test');
 assert.equal(url.searchParams.get('tab'),'staff');assert.equal(url.searchParams.get('month'),'2026-10');assert.equal(url.searchParams.get('segment'),'second');assert.equal(url.searchParams.get('preset'),'semi_monthly_second');assert.equal(url.searchParams.get('inputEvent'),id);assert.equal(JSON.stringify(period),before);
 const custom={...period,cycleType:'custom',preset:'custom',startDate:'2026-07-03',endDate:'2026-08-09'};
 const customUrl=new URL(nav.payrollRecordContextHref(event('daily_report'),custom),'https://example.test');assert.equal(customUrl.searchParams.get('start'),custom.startDate);assert.equal(customUrl.searchParams.get('end'),custom.endDate);
});
