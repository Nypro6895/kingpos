import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(file){const exports={};new Function('exports',ts.transpileModule(fs.readFileSync(new URL('../lib/'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);return exports;}
const money=load('payroll-money.ts'),periods=load('payroll-period-boundary.ts');
test('fixed period cents are preserved including negative and tiny amounts',()=>{
 for(const total of [0,1,-1,10000,-10000,99999999])for(const days of [1,14,15,16,28,29,30,31]){
  const values=money.allocatePayrollCents(total,days);assert.equal(values.reduce((a,b)=>a+b,0),total);assert(Math.max(...values)-Math.min(...values)<=1);
 }
 const days=Array.from({length:15},(_,i)=>money.fixedPayrollDayAmount(100,15,i));assert.equal(days.reduce((a,b)=>a+Math.round(b*100),0),10000);assert.equal(days[0],6.67);assert.equal(days[14],6.66);
});
test('money inputs reject invalid precision, infinity and scientific notation',()=>{
 for(const value of ['1.005','1e2','NaN','Infinity','-',''])assert.throws(()=>money.parsePayrollMoney(value));
 assert.equal(money.parsePayrollMoney('-0.01'),-.01);assert.equal(money.parsePayrollMoney('100.00'),100);
});
test('calendar periods preserve leap days and biweekly anchors across years',()=>{
 assert.deepEqual(periods.payrollPeriodContaining('2028-02-29',{cycle_type:'monthly',biweekly_anchor_date:null}),{startDate:'2028-02-01',endDate:'2028-02-29',cycleType:'monthly'});
 assert.deepEqual(periods.payrollPeriodContaining('2026-10-15',{cycle_type:'semi_monthly',biweekly_anchor_date:null}),{startDate:'2026-10-01',endDate:'2026-10-15',cycleType:'semi_monthly'});
 assert.equal(periods.payrollPeriodContaining('2026-10-16',{cycle_type:'semi_monthly',biweekly_anchor_date:null}).startDate,'2026-10-16');
 assert.deepEqual(periods.payrollPeriodContaining('2026-12-31',{cycle_type:'biweekly',biweekly_anchor_date:'2027-01-04'}),{startDate:'2026-12-21',endDate:'2027-01-03',cycleType:'biweekly'});
 assert.throws(()=>periods.payrollPeriodContaining('2026-02-30',{cycle_type:'monthly',biweekly_anchor_date:null}));
 assert.throws(()=>periods.payrollPeriodContaining('2026-02-20',{cycle_type:'biweekly',biweekly_anchor_date:null}));
});
test('closing follows salon midnight through DST, not UTC or a fixed 24-hour offset',()=>{
 const cases=[['2026-03-08','2026-03-09T04:59:59Z','2026-03-09T05:00:00Z'],['2026-11-01','2026-11-02T05:59:59Z','2026-11-02T06:00:00Z']];
 for(const [end,before,after]of cases){const p={startDate:end,endDate:end,cycleType:'biweekly'};assert.equal(periods.isPayrollPeriodClosed(p,new Date(before),'America/Chicago'),false);assert.equal(periods.isPayrollPeriodClosed(p,new Date(after),'America/Chicago'),true);}
 assert.equal(periods.payrollLocalDate(new Date('2026-10-31T17:00:00Z'),'Asia/Ho_Chi_Minh'),'2026-11-01');
 assert.equal(periods.payrollLocalDate(new Date('2026-11-01T00:00:00Z'),'America/Los_Angeles'),'2026-10-31');
});
