import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

// Render the real page/components with explicit sample data and inert server actions.
export async function taxCompanyPreview() {
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import TaxPage from './app/(app)/tax-company/page';import Settings from './app/(app)/payroll/tax-company/settings/page';import Salon from './app/(app)/tax-company/[salonId]/page';import Install from './app/(app)/tax-company/install/page';
 import {StaffMyPay} from './app/staff/my-work/staff-pay-analysis';
 const mode=new URLSearchParams(location.search).get('mode');
 const staffData={period:{startDate:'2026-09-16',endDate:'2026-09-30'},periodOptions:[{value:'2026-09-16:2026-09-30',startDate:'2026-09-16',endDate:'2026-09-30',label:'September 16–30, 2026'}],settings:[],status:{kind:'paid',label:'Paid'},latestStatement:{run:{paid_at:'2026-10-01'}},paystub:{view_url:'https://example.test/anna-paystub.pdf'},dailyRows:[],line:{final_staff_income:2700,final_cash_amount:0,final_check_amount:2700,gross_sales:4200,staff_commission_gross:2520,tip_amount:380,bonus_amount:100,tax_withheld:300,check_number:'1024',pay_type_used:'commission',commission_rate_used:60,tax_rate_used:10,tax_tips_snapshot:true,tax_bonus_snapshot:true,settings_used_snapshot:[{payType:'commission',commissionRate:60,taxRate:10,taxTips:true,taxBonus:true}]}};
 const result=mode==='staff'?<main className="mx-auto grid max-w-5xl gap-5 p-6"><header><p className="text-sm text-zinc-500">Lumi Nail Studio · Anna Smith</p><h1 className="mt-2 text-2xl font-semibold">My Pay</h1></header><nav className="flex gap-6 border-b pb-3 text-sm"><span>Today</span><strong>My Pay</strong><span>Analysis</span></nav><StaffMyPay data={staffData}/></main>:mode==='settings'?Settings({searchParams:Promise.resolve({})}):mode==='salon'?Salon({params:Promise.resolve({salonId:'salon-one'}),searchParams:Promise.resolve({})}):mode==='install'?Install():TaxPage({searchParams:Promise.resolve({})});
 Promise.resolve(result).then(node=>createRoot(document.getElementById('root')).render(node));
 `},outfile:'tax-preview.js',bundle:true,write:false,format:'iife',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'tax-fixtures',setup(b){
 b.onResolve({filter:/^@\/components\/experience-page$/},()=>({path:'experience',namespace:'experience-fixture'}));
 b.onLoad({filter:/.*/,namespace:'experience-fixture'},()=>({contents:'export const withExperiencePage = page => page;'}));
 b.onResolve({filter:/^(next\/link|next\/navigation|@\/lib\/tax-company|@\/lib\/current-context|@\/app\/tax-company\/actions|@\/app\/payroll\/actions|@\/components\/workspace-language)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onResolve({filter:/^\.\/ledger-actions$/},()=>({path:'ledger-actions',namespace:'ledger-fixture'}));
 b.onLoad({filter:/.*/,namespace:'ledger-fixture'},()=>({contents:'export async function saveOwnerAdjustment(){};export async function saveRecordedPayment(){};export async function verifyPayrollIntent(){};'}));
 b.onResolve({filter:/^\.\/actions$/},a=>a.importer.replaceAll('\\','/').includes('/app/tax-company/')?{path:'@/app/tax-company/actions',namespace:'fixture'}:undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'tsx',contents:a.path==='next/link'?`import React from'react';export default function Link(p){return <a {...p}/>}`:a.path==='next/navigation'?`export function useRouter(){return{push(url){window.navigated=url},refresh(){}}}`:a.path.includes('workspace-language')?`import React from'react';export function WorkspaceElement({as='div',...p}){return React.createElement(as,p)};export function WorkspaceText({text}){return text};export function useWorkspaceTranslation(){return x=>x}`:a.path.includes('/actions')?`
 export async function connectTaxSalon(f){window.connected=Object.fromEntries(f)};export async function disconnectTaxSalon(f){window.disconnected=Object.fromEntries(f)};export async function updateTaxSettings(f){window.settings=Object.fromEntries(f)};export async function uploadTaxPaystub(f){window.uploaded=Object.fromEntries(f)};export async function uploadPayrollPaystubAction(f){};
 export async function saveTaxCompanyNote(salonId,content,version){window.noteRequest={salonId,content,version};return window.noteFailure?{error:'Connection lost. Please try again.'}:{note:{content,version:version+1,updated_at:new Date().toISOString()}}}
 `:a.path.includes('current-context')?`export async function getCurrentBusinessContext(){return{user:{id:'professional'}}}`:`
 import {taxCompanyPeriods} from './lib/tax-company-periods';
 export async function taxCompanySettings(){const query=new URLSearchParams(location.search);const inactive=query.has('inactive');const existing=!inactive||query.has('expired');return{active:!inactive,enabled:existing,salon_name:'Lumi Nail Studio',login_id:existing?'TAX-ABC123':null,connections:existing?[{user_id:'professional',display_name:'Taylor Nguyen',email:'taylor@example.test',account_active:true,connected_at:'2026-10-09T12:00:00Z'}]:[]}};
 const salons=[{id:'salon-one',name:'Lumi Nail Studio',active:true,address_line1:'123 Main Street',city:'Houston',state:'TX',postal_code:'77002',phone:'(713) 555-0100',cycle_type:'semi_monthly'},{id:'salon-two',name:'Bloom Beauty Salon',active:false,address_line1:'456 Oak Avenue',city:'Austin',state:'TX',postal_code:'78701',phone:'(512) 555-0120',cycle_type:'monthly'}];
 export async function taxCompanySalons(){return salons};
 export async function taxCompanyReport(){
 const monthly=new URLSearchParams(location.search).has('monthly');
 const payrollSetting={cycle_type:monthly?'monthly':'semi_monthly'};
 const runs=[{id:'run-one',period_start:monthly?'2026-09-01':'2026-09-16',period_end:'2026-09-30',version:1,status:'paid',cycle_type:payrollSetting.cycle_type}];
 return {...taxCompanyPeriods(payrollSetting,runs,'2026-10-10'),salon:salons[0],payrollSetting,note:{content:'Confirm September paystubs before October 15.\\nFollow up with Anna on her updated address.',version:1,updated_at:null},lines:['Anna','Emily','Mia','Sophia','Lily'].map((name,index)=>({staff_id:'staff-'+index,staff_display_name_snapshot:name,staff_legal_name_snapshot:name+' '+['Smith','Tran','Nguyen','Le','Pham'][index],tax_company_cash_amount:0,tax_company_taxable_gross:3000-index*200,tip_amount:380-index*20,tip_payout_method_snapshot:'check',tax_tips_snapshot:true,bonus_amount:100,bonus_payout_method_snapshot:'check',tax_bonus_snapshot:true,tax_withheld:300-index*20,tax_rate_used:10,base_check_amount:2220-index*160,final_check_amount:2700-index*180,paystub:index<3?{view_url:'https://example.test/'+name.toLowerCase()+'-paystub.pdf'}:null}))};}
 `}));
 }}]});
 const globalSource=fs.readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./payroll";\n@source "./staff/my-work";\n@source "./tax-company";\n@source "../tests/fixtures/tax-company-preview.mjs";');
 const {css}=await postcss([tailwind()]).process(globalSource,{from:'app/globals.css'});
 const compiledCss=bundle.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
 const script=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 return createServer((req,res)=>{
  res.setHeader('Content-Type',req.url.startsWith('/bundle.js')?'application/javascript':'text/html; charset=utf-8');
  res.end(req.url.startsWith('/bundle.js')?script:`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${compiledCss}body{margin:0;background:#fafbf9;font-family:Arial,sans-serif}.sample-notice{background:#fff7ed;border-bottom:1px solid #fed7aa;color:#9a3412;font-size:12px;text-align:center;padding:10px}</style></head><body><div class="sample-notice">Ảnh chụp giao diện chạy local · Dữ liệu mẫu · Không phải payroll production</div><div id="root"></div><script src="/bundle.js"></script></body></html>`);
 });
}
