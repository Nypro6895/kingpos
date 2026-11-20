import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function fixture({denied=false}={}) {
  const ast=ts.createSourceFile('payroll.ts',fs.readFileSync('lib/payroll.ts','utf8'),ts.ScriptTarget.Latest,true);
  const names=['loadStaffPortalPeriod','getCurrentStaffPayrollPortalData'];
  const source=ast.statements.filter(s=>ts.isFunctionDeclaration(s)&&names.includes(s.name?.text)).map(s=>s.getText(ast)).join('\n');
  const calls=[];const pending=[];
  const delayed=(name,value)=>{calls.push(name);return new Promise(resolve=>pending.push(()=>resolve(value)));};
  const period={startDate:'2026-10-01',endDate:'2026-10-31'};
  const run={period_start:period.startDate,period_end:period.endDate,status:'paid',id:'run',version:3,paid_at:'2026-10-28'};
  const auth={salon:{id:'salon'},supabase:{rpc:name=>delayed(name,name==='get_my_staff_payroll_runs'?{data:[run]}:{data:'2026-10-28'})}};
  const setting={id:'fresh-setting'};const staff={id:'staff'};
  const facts=[{amount:250}], history=[{id:'history'}], paystub={id:'stub'};
  const deps={getCurrentStaffPayrollPortalAuthContext:async()=>({auth:denied?null:auth,context:{},staff:denied?null:staff}),loadSalonPayrollSetting:()=>delayed('salon-setting',setting),loadStaffPayrollSettings:()=>delayed('staff-settings',[]),isDateInputValue:()=>true,staffPeriodHistory:()=>[period],staffPayPeriodChoices:()=>({periods:[period],options:[]}),staffPeriodKey:()=>period.startDate,staffPeriodOption:p=>p,calculateLivePayrollForAuth:(_,__,seed)=>{assert.equal(seed.salonSetting,setting);assert.deepEqual(seed.staffRows,[staff]);return delayed('live',{lines:[{staff_id:'staff',dailyTotals:[{business_date:'2026-10-28',gross_sales:100,tip_amount:5,id:'day'}]}]});},loadPayrollPaystubs:()=>delayed('paystub',[paystub]),loadPayrollLiveHistory:()=>delayed('history',history),loadPayrollRecordedFacts:()=>delayed('facts',facts),dailyStaffPay:()=>45,numberValue:Number};
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports={};new Function('exports',...Object.keys(deps),code)(exports,...Object.values(deps));
  return {read:exports.getCurrentStaffPayrollPortalData,calls,release:()=>{for(const f of pending.splice(0))f();},facts,history,paystub};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('fresh staff payroll overlaps independent reads and preserves paid evidence',async()=>{
  const f=fixture();const work=f.read({});await tick();
  assert.deepEqual(new Set(f.calls),new Set(['get_my_staff_payroll_runs','salon-setting','get_salon_business_date','staff-settings']));
  f.release();await tick();assert.deepEqual(f.calls.slice(-4),['live','paystub','history','facts']);
  f.release();const dto=await work;
  assert.equal(dto.paystub,f.paystub);assert.equal(dto.history,f.history);assert.equal(dto.paymentEvidence.recordedFacts,f.facts);
  assert.deepEqual(dto.paymentEvidence.markedPaidStatements,[{runId:'run',version:3,paidAt:'2026-10-28'}]);
  assert.equal(dto.dailyRows[0].commissionGross,45);assert.equal(dto.dailyRows[0].shopGross,100);assert.equal(dto.dailyRows[0].tipAmount,5);
});
test('missing staff authority starts no payroll read',async()=>{const f=fixture({denied:true});const out=await f.read({});assert.equal(out.staff,null);assert.deepEqual(f.calls,[]);});
