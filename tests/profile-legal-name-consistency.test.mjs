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
const compiled=await build({stdin:{contents:`export {resolveStaffLegalNames} from './lib/staff-legal-name-server';export {staffLegalNameOwnerPatch,withStaffPersonalLegalName,getStaffLegalName} from './lib/staff-legal-name';export * from './lib/payroll-live-money';export * from './lib/payroll-live-projection';export * from './lib/payroll-period-navigation';export {calculateDailyPayroll,buildShopDailyRows,buildShopSummary,calculateLivePayrollForAuth,updateStaffPayrollSetting,buildTaxCompanyLinesForAuth} from './lib/payroll';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'@':root},plugins:[{name:'isolated',setup(b){
  b.onResolve({filter:/.*/},args=>Object.hasOwn(external,args.path)?{path:args.path,namespace:'isolated'}:undefined);
  b.onLoad({filter:/.*/,namespace:'isolated'},args=>({contents:external[args.path],loader:'ts'}));
  b.onLoad({filter:/[\\/]lib[\\/]payroll\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replaceAll('const auth = await requirePayrollManageContext();','const auth = globalThis.__legalNameAuth;').replaceAll('async function buildTaxCompanyLinesForAuth(','export async function buildTaxCompanyLinesForAuth(').replaceAll('function calculateDailyPayroll(','export function calculateDailyPayroll(').replaceAll('function buildShopDailyRows(','export function buildShopDailyRows(').replaceAll('function buildShopSummary(','export function buildShopSummary(').replaceAll('async function calculateLivePayrollForAuth(','export async function calculateLivePayrollForAuth('),loader:'ts',resolveDir:path.dirname(args.path)}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const person={id:'person',auth_user_id:'auth',first_name:'Ny Thi',last_name:'Truong Nguyen'};
const row={id:'staff',salon_id:'salon',account_user_id:'person',user_id:'wrong-auth',first_name:'Old',last_name:'Name',display_name:'Staff-Ny'};
test('linked profile identity uses explicit account link, never an unrelated legacy auth link',()=>{
 assert.equal(api.getStaffLegalName(api.withStaffPersonalLegalName(row,person)),'Ny Thi Truong Nguyen');
 assert.equal(api.getStaffLegalName(api.withStaffPersonalLegalName(row,{...person,id:'someone-else',auth_user_id:'wrong-auth'})),null);
 assert.equal(api.withStaffPersonalLegalName(row,{...person,last_name:null}).last_name,null);
 assert.equal(api.withStaffPersonalLegalName({...row,account_user_id:null,user_id:'auth'},person).first_name,'Ny Thi');
 assert.equal(api.withStaffPersonalLegalName({...row,account_user_id:null,user_id:null},person).first_name,'Old');
});
test('Owner payload never overwrites linked Personal names, including legacy linked staff',()=>{
 assert.deepEqual(api.staffLegalNameOwnerPatch(row,{first_name:'Forged',last_name:'Name'}),{});
 assert.deepEqual(api.staffLegalNameOwnerPatch({...row,account_user_id:null},{first_name:'Forged'}),{});
 assert.deepEqual(api.staffLegalNameOwnerPatch({...row,account_user_id:null,user_id:null},{first_name:'  Local ',last_name:'Employee'}),{first_name:'Local',last_name:'Employee'});
});
test('private resolver uses only salon-scoped RPC, skips local staff, and propagates current Personal edits',async()=>{
 const calls=[];let last='Truong';const db={async rpc(name,args){calls.push([name,args]);return {data:[{staff_id:'staff',first_name:'Ny',last_name:last}],error:null}}};
 const local={...row,id:'local',account_user_id:null,user_id:null};
 const first=await api.resolveStaffLegalNames([row,local],db);assert.equal(first[0].last_name,'Truong');assert.equal(first[1],local);last='Truong Nguyen';
 const second=await api.resolveStaffLegalNames([row],db);assert.equal(second[0].last_name,'Truong Nguyen');assert.equal(first[0].last_name,'Truong');assert.equal(second[0].display_name,'Staff-Ny');
 assert.deepEqual(calls[0],['get_staff_legal_names',{p_salon:'salon',p_staff:['staff']}]);
});
test('RPC failure or missing authorized row fails closed; empty names stay empty',async()=>{
 await assert.rejects(api.resolveStaffLegalNames([row],{rpc:async()=>({error:{message:'denied'}})}),/could not be loaded/);
 await assert.rejects(api.resolveStaffLegalNames([row],{rpc:async()=>({data:[{staff_id:'wrong',first_name:'Other'}]})}),/could not be loaded/);
 const [value]=await api.resolveStaffLegalNames([row],{rpc:async()=>({data:[{staff_id:'staff',first_name:null,last_name:null}]})});assert.equal(api.getStaffLegalName(value),null);
});
test('resolver separates salon scopes and batches long staff lists',async()=>{
 const calls=[];const rows=Array.from({length:501},(_,i)=>({...row,id:String(i)}));rows.push({...row,id:'other',salon_id:'other-salon'});
 const out=await api.resolveStaffLegalNames(rows,{rpc:async(name,args)=>{calls.push(args);return {data:args.p_staff.map(staff_id=>({staff_id,first_name:args.p_salon,last_name:null}))}}});
 assert.deepEqual(calls.map(call=>[call.p_salon,call.p_staff.length]),[['salon',500],['salon',1],['other-salon',1]]);assert.equal(out.at(-1).first_name,'other-salon');
});
test('actual Staff update service enforces owner-name boundaries without writing any Personal rows',async()=>{
 const source=fs.readFileSync('lib/staff.ts','utf8');const body=source.slice(source.indexOf('export async function updateStaffDirectoryBatch('),source.indexOf('function normalizeSpecialties('));
 const built=await build({stdin:{contents:'import {staffLegalNameOwnerPatch} from "@/lib/staff-legal-name";'+body+`const STAFF_PERMISSIONS={manage:'staff.manage'};const STAFF_SELECT='*';const cleanOptional=v=>v?.trim()||null;const shouldShowStaffProfileOnline=()=>true;const publicConsentStatusForVisibility=()=>"granted";const getCurrentBusinessContext=async()=>({user:{id:'owner'},currentAccount:{id:'account'},currentSalon:{id:'salon'}});const requirePermission=async code=>{if(code!=='staff.manage')throw Error('scope')};const requireCurrentAccountAndSalon=c=>({Account:c.currentAccount,salon:c.currentSalon});const createAuthenticatedSupabaseServerClient=async()=>globalThis.__staffWriteDb;`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'@':root}});
 const actions=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));const writes=[];const eqs=[];let patch;
 const rows=[row,{...row,id:'legacy',account_user_id:null},{...row,id:'local',account_user_id:null,user_id:null}];
 globalThis.__staffWriteDb={from(table){assert.equal(table,'staff');return {select(){return this},eq(k,v){eqs.push([k,v]);return this},in(){return this},async returns(){return {data:rows,error:null}},update(value){patch=value;writes.push(value);return this},then(resolve){resolve({error:null})}}}};
 try{await actions.updateStaffDirectoryBatch({changes:rows.map(r=>({staff_id:r.id,display_name:'Staff-Ny',first_name:'Owner entered',last_name:'Legal',is_active:true}))});assert.ok(!Object.hasOwn(writes[0],'first_name'));assert.ok(!Object.hasOwn(writes[1],'last_name'));assert.equal(writes[2].first_name,'Owner entered');assert.ok(eqs.filter(([k,v])=>k==='salon_id'&&v==='salon').length>=4);assert.equal(patch.display_name,'Staff-Ny');}finally{delete globalThis.__staffWriteDb;}
});
function fakeClient(tables){
  return {from(name){let rows=[...(tables[name]??[])];const chain={select(){return chain;},eq(k,v){rows=rows.filter(r=>r[k]===v);return chain;},gte(k,v){rows=rows.filter(r=>r[k]>=v);return chain;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return chain;},not(k,op,v){if(op==='is'&&v===null)rows=rows.filter(r=>r[k]!=null);return chain;},order(){return chain;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return chain;},limit(n){rows=rows.slice(0,n);return chain;},range(a,b){rows=rows.slice(a,b+1);return chain;},returns(){return Promise.resolve({data:rows,error:null});},maybeSingle(){return Promise.resolve({data:rows[0]??null,error:null});},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return chain;}};
}
const fixedSetting={id:'setting',salon_id:'salon',staff_id:'anna',legal_name:'Anna',pay_type:'fixed',fixed_pay_amount:1500,commission_rate:60,check_rate:50,tax_rate:0,apply_tax_to_fixed_pay:false,tax_tips:false,tax_bonus:false,cash_to_tax_company:false,tax_company_enabled:false,tip_payout_method:'cash',bonus_payout_method:'cash',effective_from:'2026-01-01',effective_to:null};
function authFor(tables){return {access:{canViewAllPayroll:true,canManagePayroll:true,canViewTaxCompany:false,linkedStaffId:null},Account:{id:'account'},salon:{id:'salon'},user:{id:'owner'},context:{},supabase:fakeClient(tables)};}
function fixtures(){return {salon_payroll_settings:[{salon_id:'salon',cycle_type:'semi_monthly',biweekly_anchor_date:null}],staff:[{id:'anna',salon_id:'salon',display_name:'Anna',is_active:true}],staff_payroll_settings:[fixedSetting],pos_daily_closings:[],payroll_period_staff_inputs:[{id:'bonus',salon_id:'salon',staff_id:'anna',period_start:'2026-10-01',period_end:'2026-10-15',cycle_type:'semi_monthly',bonus_amount:100,check_number:null,note:'Bonus'}]};}

test('linked live Payroll uses Personal across edits and owner payroll saves ignore a forged name',async()=>{
 const tables=fixtures();Object.assign(tables.staff[0],{account_user_id:'person',display_name:'Staff-Ny',first_name:'Old',last_name:'Salon'});const auth=authFor(tables);let last='Truong';
 auth.supabase.rpc=async(name,args)=>{assert.equal(name,'get_staff_legal_names');assert.deepEqual(args,{p_salon:'salon',p_staff:['anna']});return {data:[{staff_id:'anna',first_name:'Ny',last_name:last}]}};
 const period={startDate:'2026-10-01',endDate:'2026-10-15',cycleType:'semi_monthly',preset:'semi_monthly_first'};
 const before=await api.calculateLivePayrollForAuth(auth,period);last='Truong Nguyen';const after=await api.calculateLivePayrollForAuth(auth,period);
 assert.equal(before.lines[0].staff_legal_name_snapshot,'Ny Truong');assert.equal(after.lines[0].staff_legal_name_snapshot,'Ny Truong Nguyen');assert.equal(after.lines[0].staff_display_name_snapshot,'Staff-Ny');assert.deepEqual(before.summary,after.summary);
 let saved;globalThis.__legalNameAuth={salon:{id:'salon'},supabase:{from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:{...tables.staff[0],salon_id:'salon'}}}}},async rpc(name,args){if(name==='get_staff_legal_names')return {data:[{staff_id:'anna',first_name:'Ny',last_name:last}]};assert.equal(name,'save_owner_live_payroll_setting');saved=args.p_values;return {data:saved}}}};
 try{await api.updateStaffPayrollSetting({staffId:'anna',legalName:'Forged',effectiveFrom:'2026-10-01',payType:'fixed',tipPayoutMethod:'cash',bonusPayoutMethod:'check',checkRate:50,commissionRate:60,taxRate:0,fixedPayAmount:100,applyTaxToFixedPay:false,cashToTaxCompany:false,taxTips:false,taxBonus:false});assert.equal(saved.legal_name,'Ny Truong Nguyen');}finally{delete globalThis.__legalNameAuth;}
});
