import test from 'node:test';import assert from 'node:assert/strict';import {buildSync} from 'esbuild';
const readModule=file=>{const mod={exports:{}};new Function('module','exports',buildSync({entryPoints:[file],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text)(mod,mod.exports);return mod.exports};
const {payrollReadArgs:args}=readModule('lib/payroll-read-args.ts'),{payrollPageLoadPlan:plan}=readModule('lib/payroll-page-load-plan.ts');
test('only equivalent native money tabs share their server read; entitlement and check reads stay distinct',()=>{for(const tab of ['shop','gifts','rewards','discounts']){assert.equal(args('/payroll?tab='+tab).tab,'shop');for(const owner of [true,false])assert.deepEqual(plan(args('/payroll?tab='+tab).tab,owner),plan(tab,owner));}for(const tab of ['tools','download','tax','staff','analytics','settings','record','overview','differences'])assert.equal(args('/payroll?tab='+tab).tab,tab);});
test('default Shop and explicit Shop share a read key; UI filters do not duplicate period reads',()=>{assert.deepEqual(args('/payroll'),{tab:'shop'});assert.deepEqual(args('/payroll?tab=shop&overviewStaff=someone&inputEvent=event-1'),args('/payroll'));assert.deepEqual(args('/payroll?tab=tools&start=2026-10-16&end=2026-10-31'),{start:'2026-10-16',end:'2026-10-31',tab:'tools'});assert.equal(args('/payroll?tab=invalid').tab,'shop');});
const {payrollPeriodHref}=readModule('lib/payroll-period-rail.ts');
test('the exact server-resolved default period shares its original key, including the real tab href',()=>{
  for(const period of [
    {cycleType:'monthly',preset:'current_month',startDate:'2026-11-01',endDate:'2026-11-30',label:'November'},
    {cycleType:'semi_monthly',preset:'semi_monthly_second',startDate:'2026-11-16',endDate:'2026-11-30',label:'Second'},
    {cycleType:'biweekly',preset:'current_pay_period',startDate:'2026-11-06',endDate:'2026-11-19',label:'Period'},
    {cycleType:'custom',preset:'custom',startDate:'2026-10-29',endDate:'2026-11-05',label:'Custom'},
  ])for(const tab of ['shop','gifts','rewards','discounts']) {
    const href=payrollPeriodHref(period,tab);
    assert.deepEqual(args(href,period),{tab:'shop'});
    assert.notDeepEqual(args(href),{tab:'shop'},'an unverified default cannot infer the selected period');
  }
});
test('other periods and conflicting query arguments never borrow the default; privileged tabs never share it',()=>{
  const period={cycleType:'monthly',preset:'current_month',startDate:'2026-11-01',endDate:'2026-11-30',label:'November'};
  for(const suffix of ['&month=2026-12','&start=2026-11-02','&segment=second']) {
    const href=payrollPeriodHref(period,'gifts')+suffix;
    if(suffix.startsWith('&month=')) continue; // URLSearchParams uses the first duplicate value.
    assert.notDeepEqual(args(href,period),{tab:'shop'});
  }
  assert.equal(args('/payroll?tab=gifts&preset=current_month&month=2026-12',period).month,'2026-12');
  for(const tab of ['staff','tax','tools','analytics','download'])assert.equal(args(payrollPeriodHref(period,tab),period).tab,tab);
});
