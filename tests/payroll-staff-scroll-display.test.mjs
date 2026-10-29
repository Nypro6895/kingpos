import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({stdin:{contents:`export {staffTakeHomeDisplay,staffCompactSettings} from './lib/staff-payroll-display';export {payrollRailChoices,payrollPeriodHref} from './lib/payroll-period-rail';`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs'});
const module={exports:{}};new Function('module','exports',bundled.outputFiles[0].text)(module,module.exports);
const {staffTakeHomeDisplay,staffCompactSettings,payrollRailChoices,payrollPeriodHref}=module.exports;
const line={final_cash_amount:202.81,final_check_amount:290.82,tip_cash_amount:8.92,tip_check_amount:0,final_staff_income:493.63,is_mixed_rate:false,pay_type_used:'commission',commission_rate_used:60,check_rate_used:60,tax_rate_used:20,tip_payout_method_snapshot:'cash',settings_used_snapshot:[]};
test('separates cash tip exactly once and preserves canonical net',()=>{
  const out=staffTakeHomeDisplay(line);assert.deepEqual(out,{cash:193.89,check:290.82,tip:8.92,net:493.63});
  assert.equal(Math.round((out.cash+out.check+out.tip)*100),Math.round(out.net*100));
});
test('taxed tips split over both payout methods retain net tips, bonus and negative checks',()=>{
  const input={...line,final_cash_amount:210.15,final_check_amount:-10.08,tip_cash_amount:8.92,tip_check_amount:6.14,final_staff_income:200.07};
  const out=staffTakeHomeDisplay(input);assert.deepEqual(out,{cash:201.23,check:-16.22,tip:15.06,net:200.07});
  assert.equal(Math.round((out.cash+out.check+out.tip)*100),20007);
  assert.deepEqual(input.final_check_amount,-10.08);
});
test('settings use historical snapshots including mixed cash/tip settings',()=>{
  const settings=staffCompactSettings({...line,is_mixed_rate:true,commission_rate_used:0,settings_used_snapshot:[{payType:'commission',commissionRate:60,checkRate:60,taxRate:20,tipPayoutMethod:'cash'},{payType:'commission',commissionRate:65,checkRate:50,taxRate:15,tipPayoutMethod:'check'}]});
  assert.deepEqual(settings.pay,['60%','65%']);assert.deepEqual(settings.cash,['40%','50%']);assert.deepEqual(settings.tax,['20%','15%']);assert.deepEqual(settings.tip,['Cash','Check']);
  assert.deepEqual(staffCompactSettings({...line,is_mixed_rate:true}).cash,['Mixed']);
});
const setting={cycle_type:'semi_monthly',biweekly_anchor_date:null};
const selected={cycleType:'semi_monthly',preset:'semi_monthly_second',startDate:'2028-02-16',endDate:'2028-02-29',label:'February'};
test('rails follow leap-year calendar boundaries and preserve selected tab',()=>{
  const out=payrollRailChoices(selected,setting);const feb=out.months.find(x=>x.period.startDate==='2028-02-01');assert.equal(feb.period.endDate,'2028-02-29');
  const active=out.periods.find(x=>x.period.startDate===selected.startDate);assert.equal(active.period.endDate,'2028-02-29');
  assert.equal(new URL(payrollPeriodHref(active.period,'analytics'),'http://fixture').searchParams.get('segment'),'second');
  const q=new URL(payrollPeriodHref(feb.period,'shop'),'http://fixture').searchParams;assert.equal(q.get('tab'),'shop');assert.equal(q.get('preset'),'custom');assert.equal(q.get('end'),'2028-02-29');
});
test('biweekly rail honors anchor across year and month boundaries',()=>{
  const out=payrollRailChoices({...selected,startDate:'2026-12-28',endDate:'2027-01-10',cycleType:'biweekly'},{cycle_type:'biweekly',biweekly_anchor_date:'2026-10-05'});
  for(const {period} of out.periods){assert.equal((Date.parse(period.endDate)-Date.parse(period.startDate))/86400000,13);assert.equal(Math.abs((Date.parse(period.startDate)-Date.parse('2026-10-05'))/86400000%14),0);}
  assert(out.periods.some(x=>x.period.startDate==='2026-12-28'&&x.period.endDate==='2027-01-10'));
});
test('monthly schedule shows only months; missing biweekly anchor cannot invent periods',()=>{
  assert.equal(payrollRailChoices(selected,{cycle_type:'monthly'}).periods.length,0);
  assert.equal(payrollRailChoices(selected,{cycle_type:'biweekly',biweekly_anchor_date:null}).periods.length,0);
});
