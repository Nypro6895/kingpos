

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
  '@/lib/payroll-records':'export const loadPayrollRecordedFacts=async()=>({});',
  '@/lib/pos-ticket-adjustment-history-server':'export const loadVisibleTicketAdjustments=async()=>[];',
  '@/lib/staff-legal-name-server':'export const resolveStaffLegalNames=async rows=>rows;',
  '@/lib/payroll-live-history':'export const loadPayrollLiveHistory=async()=>[];',
};
const compiled=await build({stdin:{contents:`export {staffPayrollPaymentRows,staffPayrollRowDisplay,staffTakeHomeDisplay} from './lib/staff-payroll-display';export * from './lib/payroll-live-dashboard';export * from './lib/payroll-live-money';export * from './lib/payroll-live-projection';export * from './lib/payroll-period-navigation';export {calculateDailyPayroll,buildShopDailyRows,buildShopSummary,calculateLivePayrollForAuth,buildTaxCompanyLinesForAuth} from './lib/payroll';`,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false,alias:{'@':root},plugins:[{name:'isolated',setup(b){
  b.onResolve({filter:/.*/},args=>Object.hasOwn(external,args.path)?{path:args.path,namespace:'isolated'}:undefined);
  b.onLoad({filter:/.*/,namespace:'isolated'},args=>({contents:external[args.path],loader:'ts'}));
  b.onLoad({filter:/[\\/]lib[\\/]payroll\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replaceAll('function calculateDailyPayroll(','export function calculateDailyPayroll(').replaceAll('function buildShopDailyRows(','export function buildShopDailyRows(').replaceAll('function buildShopSummary(','export function buildShopSummary(').replaceAll('async function calculateLivePayrollForAuth(','export async function calculateLivePayrollForAuth(').replaceAll('async function buildTaxCompanyLinesForAuth(','export async function buildTaxCompanyLinesForAuth('),loader:'ts',resolveDir:path.dirname(args.path)}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function fakeClient(tables){
  return {rpc(name,args){if(name==="shop_payroll_collections")return fakeClient({effective:[]}).from("effective");if(name!=="effective_staff_day_inputs_range")throw Error("Unexpected fixture RPC: "+name);const rows=(tables.pos_ticket_staff_earnings??[]).filter(r=>r.work_date>=args.p_start&&r.work_date<=args.p_end).map(r=>({...r,gross_sales:r.service_total}));return fakeClient({effective:rows}).from("effective");},from(name){let rows=[...(tables[name]??[])];const chain={select(){return chain;},eq(k,v){rows=rows.filter(r=>r[k]===v);return chain;},gte(k,v){rows=rows.filter(r=>r[k]>=v);return chain;},lte(k,v){rows=rows.filter(r=>r[k]<=v);return chain;},not(k,op,v){if(op==='is'&&v===null)rows=rows.filter(r=>r[k]!=null);return chain;},order(){return chain;},in(k,v){rows=rows.filter(r=>v.includes(r[k]));return chain;},limit(n){rows=rows.slice(0,n);return chain;},range(a,b){rows=rows.slice(a,b+1);return chain;},returns(){return Promise.resolve({data:rows,error:null});},maybeSingle(){return Promise.resolve({data:rows[0]??null,error:null});},then(resolve,reject){return Promise.resolve({data:rows,error:null}).then(resolve,reject);}};return chain;}};
}
const fixedSetting={id:'setting',salon_id:'salon',staff_id:'anna',legal_name:'Anna',pay_type:'fixed',fixed_pay_amount:1500,commission_rate:60,check_rate:50,tax_rate:0,apply_tax_to_fixed_pay:false,tax_tips:false,tax_bonus:false,cash_to_tax_company:false,tax_company_enabled:false,tip_payout_method:'cash',bonus_payout_method:'cash',effective_from:'2026-01-01',effective_to:null};
function authFor(tables){return {access:{canViewAllPayroll:true,canManagePayroll:true,canViewTaxCompany:false,linkedStaffId:null},Account:{id:'account'},salon:{id:'salon'},user:{id:'owner'},context:{},supabase:fakeClient(tables)};}
function fixtures(){return {salon_payroll_settings:[{salon_id:'salon',cycle_type:'semi_monthly',biweekly_anchor_date:null}],staff:[{id:'anna',salon_id:'salon',display_name:'Anna',is_active:true}],staff_payroll_settings:[fixedSetting],pos_daily_closings:[],payroll_period_staff_inputs:[{id:'bonus',salon_id:'salon',staff_id:'anna',period_start:'2026-10-01',period_end:'2026-10-15',cycle_type:'semi_monthly',bonus_amount:100,check_number:null,note:'Bonus'}]};}

export {api, fixtures, authFor, fixedSetting};
