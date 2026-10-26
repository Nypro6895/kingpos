import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';

const root=process.cwd();
const external={
  'server-only':'',
  '@/lib/current-context':'export const getCurrentBusinessContext=()=>{throw Error("No live context in tests")}; export const isSalonManageContext=()=>true;export const isOwnerMembership=()=>true;',
  '@/lib/salon-business-clock':'export const getSalonBusinessTimezone=async()=>"America/Chicago";',
  '@/lib/daily-pos-report':'export const getUtcBoundsForLocalDate=()=>({openedFrom:"",openedTo:""});export const isDateInputValue=v=>/^\\d{4}-\\d{2}-\\d{2}$/.test(v);export const loadPayrollReportExpected=async()=>new Map();',
  '@/lib/permissions':'export const hasPermission=async()=>true;',
  '@/lib/staff':'export const STAFF_SELECT="*";',
  '@/lib/paystub-files':'export const cleanupPaystubFile=()=>{};',
  '@/lib/staff-portal-identity':'export const getStaffPortalIdentity=()=>{throw Error("Unexpected identity lookup")};',
  '@/lib/staff-profile':'export const getStaffPresentationsByStaffId=async()=>new Map();',
  '@/lib/staff-account':'export const CURRENT_STAFF_MULTIPLE_MATCHES_MESSAGE="Multiple";export const resolveStaffAccountForSalon=()=>null;',
  '@/lib/supabase/server':'export const createAuthenticatedSupabaseServerClient=()=>{throw Error("No production access")};',
  '@/lib/payroll-live-history':'export const loadPayrollLiveHistory=async()=>[];',
};
const compiled=await build({stdin:{contents:`export * from './lib/payroll-live-dashboard';export * from './lib/payroll-live-money';export * from './lib/payroll-live-projection';export * from './lib/payroll-period-navigation';export {calculateDailyPayroll,buildShopDailyRows,buildShopSummary,calculateLivePayrollForAuth} from './lib/payroll';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'@':root},plugins:[{name:'isolated',setup(b){
  b.onResolve({filter:/.*/},args=>Object.hasOwn(external,args.path)?{path:args.path,namespace:'isolated'}:undefined);
  b.onLoad({filter:/.*/,namespace:'isolated'},args=>({contents:external[args.path],loader:'ts'}));
  b.onLoad({filter:/[\\/]lib[\\/]payroll\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replaceAll('function calculateDailyPayroll(','export function calculateDailyPayroll(').replaceAll('function buildShopDailyRows(','export function buildShopDailyRows(').replaceAll('function buildShopSummary(','export function buildShopSummary(').replaceAll('async function calculateLivePayrollForAuth(','export async function calculateLivePayrollForAuth('),loader:'ts',resolveDir:path.dirname(args.path)}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const line={final_cash_amount:6000,final_check_amount:8000,tax_withheld:1000,final_staff_income:14000};
const report=(date,actual,pos)=>({businessDate:date,actualIncome:actual,posIncome:pos,difference:actual===null?null:actual-pos,cashAmount:actual===null?null:actual,creditCardAmount:actual===null?null:0,otherAmount:actual===null?null:0});

test('Daily Report totals, cash/check/tax and remaining exactly match approved example',()=>{
  const data=api.payrollLiveDashboard([line],[report('2026-10-12',24000,24050)],'2026-10-25');
  assert.equal(data.collected,24000);assert.equal(data.staffCost,15000);assert.equal(data.remaining,9000);assert.equal(data.difference,-50);
});
test('offsetting over/short reports stay visible; missing and future reports are separate',()=>{
  const data=api.payrollLiveDashboard([],[report('2026-10-12',90,100),report('2026-10-13',110,100),report('2026-10-14',null,100),report('2026-10-26',null,0)],'2026-10-25');
  assert.equal(data.differences.length,2);assert.equal(data.difference,0);assert.equal(data.shortDays,1);assert.equal(data.overDays,1);assert.equal(data.missing.length,1);assert.equal(data.enteredDays,2);
});
test('no report remains unknown, an explicitly entered zero remains a real zero',()=>{
  assert.equal(api.payrollLiveDashboard([line],[report('2026-10-12',null,0)],'2026-10-25').remaining,null);
  assert.equal(api.payrollLiveDashboard([line],[report('2026-10-12',0,0)],'2026-10-25').remaining,-15000);
});
test('Shop totals include all staff cost even when one Daily Report is missing',()=>{
  const rows=[{...report('2026-10-12',100,100),staffObligation:100,staffNetPay:100,tipsPaid:0,taxWithheld:0,shopNetIncome:0,corrections:[]},{...report('2026-10-13',null,100),staffObligation:100,staffNetPay:100,tipsPaid:0,taxWithheld:0,shopNetIncome:null,corrections:[]}];
  const summary=api.buildShopSummary(rows);
  assert.equal(summary.totalActualIncome,100);assert.equal(summary.shopNetIncome,-100);
  const dashboard=api.payrollLiveDashboard([{final_cash_amount:200,final_check_amount:0,tax_withheld:0}],rows,'2026-10-25');assert.equal(dashboard.remaining,summary.shopNetIncome);
});
test('cent allocations conserve positive and negative fixed pay for every month length',()=>{
  for(const days of [14,15,16,28,29,30,31])for(const amount of [1000,1500.01,-10.01,0.01])assert.equal(api.moneyCents(api.sumMoney(Array.from({length:days},(_,i)=>api.fixedDayPay(amount,days,i)),x=>x)),api.moneyCents(amount));
});
test('period bonus is included once on source period end, including sliced downloads',()=>{
  const source=Object.fromEntries(api.incomeFields.map(key=>[key,0]));source.final_cash_amount=110;source.final_staff_income=110;source.bonus_amount=10;
  const projected=api.completeLiveIncomeDays(source,[{businessDate:'2026-10-14',amounts:{final_cash_amount:100,final_staff_income:100}}],'2026-10-15');
  assert.equal(api.sumMoney(projected,x=>x.amounts.final_cash_amount??0),110);
  assert.equal(projected.find(x=>x.businessDate==='2026-10-14').amounts.bonus_amount??0,0);
  assert.equal(projected.find(x=>x.businessDate==='2026-10-15').amounts.bonus_amount,10);
});
test('period navigation handles February, year boundary and biweekly anchors',()=>{
  let p={startDate:'2026-01-16',endDate:'2026-01-31',cycleType:'semi_monthly',preset:'semi_monthly_second'};
  assert.equal(api.adjacentPayrollPeriod(p,1).endDate,'2026-02-15');
  assert.equal(api.adjacentPayrollPeriod({...p,startDate:'2026-01-01',endDate:'2026-01-15'},-1).startDate,'2025-12-16');
  assert.equal(api.adjacentPayrollPeriod({...p,cycleType:'biweekly',startDate:'2026-10-12',endDate:'2026-10-25'},1).startDate,'2026-10-26');
});

function fakeClient(tables){
  return {from(name){let rows=[...(tables[name]??[])];const chain={select(){return chain;},eq(k,v){rows=rows.filter(r=>r[k]===v);return chain;},gte(k,v){rows=rows.filter(r=>r[k]>=v);return chain;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return chain;},not(k,op,v){if(op==='is'&&v===null)rows=rows.filter(r=>r[k]!=null);return chain;},order(){return chain;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return chain;},limit(n){rows=rows.slice(0,n);return chain;},range(a,b){rows=rows.slice(a,b+1);return chain;},returns(){return Promise.resolve({data:rows,error:null});},maybeSingle(){return Promise.resolve({data:rows[0]??null,error:null});},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return chain;}};
}
const fixedSetting={id:'setting',salon_id:'salon',staff_id:'anna',legal_name:'Anna',pay_type:'fixed',fixed_pay_amount:1500,commission_rate:60,check_rate:50,tax_rate:0,apply_tax_to_fixed_pay:false,tax_tips:false,tax_bonus:false,cash_to_tax_company:false,tax_company_enabled:false,tip_payout_method:'cash',bonus_payout_method:'cash',effective_from:'2026-01-01',effective_to:null};
function authFor(tables){return {access:{canViewAllPayroll:true,canManagePayroll:true,canViewTaxCompany:false,linkedStaffId:null},Account:{id:'account'},salon:{id:'salon'},user:{id:'owner'},context:{},supabase:fakeClient(tables)};}
function fixtures(){return {salon_payroll_settings:[{salon_id:'salon',cycle_type:'semi_monthly',biweekly_anchor_date:null}],staff:[{id:'anna',salon_id:'salon',display_name:'Anna',is_active:true}],staff_payroll_settings:[fixedSetting],pos_daily_closings:[],payroll_period_staff_inputs:[{id:'bonus',salon_id:'salon',staff_id:'anna',period_start:'2026-10-01',period_end:'2026-10-15',cycle_type:'semi_monthly',bonus_amount:100,check_number:null,note:'Bonus'}]};}
test('custom monthly export equals sum of scheduled periods including fixed pay and bonus',async()=>{
  const auth=authFor(fixtures());const run=(startDate,endDate)=>api.calculateLivePayrollForAuth(auth,{startDate,endDate,cycleType:'custom',preset:'custom'});
  const first=await run('2026-10-01','2026-10-15'),second=await run('2026-10-16','2026-10-31'),month=await run('2026-10-01','2026-10-31');
  assert.equal(first.lines[0].final_staff_income,1600);assert.equal(second.lines[0].final_staff_income,1500);
  assert.equal(month.lines[0].final_staff_income,3100);assert.equal(month.lines[0].bonus_amount,100);
  assert.equal(api.sumMoney(month.shopDailyRows,r=>r.staffObligation),3100);
  assert.equal(api.sumMoney(month.lines,r=>r.final_cash_amount+r.final_check_amount+r.tax_withheld),3100);
});
test('adjacent partial downloads partition the same payroll without repeating bonuses',async()=>{
  const auth=authFor(fixtures());const run=(startDate,endDate)=>api.calculateLivePayrollForAuth(auth,{startDate,endDate,cycleType:'custom',preset:'custom'});
  const a=await run('2026-10-01','2026-10-14'),b=await run('2026-10-15','2026-10-31');
  assert.equal(a.lines[0].bonus_amount,0);assert.equal(b.lines[0].bonus_amount,100);
  assert.equal(a.lines[0].final_staff_income+b.lines[0].final_staff_income,3100);
});
test('commission, taxable tips and taxable bonus reconcile cash/check/tax without double counting',async()=>{
  const tables=fixtures();tables.staff_payroll_settings=[{...fixedSetting,pay_type:'commission',fixed_pay_amount:0,commission_rate:60,check_rate:50,tax_rate:20,tax_tips:true,tax_bonus:true,tip_payout_method:'check',bonus_payout_method:'check'}];
  tables.pos_ticket_staff_earnings=[{salon_id:'salon',ticket_id:'ticket',staff_id:'anna',work_date:'2026-10-15',service_total:1000,tip_amount:100,tip_is_manual:false}];
  const data=await api.calculateLivePayrollForAuth(authFor(tables),{startDate:'2026-10-01',endDate:'2026-10-15',cycleType:'semi_monthly',preset:'semi_monthly_first'});
  // Existing wage rules split net regular pay (600 − 60) 50/50, then add
  // net tips (80) and net bonus (80) to the check: cash 270, check 430.
  const line=data.lines[0];assert.equal(line.final_cash_amount,270);assert.equal(line.final_check_amount,430);assert.equal(line.tax_withheld,100);assert.equal(line.final_staff_income,700);
  assert.equal(api.sumMoney(data.shopDailyRows,row=>row.staffObligation),800);
  assert.equal(api.payrollLiveDashboard(data.lines,data.shopDailyRows,'2026-10-25').staffCost,800);
});
