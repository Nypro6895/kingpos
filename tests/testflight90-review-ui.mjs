import {build} from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const out='artifacts/testflight90-review';
const mocks={
 'next/link':'export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}',
 'next/navigation':'export const useRouter=()=>({replace(){},push(){},refresh(){}});',
 '@/components/workspace-language':'export const useWorkspaceTranslation=()=>value=>value;export const WorkspaceText=({text})=><>{text}</>;',
 '@/components/rewardlumi/visit-rewards':'export const VisitRewards=()=>null;',
 '@/components/rewardlumi/visit-gift-cards':'export const VisitGiftCards=()=>null;',
 '@/components/qr-code-tile':'export const QrCodeTile=()=>null;',
 '@/app/staff/scan/qr-scanner':'export const StaffQrScanner=()=>null;',
 './actions':'export const loadPersonalQr=async()=>({data:globalThis.__qr});export const loadPersonalQrCatalog=async()=>({});export const checkinPersonalQr=async()=>({});',
};
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{ClosingBalanceSummary}from'./app/reports/closing-balance-summary';import{SchedulePicker}from'./components/booking-ui/schedule-picker';import{PersonalQrClient}from'./app/qr/personal-qr-client';
const receipt={ticketId:'ticket-1',ticketNumber:'1042',openedAt:'2026-11-05T06:50:00Z',closedAt:'2026-11-05T07:10:00Z',status:'closed',currency:'USD',discountType:'fixed_amount',discountValue:0,taxRate:0,tipType:'fixed_amount',tipValue:0,services:[{id:'line-1',name:'Manicure',quantity:1,unitPrice:220,lineTotal:220,staffName:'Nene'}],payments:[{amount:220}]};
globalThis.__qr={userId:'user-1',code:'test-only',expiresAt:'2099-01-01Z',updatedAt:'2026-11-05T07:10:00Z',visits:[{visitId:'visit-1',salonId:'salon-1',salonName:'Fixture Nail Studio',checkedInAt:'2026-11-05T06:50:00Z',queueNumber:null,status:'paid',ticketId:'ticket-1',receipt,requestedServices:[],lines:[],workingStaff:[],ready:null}]};
const path=new URLSearchParams(location.search).get('view');const values={cashAmount:'',creditCardAmount:'',otherAmount:'',note:'',tipInput:'',serviceEntered:false};
createRoot(document.getElementById('root')).render(path==='qr'?<PersonalQrClient viewerId='user-1' initial={globalThis.__qr}/>:<main style={{padding:20,maxWidth:500,margin:'auto'}}><h1 style={{fontSize:24,marginBottom:20}}>{path==='calendar'?'Booking calendar':path==='past'?'Ended business date':'Current business date'}</h1>{path==='calendar'?<SchedulePicker date='2026-11-05' today='2026-11-05' range='day' status='' onChange={()=>{}} loadCounts={async(month)=>({counts:{[month+'-05']:3,[month+'-11']:1}})}/>:<ClosingBalanceSummary values={values} expectedService={220} expectedTip={0} isPastDate={path==='past'}/>}</main>);`;
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},jsx:'automatic',bundle:true,platform:'browser',format:'iife',outfile:'preview.js',write:false,plugins:[{name:'fixture-boundaries',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=fs.readFileSync('ios/Reylumi/LocalAppBundle/app.css','utf8')+'\n'+fs.readFileSync('app/globals.css','utf8').split('/* Shared interface chrome;')[1]+'\n'+(result.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/preview.js'?'text/javascript':req.url==='/preview.css'?'text/css':'text/html');res.end(req.url==='/preview.js'?js:req.url==='/preview.css'?css:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><div id="root"></div><script src="/preview.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});const base='http://127.0.0.1:'+server.address().port;
 for(const view of ['current','past','calendar','qr']){await page.goto(base+'?view='+view);await page.waitForSelector('h1',{timeout:10000});if(view==='current'){await page.getByText('Pending close').first().waitFor();assert.equal(await page.getByText('Short',{exact:true}).count(),0);}if(view==='past'){await page.getByText('$220.00').first().waitFor();assert.match(await page.textContent('body'),/Short/);}if(view==='calendar'){await page.locator('[aria-current="date"]').waitFor();await page.getByLabel('3 bookings',{exact:true}).waitFor();}if(view==='qr'){await page.getByText('#1042 ·',{exact:false}).waitFor();assert(!((await page.textContent('body')).includes('#—')));assert.match(await page.textContent('body'),/\$220\.00/);}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/'+view+'-390.png',fullPage:true});}
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/visual-check.json',JSON.stringify({passed:true,width:390,views:['current','past','calendar','qr'],errors},null,2));console.log('Four 390px component previews passed: neutral/current, short/past, today/calendar markers, receipt metadata.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
