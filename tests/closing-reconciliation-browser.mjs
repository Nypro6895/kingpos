import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {chromium} from 'playwright-core';

const out='artifacts/history-input-reconciliation/closing';fs.mkdirSync(out,{recursive:true});
const contents=`
import React from 'react';import {createRoot} from 'react-dom/client';
import {DailyClosingForm} from './app/reports/daily-closing-form';
import styles from './app/reports/reports.module.css';
import {PortableReportClosingForm} from './app/pos/portable/report/portable-report-closing-form';
import {DailyReconciliationCases} from './app/reports/daily-reconciliation-cases';
const q=new URLSearchParams(location.search),portable=q.has('portable'),missing=q.has('missing');
const salonId='20000000-0000-4000-8000-000000000001',viewer='10000000-0000-4000-8000-000000000001',date='2026-10-28';
const inputs={cashAmount:missing?0:90,creditCardAmount:0,otherAmount:0,tipInput:missing?null:20,entered:!missing,note:null,status:'draft',approvedAt:null,closedAt:null};
let current={revision:1,reportDate:date,locked:false,closingInputs:inputs};const receipts=new Map();window.fixtureRequests=[];window.fixtureUnexpected=[];
const facts={businessDate:date,expectedService:90,expectedTip:20,actualService:100,actualTip:10,serviceDifference:10,tipDifference:-10};
window.fetch=async(url,init={})=>{
 if(String(url).startsWith('/api/reports/reconciliation-cases')){if(String(url).includes('000000000002')){await new Promise(r=>setTimeout(r,100));return Response.json({rows:[]});}return Response.json({rows:[{id:'case-private-id',business_date:date,revision:1,status:'mixed',latest_values:facts,revisions:[{revision:1,values:facts,created_at:'2026-10-29T05:00:00Z'}]}]});}
 if(String(url).startsWith('/api/pos/closing')){
  if(init.method==='POST'){const body=JSON.parse(init.body);window.fixtureRequests.push(body);current={...current,revision:current.revision+1,closingInputs:{...current.closingInputs,...body.values,entered:body.values.serviceEntered}};receipts.set(body.requestId,current);return Response.json({ok:true,current,receipt:current,requestId:body.requestId,scope:salonId+':'+viewer});}
  return Response.json({ok:true,current,scope:salonId+':'+viewer});
 }
 window.fixtureUnexpected.push(String(url));throw Error('Unexpected fixture request');
};
const portableData={closingScope:salonId+':device',closingInputs:inputs,lock:{isLocked:false,status:'draft'},reportDate:date,salonName:'Sample Salon',setupMessage:null,timezone:'America/Chicago',totals:{actualTotal:90,expectedTotal:90,expectedTip:20,tips:20,discounts:10,difference:0,reconciliationStatus:'balanced',serviceCount:1,ticketCount:1,finalizedTicketCount:1,taxes:0}};
window.fixturePortableSave=async(input)=>{window.fixtureRequests.push(input);const blank=x=>String(x??'').trim()==='';return {ok:true,data:{...portableData,closingInputs:{...inputs,cashAmount:Number(input.cashAmount||0),creditCardAmount:Number(input.creditCardAmount||0),otherAmount:Number(input.otherAmount||0),tipInput:blank(input.tipInput)?null:Number(input.tipInput),entered:[input.cashAmount,input.creditCardAmount,input.otherAmount].some(x=>!blank(x)),note:input.note||null}}}};
function CaseScopeFixture(){const [salon,setSalon]=React.useState(salonId);return <><button onClick={()=>setSalon('20000000-0000-4000-8000-000000000002')}>Switch salon</button><DailyReconciliationCases salonId={salon} startDate={date} endDate={date}/></>}
createRoot(document.getElementById('root')).render(<main className={styles.page} style={{maxWidth:960,margin:'0 auto',padding:16}}><p style={{fontSize:12,color:'#666'}}>Local component fixture · sample data</p>{q.has('scope')?<CaseScopeFixture/>:portable?<PortableReportClosingForm data={portableData}/>:<DailyClosingForm salonId={salonId} scope={salonId+':'+viewer} canEdit={true} closingInputs={inputs} corrections={{requests:[],adjustments:[]}} expectedTotal={90} expectedTip={20} lock={{isLocked:false,isPastDate:true,currentBusinessDate:'2026-10-29',status:'draft',liveTotalsDifferFromSnapshot:false}} reportDate={date}/>}</main>);
`;
const replacements={
 'next/navigation':`export const usePathname=()=>'/pos/portable/report';export const useRouter=()=>({refresh(){}});export const useSearchParams=()=>new URLSearchParams(location.search);`,
 '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`,
 '@/lib/pos-workspace-sync':`export const usePosResourceRefresh=()=>{};`,
 '@/lib/portable-operations':`export const listPortableOperations=async()=>[];export const PORTABLE_OPERATIONS_CHANGED='fixture:operations';`,
 '@/lib/portable-device-storage':`export const portableDeviceStorage={getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)};`,
 '@/app/pos/portable/portable-workspace-state':`export const usePortableWorkspaceState=()=>({scope:'20000000-0000-4000-8000-000000000001:device',businessDate:'2026-10-28'});`,
 '@/app/pos/portable/actions':`export const savePortableReportClosing=input=>window.fixturePortableSave(input);export const getPortableReportInputHistory=async()=>({rows:[]});`,
 './daily-report-history':`export const DailyReportChangeHistory=()=>null;`,
};
const bundle=await build({write:false,bundle:true,platform:'browser',format:'iife',outfile:'fixture.js',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents},plugins:[{name:'isolated-fixture-transport',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:replacements[a.path]}));}}]});
const sources=['app/reports/daily-closing-form.tsx','app/reports/closing-balance-summary.tsx','app/reports/daily-reconciliation-cases.tsx','app/reports/owner-closing-save-notice.tsx','app/reports/closing-save-notice.tsx','app/pos/portable/report/portable-report-closing-form.tsx'];
const compiler=await compile('@import "tailwindcss";',{base:process.cwd(),onDependency(){}});const tailwind=compiler.build(sources.flatMap(f=>fs.readFileSync(f,'utf8').split(/[\s"'`<>={}]+/)));
const style=tailwind+'\n'+bundle.outputFiles.filter(x=>x.path.endsWith('.css')).map(x=>x.text).join('\n');const script=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text;
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html; charset=utf-8');res.end(req.url==='/fixture.js'?script:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'body{margin:0;background:#fff;color:#222;font-family:Arial,sans-serif}input,textarea{max-width:100%}</style><div id="root"></div><script src="/fixture.js"></script>');});
await new Promise(r=>server.listen(6102,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();await page.addInitScript(()=>sessionStorage.clear());const errors=[];page.on('pageerror',e=>errors.push(e.message));const checks=[];
 for(const portable of [false,true])for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:6102/?'+(portable?'portable&':'')+'missing');await page.getByText('Tip input',{exact:true}).waitFor();
  await page.waitForTimeout(75);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+portable+' '+width);
  assert.equal(await page.getByText('Not entered',{exact:true}).count(),portable?5:4);assert.equal(await page.locator('input[placeholder="Not entered"]').inputValue(),'');
  await page.screenshot({path:out+'/'+(portable?'portable':'owner')+'-missing-'+width+'.png',fullPage:true});checks.push({portable,width,overflow:false,missingTipPreserved:true});
 }
 for(const portable of [false,true]){
  await page.goto('http://127.0.0.1:6102/?'+(portable?'portable&':'')+'save');await page.getByText('Tip input',{exact:true}).waitFor();await page.waitForTimeout(75);
  const tip=page.locator('input[placeholder="Not entered"]');await tip.fill('0');await tip.press('Tab');await page.waitForFunction(()=>window.fixtureRequests.length>0);await page.getByText('Saved',{exact:true}).waitFor();
  const sent=await page.evaluate(()=>window.fixtureRequests[0]);assert.equal(portable?sent.tipInput:sent.values.tipInput,portable?'0.00':0);assert.ok(await tip.inputValue()!=='');
  if(!portable){assert.equal(sent.values.cashAmount,90);assert.equal(sent.values.serviceEntered,true);assert.equal(await page.getByText('Daily reconciliation reports',{exact:true}).count(),0);assert.equal(await page.getByText('Previous automatic checks',{exact:false}).count(),0);assert.equal(await page.getByText('case-private-id',{exact:false}).count(),0);}
  checks.push({portable,tipZeroSaved:true});
 }
 await page.goto('http://127.0.0.1:6102/?scope');await page.getByText('2026-10-28 · Review required',{exact:false}).waitFor();await page.getByRole('button',{name:'Switch salon'}).click();assert.equal(await page.getByText('2026-10-28 · Review required',{exact:false}).count(),0);await page.waitForTimeout(150);assert.equal(await page.getByText('2026-10-28 · Review required',{exact:false}).count(),0);checks.push({caseScopeSwitchClearsPreviousRows:true});
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.fixtureUnexpected),[]);fs.writeFileSync(out+'/browser-results.json',JSON.stringify({passed:true,layer:'Actual React components with isolated fixture transport; no production data',checks,errors},null,2));console.log(JSON.stringify({passed:true,checks,errors}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
