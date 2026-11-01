import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.OWNER_ATTENTION_PLAYWRIGHT_PATH ?? 'playwright-core');
const postcss=require('postcss'),tailwind=require('@tailwindcss/postcss');
const out=path.resolve('artifacts/owner-financial-attention/browser');await fs.mkdir(out,{recursive:true});
const sid='10000000-0000-4000-8000-000000000001';
const items=[
 {item_key:'closing:2026-10-31:abc',kind:'closing',business_date:'2026-10-31',occurred_at:'2026-11-01T04:00:00Z',label:'Closing Oct 31 needs review',detail:'Yesterday ended without a review of the current figures.',target_href:'/reports?date=2026-10-31',ignored:false,facts:{tickets:[],visits:[],report:{entered:false}}},
 {item_key:'event:edit1',kind:'ticket_change',business_date:'2026-11-01',occurred_at:'2026-11-01T16:05:00Z',label:'Ticket T00048 changed',detail:'Recorded by Counter POS. Review the saved before and after values.',target_href:'/pos-tickets/ticket1',ignored:false,facts:{actor:'Counter POS',note:'Corrected service amount',before:{service_total:50,discount_amount:0,recorded_payment_total:50},after:{service_total:45,discount_amount:0,recorded_payment_total:50}}},
 {item_key:'discount:disc1',kind:'discount',business_date:'2026-11-01',occurred_at:'2026-11-01T16:10:00Z',label:'Ticket T00047 discount',detail:'Customer discount: $0.00 → $10.00',target_href:'/pos-tickets/ticket2',ignored:false,facts:{actor:'Counter POS',before:{service_total:50,discount_type:'fixed_amount',discount_value:0,discount_amount:0,recorded_payment_total:50},after:{service_total:50,discount_type:'fixed_amount',discount_value:10,discount_amount:10,recorded_payment_total:40}}},
 {item_key:'visit:visit1:abc',kind:'checkin',business_date:'2026-10-31',occurred_at:'2026-10-31T20:00:00Z',label:'Anna · check-in/payment needs matching',detail:'No ticket is linked to this visit. Check receipts before concluding payment is missing.',target_href:'/pos-tickets?date=2026-10-31',ignored:false,facts:{customerName:'Anna',visitStatus:'waiting',checkedInAt:'2026-10-31T20:00:00Z',possibleTickets:[]}}
];
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{TodayDashboardView}from'./app/staff/today/today-dashboard-view';import{AttentionDetail}from'./app/staff/today/attention-detail';
const metric=(label,value,detail)=>({label,value,detail,href:null,chart:null,trend:null,restricted:false});
const dashboard={salonId:'${sid}',salonName:'King Nails Spa LLC',date:'2026-11-01',timezone:'America/Chicago',greetingName:'Nene',generatedAt:'2026-11-01T16:20:00Z',noAccess:false,loadErrors:[],attention:[],pendingSections:{sections:[],metrics:[],details:false},dayView:{isCurrentDate:true,currentDate:'2026-11-01',selectedDate:'2026-11-01'},permissions:{canViewBookings:true,canViewReports:true,canViewTickets:true,canViewStaffFinancials:true,canViewDashboard:true},summary:{sales:metric('Sales Today','$0.00','No sales yet today'),customers:metric('Appointments','0','No appointments on this day'),waiting:metric('Waiting','0','No clients waiting right now'),staff:metric('Staff Working','0','No staff checked in right now')},rightNow:{waitingClients:[],upcomingBookings:[],scheduleHref:null},team:[],performance:{bookingStatus:{active:0,completed:0,upcoming:0},emptyLabel:'No activity yet today',salesTrend:[],staffBars:[],sales:null},quickAccesses:{available:[],selected:[]},businessHours:{buckets:[],opensAtLocal:'09:00',closesAtLocal:'19:00',date:'2026-11-01',isClosed:false,isFallback:false}};
const params=new URLSearchParams(location.search),item=${JSON.stringify(items)}.find(x=>x.item_key===params.get('item'));
createRoot(document.getElementById('root')).render(<><div className="salon"><b>♛ King Nails Spa LLC</b><span>REYLUMI</span></div>{item?<main style={{padding:16}}><a href="/">← Today</a><AttentionDetail data={{salonId:'${sid}',viewerId:'owner',today:'2026-11-01',timezone:'America/Chicago',total:4,items:[item]}} item={item}/></main>:<TodayDashboardView dashboard={dashboard} isOwner/>}<nav className="bottom">Today　 Book　 Profile　 Reports　 More</nav></>);`;
const mocks={
 'next/link':`export default function Link({href,children,...p}){return <a href={typeof href==='string'?href:'#'} {...p}>{children}</a>}`,
 'next/navigation':`export const useRouter=()=>({refresh(){}});`,
 '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',text,children,...props})=><Tag {...props}>{text??children}</Tag>;`,
 '@/components/navigation-form':`export const NavigationForm=({children,...p})=><form {...p}>{children}</form>;export const NavigationSubmitButton=({children,...p})=><button {...p}>{children}</button>;`,
 '@/app/payroll/inline-financial-history':`export const useFinancialHistoryContext=()=>({changes:[],loading:false,error:''});`,
 '@/components/owner-market-promo':`export const OwnerMarketPromo=()=>null;`,
 '@/app/staff/today/quick-access-editor':`export const QuickAccessPanel=()=>null;`,
 './today-inline-tickets':`export const TodayInlineTickets=()=>null;`
};
await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',outfile:path.join(out,'fixture.js'),jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},loader:{'.css':'local-css'},plugins:[{name:'preview-boundaries',setup(b){b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const css=await postcss([tailwind()]).process(await fs.readFile('app/globals.css','utf8'),{from:path.resolve('app/globals.css')});await fs.writeFile(path.join(out,'global.css'),css.css);
const ignored=new Set();let fail=false;
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url.startsWith('/api/owner-attention')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const b=req.method==='GET'?{op:'read',...Object.fromEntries(new URL(req.url,'http://localhost').searchParams)}:JSON.parse(Buffer.concat(chunks).toString());res.setHeader('Content-Type','application/json');
   if(fail){res.statusCode=503;return res.end(JSON.stringify({error:'Financial checks could not load. Please retry.'}));}
   if(b.salonId!==sid){res.statusCode=409;return res.end('{}');}
   if(b.op==='ignore'||b.op==='review_closing'){ignored.add(b.item);return res.end('{"ok":true}');}
   const rows=items.filter(x=>!ignored.has(x.item_key));return res.end(JSON.stringify({salonId:sid,viewerId:'owner',today:'2026-11-01',timezone:'America/Chicago',total:rows.length,items:rows}));
  }
  if(req.url==='/api/shop-money'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({salonId:sid,today:'2026-11-01'}));}
  const name=req.url.split('?')[0].slice(1);
  if(['fixture.js','fixture.css','global.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');return res.end(await fs.readFile(path.join(out,name)));}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#18181b;background:white;padding-bottom:70px}#root{max-width:1000px;margin:auto}main{padding-inline:16px!important}.salon{padding:24px 16px;display:flex;justify-content:space-between;border-bottom:1px solid #eee}.salon span{color:#178179;font-weight:bold}.bottom{position:fixed;bottom:0;background:white;border-top:1px solid #eee;padding:22px 8px;width:100%;text-align:center;color:#71717a;font-size:13px}button,a{touch-action:manipulation}dialog::backdrop{background:#0005}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
 }catch(e){res.statusCode=500;res.end(String(e));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const results=[];
try{
 for(const width of [320,390,430,768,1280]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByText('4 to review',{exact:true}).waitFor();
  assert.equal(await page.getByText('Day view',{exact:true}).count(),0);assert.equal(await page.getByText('Expense list',{exact:true}).count(),0);
  const expense=page.getByRole('button',{name:'+ Expense',exact:true});await expense.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const link of await page.getByRole('link',{name:'View details',exact:true}).all()){
   const geometry=await link.evaluate(el=>{const card=el.closest('article'),r=el.getBoundingClientRect(),c=card.getBoundingClientRect(),s=el.querySelector('span').getBoundingClientRect();return {right:c.right-r.right,height:r.height,visual:s.height,width:s.width};});
   assert.ok(geometry.right<=20&&geometry.right>=0);assert.ok(geometry.height>=44);assert.ok(geometry.visual<32&&geometry.width<=78);
  }
  const groups=await page.locator('main .content-surface').evaluateAll(els=>els.map(el=>({shadow:getComputedStyle(el).boxShadow,borderImage:getComputedStyle(el).borderImageSource,border:getComputedStyle(el).borderTopWidth})));
  assert.ok(groups.length>0);for(const group of groups){assert.notEqual(group.shadow,'none');assert.equal(group.borderImage,'none');assert.equal(group.border,'0px');}
  await page.screenshot({path:path.join(out,`today-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);results.push({width,overflow:false,errors});await page.close();
 }
 const page=await browser.newPage({viewport:{width:390,height:950}});await page.goto(origin);await page.getByText('4 to review',{exact:true}).waitFor();await page.getByRole('button',{name:'Ignore',exact:true}).first().click();await page.getByText('3 to review',{exact:true}).waitFor();await page.reload();await page.getByText('3 to review',{exact:true}).waitFor();assert.equal(await page.getByText('Closing Oct 31 needs review',{exact:true}).count(),0);
 items.push({...items[1],item_key:'event:edit2',label:'Ticket T00048 changed again'});await page.reload();await page.getByText('Ticket T00048 changed again',{exact:true}).waitFor();
 await page.getByRole('link',{name:'View details',exact:true}).nth(1).click();await page.getByRole('columnheader',{name:'Before',exact:true}).waitFor();assert.match(await page.locator('body').innerText(),/\$10\.00/);await page.screenshot({path:path.join(out,'discount-detail-390.png'),fullPage:true});
 fail=true;await page.goto(origin);await page.getByText('Check unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('No financial items awaiting review.',{exact:true}).count(),0);
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({viewports:results,ignoreSurvivesReload:true,newEditAppears:true,exactDiscountDetail:true,failedReadNeverClear:true},null,2));console.log('PASS: 5 widths, expense dialog/Escape, no date/list, persistent ignore reload, new event, exact detail, failure state');
}finally{await browser.close();await new Promise(r=>server.close(r));}
