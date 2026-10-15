import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
const root=path.resolve('artifacts/payroll-mobile-release-dpl_FjvyKRikrntAAhdQDvk1Mc9GSAtv');
const fixture=`
const params=new URLSearchParams(location.search), empty=params.has('empty');
const period={startDate:'2026-10-01',endDate:'2026-10-15',label:'October 1–15, 2026',preset:'semi_monthly_first',cycleType:'semi_monthly'};
const setting={id:'setting',commission_rate:60,check_rate:60,tax_rate:10,pay_type:'commission',legal_name:'Anna Nguyen',tax_tips:true,tax_bonus:true,tip_payout_method:'check',bonus_payout_method:'check',cash_to_tax_company:false,fixed_pay_amount:0,apply_tax_to_fixed_pay:false,effective_from:'2026-01-01',effective_to:null};
const lines=empty?[]:['Anna Nguyen','Elizabeth Thompson Williams','Mia Le'].map((name,i)=>({staff_id:'staff-'+i,staff_display_name_snapshot:name,staff_legal_name_snapshot:i===2?null:name,pay_type_used:'commission',commission_rate_used:60,check_rate_used:60,tax_rate_used:10,check_number:'10'+i,bonus_amount:100,bonus_payout_method_snapshot:'check',tax_bonus_snapshot:true,tip_payout_method_snapshot:'check',tax_tips_snapshot:true,tip_amount:380,tax_withheld:300,base_cash_amount:1000,base_check_amount:1220,check_net:1220,final_check_amount:i===2?-20:1700,final_cash_amount:1000,final_staff_income:i===2?980:2700,gross_sales:4200,staff_commission_gross:2520,tax_company_taxable_gross:3000,tax_company_cash_amount:0,paystub:i===0?{view_url:'#sample-paystub'}:null,dailyTotals:[],inputHistory:[],settings_used_snapshot:[{payType:'commission',commissionRate:60,taxRate:10,taxTips:true,taxBonus:true}],note:null}));
const rows=empty?[]:[1,2,3].map((day,i)=>({businessDate:'2026-10-0'+day,actualIncome:i===2?null:i===1?1900:2000,posIncome:2000,difference:i===2?null:i===1?-100:0,cashAmount:500,creditCardAmount:1400,otherAmount:100,manualInputIncome:2000,staffProduction:1500,staffCommissionPay:900,staffNetPay:1100,staffObligation:1300,taxWithheld:100,tipsPaid:200,tips:200,shopShare:600,shopNetIncome:700,corrections:[]}));
const summary={cashAmount:1000,creditCardAmount:2800,otherAmount:100,manualInputIncome:3900,totalActualIncome:empty?null:3900,posIncome:empty?0:6000,overShortTotal:-100,staffProduction:4500,staffCommissionPay:2700,staffNetPay:3300,totalStaffObligation:3900,taxWithheld:300,tipsPaid:600,tips:600,shopShare:1800,shopNetIncome:0,correctionCount:0};
const statement=empty?null:{run:{id:'run-1',version:2,status:params.has('paid')?'paid':'printed'},lines};
const data={access:{canManagePayroll:!params.has('readonly'),canViewAllPayroll:true,canViewTaxCompany:false},period,periodOptions:[],salonPayrollSetting:{cycle_type:'semi_monthly',biweekly_anchor_date:null},scheduleSetup:{needsBiweeklyAnchor:false},live:{lines,shopDailyRows:rows,shopSummary:summary,corrections:[]},latestStatement:statement,difference:{changed:params.has('changed'),actionItems:[],summaryDifferences:{},staffDifferences:[]},taxCompany:{latestStatement:statement,lines},serviceAnalytics:{rows:[{serviceId:'service-1',serviceName:'Manicure',count:15,revenue:1500,ticketCount:10}],ticketCount:10},staffPayrollSettings:lines.map((line,i)=>({staff:{id:line.staff_id,name:line.staff_display_name_snapshot},staffProfileDisplayName:line.staff_display_name_snapshot,staffProfileAvatarUrl:null,setting:{...setting,id:'setting-'+i},history:[{...setting,id:'setting-'+i}]}))};
export async function getPayrollPageData(){return data}
export async function getPayrollTaxCompanyData(){return{...data,lines,summary:{totalTaxCompanyTaxableGross:9000}}}
`;
const actions=`
export async function autosavePayrollPeriodStaffInputAction(previous,form){await new Promise(r=>setTimeout(r,1300));if(new URLSearchParams(location.search).has('fail'))return{status:'error',message:'Connection lost. Try again.',savedAt:null};return{status:'saved',message:null,savedAt:new Date().toISOString()}}
export async function savePayrollStatementAction(){alert('Sample statement saved')}
export async function markLatestPayrollStatementPaidAction(){alert('Sample marked paid')}
export async function saveSalonPayrollScheduleAction(){}
export async function saveStaffPayrollSettingWithEffectiveDateAction(){}
export async function uploadPayrollPaystubAction(){}
`;
const stubs={
 '@/lib/current-context':`export const isOwnerMembership=()=>!new URLSearchParams(location.search).has('readonly');`,
 'next/link':`import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
 'next/navigation':`const router={refresh(){},push(url){location.href=url},replace(url){location.href=url}};export const useRouter=()=>router;export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`,
 '@/lib/payroll':fixture,
 '@/lib/route-context-guards':`export async function requireSalonManagePageContext(){return{currentSalon:{id:'salon-1',name:'Lumi Nail Studio'}}}`,
 '@/lib/market-plugins':`export async function payrollDataPluginInstalled(){return true}`,
 '@/lib/tax-company':`export async function taxCompanySettings(){if(new URLSearchParams(location.search).has('pluginerror'))throw Error('offline');return{active:!new URLSearchParams(location.search).has('inactive'),enabled:true,connections:[{account_active:true}],salon_name:'Lumi Nail Studio',login_id:'TAX-SAMPLE'}}`,
 '@/lib/workspace-language-server':`export async function getWorkspaceTranslation(){return x=>x}`,
 '@/components/contextual-support':`export function ContextualSupport(){return null}`,
 '@/components/workspace-language':`import React from'react';import{translateVietnamese}from'@/lib/vietnamese-dictionary';const translate=x=>typeof x==='string'?translateVietnamese(x,new URLSearchParams(location.search).has('vi')):x;export const useWorkspaceTranslation=()=>translate;export function WorkspaceText({text}){return translate(text)};export function WorkspaceElement({as='div',...p}){return React.createElement(as,p)}`,
 '@/app/payroll/actions':actions,
 '@/app/tax-company/actions':`export async function uploadTaxPaystub(){}`,
};
const result=await build({stdin:{resolveDir:root,loader:'tsx',contents:`import React from'react';import{createRoot}from'react-dom/client';import Page from'./app/(app)/payroll/page';import Report from'./app/(app)/payroll/tax-company/page';const params=Object.fromEntries(new URLSearchParams(location.search));(params.report?Report:Page)({searchParams:Promise.resolve(params)}).then(node=>createRoot(document.getElementById('root')).render(node));`},outfile:'payroll-preview.js',bundle:true,write:false,jsx:'automatic',format:'iife',alias:{'@':root},plugins:[{name:'sample-data',setup(b){
 b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'fixture'}:a.path==='./data-download-actions'?{path:a.path,namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:root,loader:'tsx',contents:stubs[a.path]??`export async function downloadPayrollData(){return{files:[{name:'payroll-staff.csv',csv:'staff,total\\nSample,2700'}]}}`}));
 b.onLoad({filter:/[\\/]payroll[\\/]page\.tsx$/},a=>({resolveDir:path.dirname(a.path),loader:'tsx',contents:fs.readFileSync(a.path,'utf8').replaceAll('async function StaffPerformancePanel','function StaffPerformancePanel').replaceAll('async function SummaryTable','function SummaryTable').replaceAll('const __vt = await getWorkspaceTranslation();','const __vt = (value) => value;')}));
 }}]});
const source=fs.readFileSync(path.join(root,'app/globals.css'),'utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "./payroll";\n@source "./(app)/payroll";\n@source "../components";');
const globalCss=(await postcss([tailwind()]).process(source,{from:path.join(root,'app/globals.css')})).css;
const css=globalCss+'\n'+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/bundle.js')?'application/javascript':'text/html;charset=utf-8');res.end(req.url.startsWith('/bundle.js')?js:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#fafbf9;font-family:Arial,sans-serif;padding-bottom:80px}.sample{padding:8px;background:#fff5e4;font-size:12px;text-align:center}.bottom{position:fixed;bottom:0;inset-inline:0;background:white;border-top:1px solid #ddd;display:flex;justify-content:space-around;padding:24px;z-index:40}</style></head><body><p class="sample">LOCAL QA · Dữ liệu mẫu · Không phải lương thực tế</p><div id="root"></div><nav class="bottom"><a href="/outside">Home</a><a href="/payroll">Payroll</a><a href="/more">More</a></nav><script src="/bundle.js"></script></body></html>`)}).listen(55291,'127.0.0.1',()=>console.log('Payroll UI fixture at http://127.0.0.1:55291'));
