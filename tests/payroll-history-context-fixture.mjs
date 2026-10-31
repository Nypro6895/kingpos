import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';

// Actual web page + actual app-local page and child components. Only transport,
// authenticated backend reads, language and Next router boundaries are replaced.
export const payrollContextFixture=`import React from 'react';import{createRoot}from'react-dom/client';
import PayrollPage from '@/app/(app)/payroll/page';
import{AppLocalOwnerPayrollView}from'@/lib/app-local-owner-payroll-view';
const id=n=>'a0000000-1111-4111-8111-'+String(n).padStart(12,'0'),salon=id(99),staff=id(98);
const period={startDate:'2026-10-16',endDate:'2026-10-31',cycleType:'semi_monthly',preset:'semi_monthly_second',label:'Oct 16–31, 2026'};
const event=(n,source,before,after,extra={})=>({id:id(n),salon_id:salon,staff_id:staff,source_id:staff,source_table:source,period_start:'2026-10-29',period_end:'2026-10-29',created_at:'2026-10-31T01:00:00Z',actor_name:'Salon Owner',before_values:before,after_values:after,note:'Checked against the original record',event_action:'updated',...extra});
const events=[event(1,'staff_day',{service_total:100,tip_amount:10},{service_total:120,tip_amount:12}),event(2,'daily_report',{cash_amount:100,credit_card_amount:0,other_amount:0,tip_input:0},{cash_amount:120,credit_card_amount:0,other_amount:0,tip_input:12},{staff_id:null}),event(3,'ticket',{ticket_number:'T00042',service_total:35,tip_amount:0},{ticket_number:'T00042',service_total:20,tip_amount:0},{ticket_number:'T00042'}),event(4,'payroll_period_staff_inputs',{bonus_amount:25,check_number:'124',note:''},{bonus_amount:0,check_number:null,note:'Check voided before payment'},{period_start:period.startDate,period_end:period.endDate}),event(5,'payroll_settings',{commission_rate:50,effective_from:'2026-10-16'},{commission_rate:60,effective_from:'2026-10-16'},{period_start:'2026-10-16',period_end:'2026-10-16'}),event(6,'pos_ticket_staff_earnings',{},{service_total:50,tip_amount:0,work_date:'2026-10-29'}),event(7,'payroll_period_staff_inputs',{check_number:'124',note:''},{check_number:null,note:'Payment reference corrected'},{period_start:period.startDate,period_end:period.endDate})];
window.fixtureEvents=events;
const dailyRows=[{id:id(21),staff_id:staff,business_date:'2026-10-29',gross_sales:120,tip_amount:12}];
const line={staff_id:staff,staff_display_name_snapshot:'Kim',staff_legal_name_snapshot:'Kim Example',gross_sales:120,staff_commission_gross:72,bonus_amount:0,tax_withheld:0,final_staff_income:84,final_cash_amount:42,final_check_amount:42,tip_amount:12,tip_cash_amount:12,tip_check_amount:0,bonus_payout_method_snapshot:'check',tip_payout_method_snapshot:'cash',check_number:null,note:null,pay_type_used:'commission',fixed_pay_amount_used:0,commission_rate_used:60,check_rate_used:50,tax_rate_used:0,tax_bonus_snapshot:false,tax_tips_snapshot:false,dailyTotals:dailyRows,settings_used_snapshot:[{payType:'commission',commissionRate:60,checkRate:50,taxRate:0,effectiveFrom:'2026-10-16'}]};
const row={businessDate:'2026-10-29',actualIncome:120,actualTipIncome:12,posIncome:120,tips:12,cashAmount:120,creditCardAmount:0,otherAmount:0,difference:0,tipDifference:0,manualInputIncome:null,staffProduction:120,staffCommissionPay:72,staffNetPay:72,tipsPaid:12,staffObligation:84,taxWithheld:0,shopShare:48,shopNetIncome:48,overShortStatus:'balanced',corrections:[]};
const summary={totalActualIncome:120,totalActualTip:12,cashAmount:120,creditCardAmount:0,otherAmount:0,totalStaffObligation:84,staffNetPay:72,tipsPaid:12,taxWithheld:0,shopNetIncome:48,correctionCount:0,posIncome:120,staffProduction:120,staffCommissionPay:72,shopShare:48,tips:12};
const root=createRoot(document.getElementById('root'));
window.renderPayroll=async(next={})=>{
 const query=new URLSearchParams(location.search),params=Object.fromEntries(query.entries()),all=params.access!=='staff',empty=params.empty==='1';
 const history=params.mode==='metadata'?[events[6]]:params.mode==='plain'?[event(9,'ticket',{}, {ticket_number:'T00045',service_total:50,tip_amount:0},{event_action:'created'}),event(10,'payroll_period_staff_inputs',{}, {bonus_amount:0})]:events;
 const data={access:{canViewAllPayroll:all,canManagePayroll:false},period,today:'2026-10-31',context:{user:{id:id(97)}},history:next.history??history,serviceAnalytics:{rows:[],ticketCount:1},staffPayrollSettings:[],salonPayrollSetting:{cycle_type:'semi_monthly'},scheduleSetup:{needsBiweeklyAnchor:false},difference:{changed:false},taxCompany:{lines:[]},recordedFacts:{status:'available',selection:{start:period.startDate,end:period.endDate,exact:true},periods:[{base:null,sourcePeriod:{start:period.startDate,end:period.endDate,cycle:'semi_monthly'},revision:2,adjustments:[],legacyPaidHistory:[],payments:[{id:id(40),staff_id:staff,cash_amount:20,check_amount:20,paid_at:'2026-11-01T18:00:00Z',note:'Payment for October 16–31'}]}]},live:{lines:empty?[]:[line],shopDailyRows:[row],shopSummary:summary}};
 window.__payrollFixture={data,salonId:salon,owner:all};
 const element=params.runtime==='native'?<AppLocalOwnerPayrollView value={{payroll:data,salonId:salon,payrollScope:'owner:salon',canManageConnection:all,taxPlugin:null,downloadEnabled:true}} params={params}/>:await PayrollPage({searchParams:Promise.resolve(params)});
 root.render(element);document.body.dataset.runtime=params.runtime||'web';
};window.addEventListener('popstate',()=>window.renderPayroll());window.renderPayroll();`;

export function payrollContextBoundaryPlugin(){return{name:'authenticated-backend-and-router-only',setup(b){
 // Resolvers deliberately match module boundaries, not UI children.
 b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'payroll-boundary'}));
 b.onResolve({filter:/^next\/(navigation|link)$/},({path})=>({path,namespace:'payroll-boundary'}));
 for(const path of ['lib/payroll','lib/current-context','lib/route-context-guards','lib/tax-company','lib/market-plugins','components/experience-page','lib/supabase/browser'])b.onResolve({filter:new RegExp('(?:@/|/)'+path+'$')},()=>({path,namespace:'payroll-boundary'}));
 b.onResolve({filter:/(?:^|\/)(?:actions|ledger-actions|staff-day-financial-actions|data-download-actions)$/},args=>{
  const file=args.path.startsWith('@/')?resolve(args.path.slice(2)+'.ts'):resolve(dirname(args.importer),args.path+'.ts');
  return{path:file,namespace:'payroll-actions'};
 });
 b.onLoad({filter:/.*/,namespace:'payroll-actions'},({path})=>{
  const text=readFileSync(path,'utf8'),names=[...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)/g)].map(match=>match[1]??match[2]);
  return{contents:names.map(name=>`export const ${name}=async()=>{throw Error('Unexpected financial mutation: ${name}');};`).join('\n'),loader:'js'};
 });
 b.onLoad({filter:/.*/,namespace:'payroll-boundary'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:
  path==='language'?`import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='div',children,...props})=>React.createElement(as,props,children);export const useWorkspaceTranslation=()=>text=>text;`:
  path==='next/navigation'?`const navigate=(url)=>{const next=new URL(url,location.href);history.pushState({},'',next);dispatchEvent(new PopStateEvent('popstate'));};export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>({push:navigate,replace:navigate,refresh(){}});export const usePathname=()=>location.pathname;`:
  path==='next/link'?`import React from'react';export default function Link({children,scroll,prefetch,replace,onClick,...props}){return <a {...props} onClick={event=>{onClick?.(event);if(event.defaultPrevented)return;const next=new URL(props.href,location.href);if(next.pathname==='/payroll'){event.preventDefault();history.pushState({},'',next);dispatchEvent(new PopStateEvent('popstate'));}}}>{children}</a>}`:
  path==='lib/payroll'?`export const getPayrollPageData=async()=>window.__payrollFixture.data;`:
  path==='lib/current-context'?`export const isOwnerMembership=membership=>membership?.role==='OWNER';`:
  path==='lib/route-context-guards'?`export const requireSalonManagePageContext=async()=>({currentSalon:{id:window.__payrollFixture.salonId},currentMembership:{role:window.__payrollFixture.owner?'OWNER':'STAFF'}});`:
  path==='lib/tax-company'?`export const taxCompanySettings=async()=>({active:true});`:
  path==='lib/market-plugins'?`export const payrollDataPluginInstalled=async()=>true;`:
  path==='components/experience-page'?`export const withExperiencePage=page=>page;`:
  `export const createSupabaseBrowserClient=()=>null;`
 }));
}};}
