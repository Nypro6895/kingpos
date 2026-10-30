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
const compiled=await build({stdin:{contents:`export {getStaffLegalName} from './lib/staff-legal-name';export * from './lib/payroll-live-money';export * from './lib/payroll-live-projection';export * from './lib/payroll-period-navigation';export {calculateDailyPayroll,buildShopDailyRows,buildShopSummary,calculateLivePayrollForAuth,updateStaffPayrollSetting,buildTaxCompanyLinesForAuth} from './lib/payroll';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'@':root},plugins:[{name:'isolated',setup(b){
  b.onResolve({filter:/.*/},args=>Object.hasOwn(external,args.path)?{path:args.path,namespace:'isolated'}:undefined);
  b.onLoad({filter:/.*/,namespace:'isolated'},args=>({contents:external[args.path],loader:'ts'}));
  b.onLoad({filter:/[\\/]lib[\\/]payroll\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replaceAll('const auth = await requirePayrollManageContext();','const auth = globalThis.__legalNameAuth;').replaceAll('async function buildTaxCompanyLinesForAuth(','export async function buildTaxCompanyLinesForAuth(').replaceAll('function calculateDailyPayroll(','export function calculateDailyPayroll(').replaceAll('function buildShopDailyRows(','export function buildShopDailyRows(').replaceAll('function buildShopSummary(','export function buildShopSummary(').replaceAll('async function calculateLivePayrollForAuth(','export async function calculateLivePayrollForAuth('),loader:'ts',resolveDir:path.dirname(args.path)}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fakeClient(tables){
  return {rpc(name){assert.equal(name,"effective_staff_day_inputs_range");return this.from("pos_ticket_staff_earnings")},from(name){let rows=[...(tables[name]??[])];const chain={select(){return chain;},eq(k,v){rows=rows.filter(r=>r[k]===v);return chain;},gte(k,v){rows=rows.filter(r=>r[k]>=v);return chain;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return chain;},not(k,op,v){if(op==='is'&&v===null)rows=rows.filter(r=>r[k]!=null);return chain;},order(){return chain;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return chain;},limit(n){rows=rows.slice(0,n);return chain;},range(a,b){rows=rows.slice(a,b+1);return chain;},returns(){return Promise.resolve({data:rows,error:null});},maybeSingle(){return Promise.resolve({data:rows[0]??null,error:null});},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return chain;}};
}
const fixedSetting={id:'setting',salon_id:'salon',staff_id:'anna',legal_name:'Anna',pay_type:'fixed',fixed_pay_amount:1500,commission_rate:60,check_rate:50,tax_rate:0,apply_tax_to_fixed_pay:false,tax_tips:false,tax_bonus:false,cash_to_tax_company:false,tax_company_enabled:false,tip_payout_method:'cash',bonus_payout_method:'cash',effective_from:'2026-01-01',effective_to:null};
function authFor(tables){return {access:{canViewAllPayroll:true,canManagePayroll:true,canViewTaxCompany:false,linkedStaffId:null},Account:{id:'account'},salon:{id:'salon'},user:{id:'owner'},context:{},supabase:fakeClient(tables)};}
function fixtures(){return {salon_payroll_settings:[{salon_id:'salon',cycle_type:'semi_monthly',biweekly_anchor_date:null}],staff:[{id:'anna',salon_id:'salon',display_name:'Anna',is_active:true}],staff_payroll_settings:[fixedSetting],pos_daily_closings:[],payroll_period_staff_inputs:[{id:'bonus',salon_id:'salon',staff_id:'anna',period_start:'2026-10-01',period_end:'2026-10-15',cycle_type:'semi_monthly',bonus_amount:100,check_number:null,note:'Bonus'}]};}

const period={startDate:'2026-10-01',endDate:'2026-10-15',cycleType:'semi_monthly',preset:'semi_monthly_first'};
test('legal identity preserves compound names and never substitutes a nickname',()=>{
 assert.equal(api.getStaffLegalName({first_name:'  Ny  Thi ',last_name:'Truong  Nguyen'}),'Ny Thi Truong Nguyen');
 assert.equal(api.getStaffLegalName({display_name:'Staff-Ny'}),null);
 assert.equal(api.getStaffLegalName(null),null);
 assert.equal(api.getStaffLegalName({first_name:'Ny',last_name:null}),'Ny');
});
test('live payroll and Tax Company use profile legal name despite a conflicting legacy setting',async()=>{
 const tables=fixtures();Object.assign(tables.staff[0],{display_name:'Staff-Ny',first_name:'Ny',last_name:'Truong Nguyen'});
 tables.staff_payroll_settings=[{...fixedSetting,legal_name:'Wrong legacy name',tax_rate:10,tax_company_enabled:true,apply_tax_to_fixed_pay:true}];
 const live=await api.calculateLivePayrollForAuth(authFor(tables),period);
 assert.equal(live.lines[0].staff_display_name_snapshot,'Staff-Ny');
 assert.equal(live.lines[0].staff_legal_name_snapshot,'Ny Truong Nguyen');
 const savedLine={...live.lines[0],staff_legal_name_snapshot:'Previously recorded name'};
 const saved={run:{id:'saved-1',version:1},lines:[savedLine],paystubs:[]};
 const result=await api.buildTaxCompanyLinesForAuth({auth:authFor(tables),period,live,latestStatement:saved});
 assert.equal(result.lines[0].staff_legal_name_snapshot,'Ny Truong Nguyen');
 assert.equal(savedLine.staff_legal_name_snapshot,'Previously recorded name');
 assert.equal(tables.staff_payroll_settings[0].legal_name,'Wrong legacy name');
});
test('profile renames update new calculations, leave older snapshots intact, and never change amounts',async()=>{
 const tables=fixtures();Object.assign(tables.staff[0],{first_name:'Ny',last_name:'Truong'});
 const before=await api.calculateLivePayrollForAuth(authFor(tables),period);
 tables.staff[0].last_name='Truong Nguyen';
 const after=await api.calculateLivePayrollForAuth(authFor(tables),period);
 assert.equal(before.lines[0].staff_legal_name_snapshot,'Ny Truong');
 assert.equal(after.lines[0].staff_legal_name_snapshot,'Ny Truong Nguyen');
 assert.deepEqual(after.summary,before.summary);
});
test('missing profile name stays missing even if legacy setting or nickname exists',async()=>{
 const tables=fixtures();const live=await api.calculateLivePayrollForAuth(authFor(tables),period);
 assert.equal(live.lines[0].staff_legal_name_snapshot,null);
});
test('payroll writes derive legal name on the server and retain salon scope',async()=>{
 const calls=[];globalThis.__legalNameAuth={salon:{id:'salon'},supabase:{from(table){assert.equal(table,'staff');return {select(columns){assert.equal(columns,'id, salon_id, account_user_id, user_id, first_name, last_name');return this},eq(key,value){calls.push([key,value]);return this},async maybeSingle(){return {data:{id:'anna',first_name:'Ny',last_name:'Truong'},error:null}}}},async rpc(name,args){assert.equal(name,'save_owner_payroll_setting_with_notice');assert.equal(args.p_notify_staff,false);assert.equal(args.p_values.legal_name,'Ny Truong');assert.equal(args.p_salon,'salon');return {data:args.p_values,error:null}}}};
 try{await api.updateStaffPayrollSetting({staffId:'anna',legalName:'Forged name',effectiveFrom:'2026-10-01',payType:'fixed',tipPayoutMethod:'cash',bonusPayoutMethod:'check',checkRate:50,commissionRate:60,taxRate:0,fixedPayAmount:100,applyTaxToFixedPay:false,cashToTaxCompany:false,taxTips:false,taxBonus:false});assert.deepEqual(calls,[['id','anna'],['salon_id','salon']]);}finally{delete globalThis.__legalNameAuth;}
});

test('Staff save preserves compound family names, explicit blanks, and older full-name clients',async()=>{
 const source=fs.readFileSync('app/staff/actions.ts','utf8');
 const helpers=source.slice(source.indexOf('function readRequiredString('),source.indexOf('function readActionString('));
 const batch=source.slice(source.indexOf('function readBatchOptionalString('),source.indexOf('export async function updateStaffDirectoryBatchFormAction('));
 const compiled=await build({stdin:{contents:helpers+batch+';const updateStaffDirectoryBatchInService=async value=>{globalThis.__savedStaff=value};const getCurrentBusinessContext=async()=>({});const revalidatePath=()=>{};',loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
 const actions=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 const form=new FormData();form.set('staff_id','ny');form.set('display_name_ny','Staff-Ny');form.set('first_name_ny','Ny Thi');form.set('last_name_ny','Truong Nguyen');form.set('full_name_ny','Ignored Old Name');
 try{
  assert.equal((await actions.saveStaffDirectoryEntryAction(form)).ok,true);
  assert.equal(globalThis.__savedStaff.changes[0].first_name,'Ny Thi');assert.equal(globalThis.__savedStaff.changes[0].last_name,'Truong Nguyen');
  form.set('last_name_ny','');await actions.saveStaffDirectoryEntryAction(form);assert.equal(globalThis.__savedStaff.changes[0].last_name,null);
  form.delete('first_name_ny');form.delete('last_name_ny');form.set('full_name_ny','Ny Truong');await actions.saveStaffDirectoryEntryAction(form);assert.equal(globalThis.__savedStaff.changes[0].first_name,'Ny');assert.equal(globalThis.__savedStaff.changes[0].last_name,'Truong');
 }finally{delete globalThis.__savedStaff;}
});
