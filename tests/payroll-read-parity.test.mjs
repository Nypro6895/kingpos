import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';

const baseline = 'cd3885f09abd07ad1251bbe0d298d246de74602e';
const original = execFileSync('git', ['show', baseline + ':lib/payroll.ts'], {encoding:'utf8'});
const current = readFileSync('lib/payroll.ts','utf8');
const now='2026-10-16T12:00:00.000Z';
const asJSON=value=>JSON.parse(JSON.stringify(value));
function helper(file) {
  const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,require:name=>{if(name==='@/lib/payroll-money')return helper('lib/payroll-money.ts');throw Error('Unexpected helper import '+name)}});return exports;
}

// Replace I/O at its boundary; execute the original period resolution, daily
// calculations, corrections, summaries and statement comparison unchanged.
function fixture(source, limited=false) {
  const auth={Account:{id:'account-a'},salon:{id:'salon-a'},context:{scope:'scope-a'},access:{canViewAllPayroll:!limited,canViewTaxCompany:false,linkedStaffId:limited?'a':null}};
  const data={
    staff:[{id:'a',display_name:'Anna',is_active:true},{id:'b',display_name:'Binh',is_active:true}],
    settings:[{id:'setting-a',staff_id:'a',salon_id:'salon-a',pay_type:'commission',commission_rate:60,check_rate:50,tax_rate:10,tip_payout_method:'check',bonus_payout_method:'cash',tax_bonus:true,tax_tips:true,cash_to_tax_company:false,effective_from:'2020-01-01',effective_to:null},{id:'setting-b',staff_id:'b',salon_id:'salon-a',pay_type:'fixed',fixed_pay_amount:300,check_rate:100,tax_rate:12,apply_tax_to_fixed_pay:true,tip_payout_method:'cash',bonus_payout_method:'check',tax_bonus:false,tax_tips:false,cash_to_tax_company:true,effective_from:'2020-01-01',effective_to:null}],
    earnings:[{staff_id:'a',work_date:'2026-10-12',service_total:100,tip_amount:20,tip_is_manual:true},{staff_id:'a',work_date:'2026-10-13',service_total:200.55,tip_amount:35.25},{staff_id:'b',work_date:'2026-10-12',service_total:75,tip_amount:10}],
    inputs:[{staff_id:'a',bonus_amount:25.5,check_number:'1001',period_start:'2026-10-12',period_end:'2026-10-18'},{staff_id:'b',bonus_amount:15,check_number:'1002',period_start:'2026-10-12',period_end:'2026-10-18'}],
  };
  const calls={};const rows=key=>limited?data[key].filter(r=>(r.staff_id??r.id)==='a'):data[key];
  const bindings={
    requirePayrollContext:()=>auth,
    loadSalonPayrollSetting:()=>({cycle_type:'monthly',biweekly_anchor_date:null,salon_id:'salon-a'}),
    loadStaffRows:()=>rows('staff'),loadStaffPayrollSettings:()=>rows('settings'),
    loadStaffEarningsForPeriod:()=>rows('earnings'),loadFinancialAdjustmentDeltasByStaffDate:()=>new Map([['a:2026-10-13',-10]]),
    loadPayrollPeriodStaffInputs:()=>rows('inputs'),loadPayrollPeriodStaffInputHistory:()=>[],
    loadPayrollCorrections:()=>[],loadDailyClosingRows:()=>[],loadLatestPayrollSnapshot:()=>null,
    loadPayrollServiceAnalytics:()=>({rows:[],staff:[]}),
    getSalonBusinessTimezone:()=> 'America/Chicago',loadPeriodLedger:()=>({state:'open'}),
  };
  const ast=ts.createSourceFile('payroll.ts',source,ts.ScriptTarget.Latest,true);
  const chunks=ast.statements.map(node=>{
    if(ts.isImportDeclaration(node))return '';
    if(ts.isFunctionDeclaration(node)&&node.name?.text in bindings)return `async function ${node.name.text}(...args){return await IO.${node.name.text}(...args)}`;
    return node.getText(ast);
  });
  const exports={},IO=Object.fromEntries(Object.entries(bindings).map(([name,fn])=>[name,async(...args)=>{calls[name]=(calls[name]??0)+1;return fn(...args)}]));
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return Date.parse(now)}}
  vm.runInNewContext(ts.transpileModule(chunks.join('\n'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,IO,Date:FixedDate,Map,Set,console,getSalonBusinessTimezone:bindings.getSalonBusinessTimezone,
    isDateInputValue:value=>/^\d{4}-\d{2}-\d{2}$/.test(value??''),
    getStaffPresentationsByStaffId:async()=>new Map(),
    ...helper('lib/payroll-tax-company.ts'),...helper('lib/payroll-tax-report-source.ts'),...helper('lib/payroll-period-boundary.ts'),...helper('lib/payroll-money.ts'),...helper('lib/payroll-ledger.ts'),
  });
  return {api:exports,calls};
}
for(const limited of [false,true])test(`parallel payroll reads preserve commission totals, permissions and ledger fixed-pay reconciliation (${limited?'staff':'owner'})`,async()=>{
  const before=fixture(original,limited),after=fixture(current,limited);
  const input={preset:'current_month',includeAnalytics:true};
  const [a,b]=await Promise.all([before.api.getPayrollPageData(input),after.api.getPayrollPageData(input)]);
  assert.equal(b.ledger.state,'open');assert.equal(b.live.lines.length,limited?1:2);assert.ok(b.live.summary);
  for(const key of ['access','context','period','latestStatement','staffPayrollSettings','taxCompany','serviceAnalytics'])assert.deepEqual(asJSON(b[key]),asJSON(a[key]),key);
  const commission=b.live.lines.find(line=>line.staff_id==='a'),oldCommission=a.live.lines.find(line=>line.staff_id==='a');
  for(const key of ['gross_sales','staff_commission_gross','tip_amount','bonus_amount','tax_withheld','final_cash_amount','final_check_amount','final_staff_income'])assert.equal(commission[key],oldCommission[key],key);
  // The ledger change intentionally allocates fixed monthly pay to exact cents
  // and includes period bonus in daily income; the earlier baseline rounded
  // every day independently and omitted that bonus from daily shop totals.
  for(const line of b.live.lines){assert.equal(Math.round(line.dailyIncome.reduce((sum,row)=>sum+row.final_staff_income,0)*100),Math.round(line.final_staff_income*100));}
  if(!limited){const fixed=b.live.lines.find(line=>line.staff_id==='b');assert.equal(fixed.check_gross,300);assert.equal(fixed.dailyIncome.reduce((sum,row)=>sum+Math.round(row.fixed_pay_amount_used*100),0),30000);}
  assert.equal(after.calls.loadStaffRows,1);assert.equal(after.calls.loadStaffPayrollSettings,1);
  assert.equal(before.calls.loadStaffRows,limited?1:2);assert.equal(before.calls.loadStaffPayrollSettings,limited?1:2);
  assert.equal(after.calls.requirePayrollContext,1);
});

test('presentation filters share a payroll read; period and analytics/tax requirements remain separate',()=>{
  const {payrollReadArgs}=helper('lib/payroll-read-args.ts');
  assert.deepEqual(asJSON(payrollReadArgs('/payroll?tab=overview&preset=current_month&overviewStaff=a&overviewTrend=weekly')),asJSON(payrollReadArgs('/payroll?preset=current_month')));
  assert.deepEqual(asJSON(payrollReadArgs('/payroll?tab=staff&editStaff=a')),asJSON(payrollReadArgs('/payroll?tab=shop')));
  assert.notDeepEqual(asJSON(payrollReadArgs('/payroll?tab=tax')),asJSON(payrollReadArgs('/payroll?tab=staff')));
  assert.notDeepEqual(asJSON(payrollReadArgs('/payroll?start=2026-10-01')),asJSON(payrollReadArgs('/payroll?start=2026-10-12')));
});
