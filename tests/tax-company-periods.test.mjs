import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['lib/tax-company-periods.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()}});
const {taxCompanyPeriods} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const setting = cycle_type => ({cycle_type,biweekly_anchor_date:'2026-09-04'});
const run = (id,start,end,version=1) => ({id,period_start:start,period_end:end,version,status:'printed',cycle_type:'monthly'});

test('monthly periods respect leap-year month ends and reject arbitrary ranges',()=>{
 const result=taxCompanyPeriods(setting('monthly'),[],'2028-02-10');
 assert.equal(result.period.value,'2028-02-01:2028-02-29');
 assert.equal(result.run,null);
 assert.equal(result.periodOptions.filter(p=>p.startDate.startsWith('2028-02')).length,1);
 assert.throws(()=>taxCompanyPeriods(setting('monthly'),[],'2028-02-10','2028-02-02:2028-02-05'),/salon’s schedule/);
});
test('twice monthly offers both halves, even early in the current month',()=>{
 const first=taxCompanyPeriods(setting('semi_monthly'),[],'2026-10-10');
 assert.equal(first.period.value,'2026-10-01:2026-10-15');
 assert.deepEqual(first.periodOptions.filter(p=>p.startDate.startsWith('2026-10')).map(p=>p.value),['2026-10-16:2026-10-31','2026-10-01:2026-10-15']);
 assert.equal(taxCompanyPeriods(setting('semi_monthly'),[],'2026-10-20').period.value,'2026-10-16:2026-10-31');
});
test('latest published version opens by default; empty periods do not reuse another statement',()=>{
 const runs=[run('old','2026-09-01','2026-09-30',1),run('latest','2026-09-01','2026-09-30',3)];
 assert.equal(taxCompanyPeriods(setting('monthly'),runs,'2026-10-10').run.id,'latest');
 assert.equal(taxCompanyPeriods(setting('monthly'),runs,'2026-10-10','2026-10-01:2026-10-31').run,null);
 assert.equal(taxCompanyPeriods(setting('monthly'),runs,'2026-10-10',undefined,'old').run.id,'old');
 assert.throws(()=>taxCompanyPeriods(setting('monthly'),runs,'2026-10-10',undefined,'another-salon-run'),/unavailable/);
});
test('schedule changes keep historical statements without changing the current schedule',()=>{
 const result=taxCompanyPeriods(setting('semi_monthly'),[run('legacy','2026-09-01','2026-09-30')],'2026-10-10');
 assert.equal(result.period.value,'2026-10-01:2026-10-15');
 assert.equal(result.periodOptions.find(p=>p.value==='2026-09-01:2026-09-30').historical,true);
 assert.equal(taxCompanyPeriods(setting('semi_monthly'),[run('legacy','2026-09-01','2026-09-30')],'2026-10-10','2026-09-01:2026-09-30').run.id,'legacy');
});
test('existing biweekly salon schedules still use the salon anchor',()=>{
 assert.equal(taxCompanyPeriods(setting('biweekly'),[],'2026-10-10').period.value,'2026-10-02:2026-10-15');
});
