import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(path, overrides = {}) {
  const exports = {};
  const localRequire = name => {
    if (name in overrides) return overrides[name];
    if (name === './staff-pay-period-picker') return load('app/staff/my-work/staff-pay-period-picker.tsx');
    if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
    if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => require('react').createElement('a', props, children) };
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name.startsWith('@/lib/')) return load(name.replace('@/', '') + '.ts');
    return require(name);
  };
  new Function('exports', 'require', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)(exports, localRequire);
  return exports;
}
const { staffPeriodAt, staffPeriodHistory, staffComparisonPeriods } = load('lib/staff-payroll-period.ts');
const { staffPayRules } = load('lib/staff-payroll-display.ts');
test('owner semi-monthly periods follow the day, including leap/month/year boundaries', () => {
  const setting = { cycle_type: 'semi_monthly' };
  for (const [day, start, end] of [['2026-09-15','2026-09-01','2026-09-15'], ['2026-09-16','2026-09-16','2026-09-30'], ['2028-02-29','2028-02-16','2028-02-29']]) {
    const period = staffPeriodAt(setting, day); assert.equal(period.startDate,start); assert.equal(period.endDate,end);
  }
  const history = staffPeriodHistory(setting,'2026-01-01');
  assert.equal(history[1].startDate,'2025-12-16'); assert.equal(history[1].endDate,'2025-12-31');
});
test('monthly and actual 14-day schedules stay distinct', () => {
  assert.equal(staffPeriodAt({cycle_type:'monthly'},'2026-02-20').endDate,'2026-02-28');
  const setting={cycle_type:'biweekly',biweekly_anchor_date:'2026-09-04'};
  const period=staffPeriodAt(setting,'2026-09-25');
  assert.equal(period.startDate,'2026-09-18'); assert.equal(period.endDate,'2026-10-01');
  assert.equal(staffPeriodAt(setting,'2026-09-01').startDate,'2026-08-21');
  assert.throws(()=>staffPeriodAt({cycle_type:'biweekly'},'2026-09-25'),/start date/);
});
test('analysis compares equal elapsed windows inside real owner periods',()=>{
  const setting={cycle_type:'semi_monthly'};
  const periods=staffComparisonPeriods(setting,staffPeriodAt(setting,'2026-09-24'),'2026-09-24');
  assert.equal(periods.current.endDate,'2026-09-24'); assert.equal(periods.previous.startDate,'2026-09-01'); assert.equal(periods.previous.endDate,'2026-09-09');
  const monthly={cycle_type:'monthly'};
  const feb=staffComparisonPeriods(monthly,staffPeriodAt(monthly,'2026-03-31'),'2026-03-31');
  assert.equal(feb.previous.startDate,'2026-02-01'); assert.equal(feb.current.endDate,'2026-03-28');
});
test('staff rules use saved rates and tax flags, preserve mid-period changes',()=>{
  const snapshot={payType:'commission',commissionRate:60,taxRate:20,taxTips:false,taxBonus:true,effectiveFrom:'2026-09-01'};
  const line={settings_used_snapshot:[snapshot,snapshot,{...snapshot,commissionRate:50,taxTips:true,effectiveFrom:'2026-09-20'}]};
  const rules=staffPayRules(line,[{commission_rate:90}]);
  assert.equal(rules.length,2); assert.equal(rules[0].commission,60); assert.equal(rules[1].commission,50);
  assert.equal(rules[0].tipsTax,false); assert.equal(rules[1].tipsTax,true); assert.equal(rules[0].bonusTax,true);
});
const React=require('react');
test('each staff uses its own owner settings when payroll has no entries',()=>{
  const base={pay_type:'commission',commission_rate:50,tax_rate:20,tax_tips:true,tax_bonus:false,effective_from:'2026-09-01',effective_to:null};
  const first=staffPayRules(null,[base])[0];
  const second=staffPayRules(null,[{...base,commission_rate:60,tax_tips:false,tax_bonus:true}])[0];
  assert.equal(first.commission,50); assert.equal(first.tipsTax,true); assert.equal(first.bonusTax,false);
  assert.equal(second.commission,60); assert.equal(second.tipsTax,false); assert.equal(second.bonusTax,true);
});
const {renderToStaticMarkup}=require('react-dom/server');
const {StaffMyPay}=load('app/staff/my-work/staff-pay-analysis.tsx');
test('My Pay renders final payouts, daily tip and total, individual settings without cash percent',()=>{
  const data={period:staffPeriodAt({cycle_type:'semi_monthly'},'2026-09-25'),periodOptions:[],settings:[],status:{kind:'live',label:'In progress'},latestStatement:null,paystub:null,
    line:{final_staff_income:125,final_cash_amount:75,final_check_amount:50,base_cash_amount:40,check_net:40,gross_sales:200,staff_commission_gross:120,tip_amount:5,bonus_amount:0,tax_withheld:0,
      settings_used_snapshot:[{payType:'commission',commissionRate:60,taxRate:20,taxTips:false,taxBonus:true}]},
    dailyRows:[{id:'one',businessDate:'2026-09-24',commissionGross:60,tipAmount:5},{id:'two',businessDate:'2026-09-25',commissionGross:60,tipAmount:0}]};
  const html=renderToStaticMarkup(React.createElement(StaffMyPay,{data}));
  for(const value of ['Commission 60%','Tax ','20','Tip · ','No tax','Bonus · ','$75.00','$50.00','$65.00','$60.00','<tfoot>']) assert.ok(html.includes(value),value);
  assert.ok(!html.includes('Cash %')); assert.ok(!html.includes('$40.00')); assert.ok(!html.includes('Custom range'));
});

test('published history preserves old cycles, same-start different ends and deduplicates revisions',()=>{
  const {staffPublishedPeriodHistory,staffPeriodKey}=load('lib/staff-payroll-period.ts');
  const current=staffPeriodAt({cycle_type:'semi_monthly'},'2026-09-25');
  const runs=[{period_start:'2026-08-01',period_end:'2026-08-31',cycle_type:'monthly'},
    {period_start:'2026-08-01',period_end:'2026-08-15',cycle_type:'semi_monthly'},
    {period_start:'2026-08-01',period_end:'2026-08-31',cycle_type:'monthly'},
    {period_start:'2024-01-01',period_end:'2024-01-31',cycle_type:'monthly'}];
  const periods=staffPublishedPeriodHistory(current,runs);
  assert.equal(periods.length,4); assert.equal(periods[0],current);
  assert.equal(new Set(periods.map(staffPeriodKey)).size,4);
  assert.equal(periods[1].cycleType,'monthly'); assert.equal(periods[3].startDate,'2024-01-01');
});

test('paystub cleanup skips external links and survives storage failure',async()=>{
  const {cleanupPaystubFile}=load('lib/paystub-files.ts'); const removed=[];
  const remove=async path=>{removed.push(path);return {error:null};};
  await cleanupPaystubFile(null,remove); await cleanupPaystubFile('https://example.test/file.pdf',remove);
  await cleanupPaystubFile('account/salon/run/staff/old.pdf',remove);
  assert.deepEqual(removed,['account/salon/run/staff/old.pdf']);
  await assert.doesNotReject(()=>cleanupPaystubFile('unused.pdf',async()=>{throw Error('offline');}));
});

test('My Pay defaults to previous period until five days remain; unprinted periods stay selectable',()=>{
 const {staffPayPeriodChoices}=load('lib/staff-payroll-period.ts');
 for(const [cycle,day,start] of [
 ['monthly','2026-10-01','2026-09-01'],['monthly','2026-10-25','2026-09-01'],['monthly','2026-10-26','2026-10-01'],
 ['semi_monthly','2026-10-01','2026-09-16'],['semi_monthly','2026-10-09','2026-09-16'],['semi_monthly','2026-10-10','2026-10-01'],
 ['semi_monthly','2026-10-16','2026-10-01'],['semi_monthly','2026-10-26','2026-10-16'],
 ['monthly','2027-01-01','2026-12-01'],['monthly','2028-02-24','2028-02-01']]) {
 const result=staffPayPeriodChoices({cycle_type:cycle},day,[]);
 assert.equal(result.defaultPeriod.startDate,start,day+cycle);
 assert.ok(result.periods.some(p=>p.startDate===start));
 assert.ok(result.periods.every(p=>p.startDate<=day));
 }
 const old={period_start:'2024-09-01',period_end:'2024-09-30',cycle_type:'monthly'};
 const history=staffPayPeriodChoices({cycle_type:'semi_monthly'},'2026-10-01',[old]);
 assert.ok(history.periods.some(p=>p.startDate===old.period_start));
 assert.ok(history.periods.some(p=>p.startDate==='2026-09-16'));
});

test('My Pay picker renders month and distinct periods for mobile native selection',()=>{
 const {StaffPayPeriodPicker}=load('app/staff/my-work/staff-pay-period-picker.tsx');
 const options=[{startDate:'2026-09-01',endDate:'2026-09-15',label:'Sep 1–15',value:'2026-09-01:2026-09-15'},
 {startDate:'2026-09-16',endDate:'2026-09-30',label:'Sep 16–30',value:'2026-09-16:2026-09-30'}];
 const html=renderToStaticMarkup(React.createElement(StaffPayPeriodPicker,{options,selected:options[1].value}));
 assert.ok(html.includes('Pay month'));assert.ok(html.includes('Pay period'));assert.ok(html.includes('September 2026'));
 assert.match(html,/value="2026-09-16:2026-09-30" selected/);
 const monthly=renderToStaticMarkup(React.createElement(StaffPayPeriodPicker,{options:[options[0]],selected:options[0].value}));
 assert.ok(!monthly.includes('aria-label="Pay period"'));
});

test('Analysis period selection stays on Analysis and preserves the exact date range',()=>{
 const navigated=[];
 const {StaffPayPeriodPicker}=load('app/staff/my-work/staff-pay-period-picker.tsx',{
  'react':{useTransition:()=>[false,fn=>fn()]},
  'next/navigation':{useRouter:()=>({push:(url)=>navigated.push(url)})},
 });
 const options=[{startDate:'2026-10-01',endDate:'2026-10-31',label:'October',value:'2026-10-01:2026-10-31'},
 {startDate:'2026-09-01',endDate:'2026-09-30',label:'September',value:'2026-09-01:2026-09-30'}];
 const tree=StaffPayPeriodPicker({options,selected:options[0].value,tab:'analysis'});
 const select=tree.props.children[0].props.children[1];
 select.props.onChange({target:{value:'2026-09'}});
 assert.deepEqual(navigated,['/staff/my-work?tab=analysis&payPeriodStart=2026-09-01%3A2026-09-30']);
});
