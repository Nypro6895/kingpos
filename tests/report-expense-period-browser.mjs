import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

let browser, server, origin;
const evidence = 'artifacts/iphone-quality-audit-20261103/expense-period-ui';
const browserPath = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
before(async () => {
  if (!browserPath) return;
  const result = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import{OwnerLiveReports}from'./app/reports/owner-live-reports';import{ShopMoneyWorkspace}from'./app/payroll/shop-money-workspace';
import{staffPeriodAt}from'./lib/staff-payroll-period';import{payrollRailChoices}from'./lib/payroll-period-rail';
import{useSearchParams,usePathname}from'next/navigation';
const setting={id:'setting',salon_id:'salon',cycle_type:'biweekly',biweekly_anchor_date:'2026-10-26',created_at:'',updated_at:''};
window.h={requests:[],pending:new Map(),automatic:true};
const expense=(day,amount)=>({id:day,salon_id:'salon',business_date:day,paid_at:day+'T18:00:00Z',amount,note:'Supplies '+day,source:'cash',category:'supplies',revision:1});
window.fetch=async(url,options={})=>{if(!String(url).startsWith('/api/shop-money'))throw Error('Unexpected read '+url);if(options.method)throw Error('Writes forbidden');const q=new URL(url,location.origin).searchParams,key=q.get('start');h.requests.push({salon:q.get('salonId'),start:key,end:q.get('end')});return new Promise(resolve=>{const release=()=>resolve({ok:true,json:async()=>({salonId:q.get('salonId'),today:'2026-11-03',timezone:'America/Chicago',days:[],collections:[],gifts:[],redemptions:[],rewards:[],discounts:[],history:[],legacy:[],giftClosing:0,giftOpening:0,rewardActivity:[],giftActivity:[],expenses:key==='2026-10-26'?[expense('2026-11-01',100),...(new URLSearchParams(location.search).has('tax')?[{...expense('2026-11-02',25),category:'tax_payment'}]:[])]:[expense('2026-10-20',40)]})});h.pending.set(key,release);if(h.automatic)release();});};
function App(){const query=useSearchParams().toString(),path=usePathname(),period=staffPeriodAt(setting,new URLSearchParams(query).get('expensePeriodStart')||'2026-11-03'),choices=payrollRailChoices(period,setting);if(path==='/legacy-expenses')return <ShopMoneyWorkspace salonId="salon" start="2026-10-26" end="2026-11-08" view="expenses"/>;const report={reportDate:'2026-11-03',lock:{isLocked:false},staffRows:[],totals:{},metadata:{},adjustmentTotals:{},corrections:[]};return <OwnerLiveReports managedRead query={query} viewerId="owner" salonId="salon" salonName="Fixture" today="2026-11-03" report={report} reportOverview={{range:{startDate:'2026-11-03',endDate:'2026-11-03',timeZone:'America/Chicago',preset:'custom'}}} canEdit={false} canApplyCorrection={false} canRequestCorrection={false} expensePeriod={{period,months:[],periods:choices.periods,needsAnchor:false}}/>;}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',outfile:'fixture.js',plugins:[{name:'read-only-reports-boundaries',setup(b){
    b.onResolve({filter:/^next\/(navigation|link)$|workspace-language$|experience-scope$|experience-resource-cache$|fetch-workspace-resource$|use-experience-resource$|pos-workspace-sync$|daily-closing-form$|daily-accounting-overview$|staff-day-financial-editor$|inline-financial-history$|contextual-support$|workspace-navigation-icon$|compact-filters$|report-ui$|place-ui$|^\.\/payroll-edit-boundary$/},({path})=>({path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({loader:'tsx',resolveDir:process.cwd(),contents:
      path==='next/navigation'?`import{useSyncExternalStore}from'react';const sub=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)};export const usePathname=()=>useSyncExternalStore(sub,()=>location.pathname);export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(sub,()=>location.search));export const useRouter=()=>({push:href=>{history.pushState(null,'',href);dispatchEvent(new PopStateEvent('popstate'));dispatchEvent(new HashChangeEvent('hashchange'))},refresh:()=>{}});`:
      path==='next/link'?`export default function Link({href,children,onClick,...props}){return <a {...props} href={href} onClick={e=>{e.preventDefault();onClick?.(e);history.pushState(null,'',href);dispatchEvent(new PopStateEvent('popstate'));dispatchEvent(new HashChangeEvent('hashchange'));}}>{children}</a>}`:
      path.endsWith('workspace-language')?'export const WorkspaceText=({text})=><>{text}</>;export const useWorkspaceTranslation=()=>s=>s;':
      path.endsWith('experience-scope')?'export const useExperienceScope=()=>({context:{scope:"fixture-scope"}});':
      path.endsWith('experience-resource-cache')?'export const experienceResourceCache={get:()=>null,isAvailable:()=>true};':
      path.endsWith('use-experience-resource')?'export const useExperienceResource=({initialData})=>({available:true,data:initialData});':
      path.endsWith('fetch-workspace-resource')?'export const fetchWorkspaceResource=()=>()=>{throw Error("Unexpected report refresh")};':
      path.endsWith('pos-workspace-sync')?'export const usePosResourceRefresh=()=>{};':
      path.endsWith('daily-closing-form')?'export const DailyClosingForm=({children})=><>{children}</>;':
      path.endsWith('daily-accounting-overview')?'export const DailyAccountingOverview=()=>null;export const DailyAccountingDate=()=> <span>Daily date control</span>;':
      path.endsWith('staff-day-financial-editor')?'export const StaffDayFinancialEditor=()=>null;':
      path.endsWith('inline-financial-history')?'export const FinancialHistoryProvider=({children})=><>{children}</>;export const InlineFinancialHistory=()=>null;export const inlineHistoryEditedClassName="";export const useFinancialHistoryContext=()=>({changes:[]});export const financialHistoryForObject=()=>[];':
      path.endsWith('contextual-support')?'export const ContextualSupport=()=>null;':
      path.endsWith('workspace-navigation-icon')?'export const WorkspaceNavigationIcon=()=> <span/>;':
      path.endsWith('compact-filters')?'export const CompactFilters=({children})=><div>{children}</div>;':
      path.endsWith('report-ui')?'export const ReportIcon=()=> <span/>;export const ReportDetails=({children})=><div>{children}</div>;':
      path.endsWith('payroll-edit-boundary')?'export const usePayrollEdits=()=>({blocked:false});':
      'export const inputClass="";export const primaryButton="";'
    }));
  }}]});
  const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
  server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js);}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css);}else {res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*{box-sizing:border-box}</style><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:browserPath,headless:true});mkdirSync(evidence,{recursive:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
test('actual Reports Expenses keeps period/list/total aligned through pending and reversed replies at iPhone width', {skip:!browserPath}, async t=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});page.setDefaultTimeout(5000);t.after(()=>page.close());const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/reports?date=2026-11-03#expenses');await page.getByRole('heading',{name:'Expenses paid',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Expenses',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByText('Daily date control',{exact:true}).isVisible(),false);
  await page.getByText('$100.00',{exact:true}).first().waitFor();
  assert.equal(await page.getByText('Fixed rent',{exact:true}).count(),0,'Compact Reports omits monthly rent controls outside its selected payroll range');
  assert.equal(await page.getByRole('button',{name:'+ Add',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Edit Supplies 2026-11-01',exact:true}).isVisible(),true);
  await page.screenshot({path:evidence+'/expenses-current-428.png',fullPage:true});
  await page.evaluate(()=>{h.automatic=false;});await page.getByRole('button',{name:'Previous pay period',exact:true}).click();
  await page.getByText('Loading shop money…',{exact:true}).waitFor();assert.equal(await page.getByText('$100.00',{exact:true}).count(),0,'Old total leaves with old keyed period');
  assert.match(await page.locator('[aria-controls="report-expense-period-options"]').innerText(),/Oct 12, 2026.*Oct 25, 2026/);
  assert.match(page.url(),/expensePeriodStart=2026-10-12/);assert.match(page.url(),/#expenses$/);
  await page.getByRole('button',{name:'Next pay period',exact:true}).click();await page.waitForFunction(()=>h.requests.length===3);
  await page.evaluate(()=>h.pending.get('2026-10-26')());await page.getByText('$100.00',{exact:true}).first().waitFor();
  await page.evaluate(()=>h.pending.get('2026-10-12')());await page.waitForTimeout(50);
  assert.equal(await page.getByText('$40.00',{exact:true}).count(),0,'Late previous-period response cannot replace current data');
  assert.match(await page.locator('[aria-controls="report-expense-period-options"]').innerText(),/Oct 26, 2026.*Nov 8, 2026/);
  await page.getByRole('button',{name:'Previous pay period',exact:true}).click();await page.waitForFunction(()=>h.requests.length===4);await page.evaluate(()=>h.pending.get('2026-10-12')());await page.getByText('$40.00',{exact:true}).first().waitFor();
  assert.equal(await page.getByText('$100.00',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Expenses',exact:true}).getAttribute('aria-pressed'),'true');
  await page.screenshot({path:evidence+'/expenses-previous-428.png',fullPage:true});
  const fit=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,requests:h.requests}));assert.ok(fit.scrollWidth<=fit.width+1,JSON.stringify(fit));assert.deepEqual(errors,[]);
  assert.deepEqual(fit.requests.map(r=>[r.salon,r.start,r.end]),[['salon','2026-10-26','2026-11-08'],['salon','2026-10-12','2026-10-25'],['salon','2026-10-26','2026-11-08'],['salon','2026-10-12','2026-10-25']]);
  writeFileSync(evidence+'/browser-evidence.json',JSON.stringify({passed:true,actualComponents:['OwnerLiveReports','ReportTabs','PayrollPeriodRail','ShopMoneyWorkspace','ExpensePanel'],scope:'Synthetic read-only boundary; Chromium428px, not physical iPhone',fit,errors},null,2));
});

test('legacy Payroll Expenses defaults keep rent, fee and history controls', {skip:!browserPath}, async t=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});t.after(()=>page.close());page.setDefaultTimeout(5000);
  await page.goto(origin+'/legacy-expenses');await page.getByRole('heading',{name:'Expenses paid',exact:true}).waitFor();
  for(const name of ['Fixed rent','Card fees','Expense edit history'])assert.equal(await page.getByRole('button',{name,exact:true}).isVisible(),true,name);
});
test('compact Reports keeps the original total including tax remittances and its tax note', {skip:!browserPath}, async t=>{
  const page=await browser.newPage({viewport:{width:428,height:926}});t.after(()=>page.close());page.setDefaultTimeout(5000);
  await page.goto(origin+'/reports?tax=1#expenses');await page.getByText('$125.00',{exact:true}).first().waitFor();
  assert.equal(await page.getByText('Tax payments reduce the tax reserve, not operating expenses.',{exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Fixed rent',exact:true}).count(),0);
});
