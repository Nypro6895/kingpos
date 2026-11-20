import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['lib/payroll-payment-comparison.ts'],bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);
const {comparePayrollPayments}=module.exports;
const period={startDate:'2026-10-01',endDate:'2026-10-15'};
const payment=(id,cash=0,check=0,staff_id='anna')=>({id,staff_id,cash_amount:cash,check_amount:check,paid_at:'2026-10-16T15:00:00Z'});
const facts=(payments=[],overrides={})=>({status:'available',selection:{start:period.startDate,end:period.endDate,exact:true},periods:[{sourcePeriod:{start:period.startDate,end:period.endDate,cycle:'semimonthly'},base:null,revision:4,adjustments:[],payments,legacyPaidHistory:[]}],...overrides});
const compare=(source,currentIncome=700)=>comparePayrollPayments({facts:source,staffId:'anna',currentIncome,period});
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('past input changes preserve recorded payments and show increased debt or overpayment against the original period',()=>{
 const source=freeze(facts([payment('original',200,400)]));
 const increased=compare(source,750);assert.equal(increased.state,'known');assert.equal(increased.currentIncome,750);assert.equal(increased.recordedPaid,600);assert.equal(increased.balance,150);assert.deepEqual(increased.sourcePeriod,{start:period.startDate,end:period.endDate});
 const decreased=compare(source,550);assert.equal(decreased.recordedPaid,600);assert.equal(decreased.balance,-50);assert.equal(decreased.revision,4);
});
test('supplemental payment reduces the same original-period balance once and excludes other Staff payments',()=>{
 const source=facts([payment('original',200,400),payment('supplement',0,100),payment('someone-else',9000,9000,'lily')]);
 const result=compare(source);assert.equal(result.state,'known');assert.equal(result.recordedPaid,700);assert.equal(result.cashPaid,200);assert.equal(result.checkPaid,500);assert.equal(result.balance,0);
});
test('repeated identical payment identity does not pay twice; conflicting identity leaves the balance unknown',()=>{
 const original=payment('receipt',200,400),retry=structuredClone(original);
 const duplicate=compare(facts([original,retry]));assert.equal(duplicate.recordedPaid,600);assert.equal(duplicate.balance,100);
 const conflict=compare(facts([original,{...retry,check_amount:450}]));assert.equal(conflict.state,'unknown');assert.equal(conflict.recordedPaid,undefined);assert.equal(conflict.balance,undefined);
});
test('a paid flag or an obligation adjustment is not evidence that money was actually paid',()=>{
 const source=facts();source.periods[0].legacyPaidHistory=[{staff_id:'anna',status:'paid',paid_at:'2026-10-16T15:00:00Z',final_cash_amount:200,final_check_amount:400}];source.periods[0].adjustments=[{staff_id:'anna',cash_delta:200,check_delta:400}];
 const result=compare(source);assert.equal(result.state,'known');assert.equal(result.recordedPaid,0);assert.equal(result.balance,700);
});
test('partial selections, missing original periods and ambiguous original-period coverage do not infer a balance',()=>{
 const partial=facts([payment('original',600)],{selection:{start:'2026-10-03',end:period.endDate,exact:false}});assert.equal(compare(partial).state,'unknown');
 const missing=facts();missing.periods[0].sourcePeriod.end='2026-10-14';assert.equal(compare(missing).state,'unknown');
 const ambiguous=facts();ambiguous.periods.push(structuredClone(ambiguous.periods[0]));assert.equal(compare(ambiguous).state,'unknown');
 const noSelection=facts();delete noSelection.selection;assert.equal(compare(noSelection).state,'unknown');
});
test('unavailable actual-payment facts and malformed amounts stay unknown, never a manufactured zero payment',()=>{
 const unavailable=compare({status:'unavailable',message:'Read failed'});assert.equal(unavailable.state,'unknown');assert.equal(unavailable.recordedPaid,undefined);
 const malformed=compare(facts([payment('broken',Number.NaN,400)]));assert.equal(malformed.state,'unknown');assert.equal(malformed.balance,undefined);
});
test('legacy bases identify the original period without replacing actual payment evidence',()=>{
 const source=facts([payment('legacy-actual',100,500)]);delete source.periods[0].sourcePeriod;source.periods[0].base={periodStart:period.startDate,periodEnd:period.endDate,staff:[{staff_id:'anna',final_cash_amount:9999,final_check_amount:9999}]};
 const result=compare(source);assert.equal(result.state,'known');assert.equal(result.recordedPaid,600);assert.equal(result.balance,100);
});
test('cent arithmetic and immutable facts remain unchanged across repeated comparisons',()=>{
 const source=freeze(facts([payment('cash',0.1),payment('check',0,0.2)])),before=JSON.stringify(source);
 const a=compare(source,0.3),b=compare(source,0.3);assert.equal(a.recordedPaid,0.3);assert.equal(a.balance,0);assert.deepEqual(a,b);assert.equal(JSON.stringify(source),before);
});
test('overlapping old full-month Staff payments are not silently assigned to a newly selected half-month period',()=>{
 const source=facts();source.periods.push({sourcePeriod:{start:'2026-10-01',end:'2026-10-31',cycle:'monthly'},base:null,revision:1,adjustments:[],payments:[payment('old-month',600)],legacyPaidHistory:[]});
 const conflicting=compare(source);assert.equal(conflicting.state,'unknown');assert.equal(conflicting.balance,undefined);
 source.periods[1].payments=[payment('other-staff-month',600,0,'lily')];const other=compare(source);assert.equal(other.state,'known');assert.equal(other.recordedPaid,0);
});
