import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

test('unified Gift: actual Ticket, customer receipt, Report, Attention and completion components',{timeout:120000},async()=>{
 const contents=`import React from 'react';import{createRoot}from'react-dom/client';
 import{DailyPosTicketCard}from'./app/pos-tickets/closed-ticket-correction-form';
 import{CustomerCheckoutHeader,CustomerCheckoutReceipt}from'./app/pos/customer-display/customer-checkout';
 import{PosCollectionBreakdown}from'./components/pos-collection-breakdown';
 import{AttentionNotification}from'./app/staff/today/owner-attention-panel';
 import{GiftCompletion}from'./components/gift-card/gift-completion';
 import{DailyAccountingOverview}from'./app/reports/daily-accounting-overview';
 import{buildDailyReportOverview}from'./lib/daily-report-overview-model';
 const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),at='2026-11-13T18:00:00Z';
 const sale={id:id(8),amountCents:10000,last4:'4821',paymentMethod:'cash',status:'completed',actorName:'Kim',createdAt:at};
 const ticket={id:id(1),ticket_number:'T00024',created_at:at,opened_at:at,status:'closed',source_booking_id:null,customer:{id:id(2),name:'Linh',email:null,phone:null},discount_type:'percentage',discount_value:10,tip_type:'fixed_amount',tip_value:9,tax_rate:0,payments:[{amount:54,payment_method:'cash',created_at:at}],staff_earnings:[{staff_id:id(10),tip_amount:9,tip_is_manual:false,manual_tip_amount:null}],ticket_items:[{id:id(20),assigned_staff_id:id(10),assigned_staff:{id:id(10),display_name:'Kim'},service_id:id(30),service:{id:id(30),name:'Full Set'},service_name_snapshot:'Full Set',created_at:at,line_total:50,turn_parts:[{id:id(40),staff_id:id(10),amount:50,turn_index:1,turn_type:'large'}]}],financial_sources:{giftSales:[sale],giftRedeemedCents:0,rewardDiscount:0}};
 const only={...ticket,id:id(3),ticket_number:'T00025',customer:null,ticket_items:[],payments:[],staff_earnings:[],tip_value:0,financial_sources:{giftSales:[sale],giftRedeemedCents:0,rewardDiscount:0}};
 const gift={id:'gift',status:'open',total:5400,purchase:10000,amount:0,approved:false,expires:new Date(Date.now()+600000).toISOString()};
 const live={id:'draft',token:'fixture',salon_id:'salon',customer:{id:id(2),name:'Linh'},staff_lines:[{id:'line',label:'Full Set',staffName:'Kim',amount:50}],subtotal:50,discount:5,tax:0,tip:9,total:54,status:'draft'};
 const settings={customerShowServiceName:true,customerShowStaffName:true,customerShowReceiptStatus:true,customerShowSalonName:true,salonName:'King Nails Spa LLC',salonLogoUrl:null};
 const report={reportDate:'2026-11-13',closingInputs:{cashAmount:245,creditCardAmount:0,otherAmount:0},lock:{isPastDate:true},totals:{expectedTotal:245},staffRows:[{staffId:id(10),staffName:'Kim',totalTurns:1,totalEarned:50}]};
 const overview=buildDailyReportOverview({date:'2026-11-13',timeZone:'America/Chicago',tickets:[ticket,only],visits:[],workdays:[],report});
 const breakdown=<PosCollectionBreakdown service={50} gift={200} discount={5} reward={0} giftPaid={0} earnedTip={9} giftTipPaid={0} expected={245} expectedTip={9}/>;
 const mode=new URLSearchParams(location.search).get('screen')||'ticket';
 const selectedTicket=mode==='only'?only:mode==='named-only'?{...only,customer:ticket.customer}:mode==='reward'?{...ticket,discount_type:'fixed_amount',discount_value:10,payments:[{amount:49,payment_method:'cash',created_at:at}],financial_sources:{...ticket.financial_sources,rewardDiscount:5}}:mode==='gift-used'?{...ticket,discount_value:0,tip_value:10,staff_earnings:[{...ticket.staff_earnings[0],tip_amount:10}],payments:[{amount:25,payment_method:'gift_card',created_at:at},{amount:35,payment_method:'cash',created_at:at}],financial_sources:{giftSales:[],giftRedeemedCents:2500,rewardDiscount:0}}:mode==='split-payment'?{...ticket,financial_sources:{...ticket.financial_sources,giftSales:[{...sale,paymentMethod:'credit_card',actorName:'Different recording operator'}]}}:mode==='voided'?{...ticket,status:'voided',financial_sources:{...ticket.financial_sources,giftSales:[{...sale,status:'voided'}]}}:mode==='service-only'?{...ticket,financial_sources:{giftSales:[],giftRedeemedCents:0,rewardDiscount:0}}:ticket;
 const attention={salonId:'salon',viewerId:'owner',today:'2026-11-13',timezone:'America/Chicago',total:3,items:[]};
 const alerts=[{item_key:'gift-sale:one',kind:'gift_sale',label:'Gift sold · Ticket T00024',detail:'$100.00 · Card •••• 4821',target_href:'/pos-tickets/'+id(1)},{item_key:'gift-use:one',kind:'gift_use',label:'Gift used · Ticket T00026',detail:'$25.00 · Card •••• 1379',target_href:'/pos-tickets/'+id(4)},{item_key:'reward-use:one',kind:'reward',label:'Reward used · Ticket T00027',detail:'$5.00 · Service discount',target_href:'/pos-tickets/'+id(5)}].map(item=>({...item,business_date:'2026-11-13',occurred_at:at,ignored:false}));
 createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><p style={{fontSize:11,color:'#777',marginBottom:18}}>LOCAL QA · Synthetic transactions · actual product components</p>{mode==='checkout'?<div className='customer-checkout' style={{height:'auto'}}><CustomerCheckoutHeader settings={settings}/><CustomerCheckoutReceipt liveDraft={live} settings={settings} gift={gift} reward={null}/></div>:mode==='report'?<><DailyAccountingOverview overview={overview} report={report} onClosing={()=>{}}/><div style={{marginTop:24}}>{breakdown}</div></>:mode==='closing'?breakdown:mode==='today'?<section><h1 style={{fontSize:20,marginBottom:20}}>Needs Attention</h1>{alerts.map(item=><AttentionNotification key={item.item_key} data={attention} item={item}/>)}</section>:mode==='success'?<GiftCompletion session={{...gift,status:'completed',collected:true,ticketNumber:'T00024',completedAt:new Date().toISOString(),deliveryCard:{design:{background:'#f4ede3',color:'#415b50',image:'',logo:'',elements:[{kind:'text',id:'a',text:'King Nails Spa LLC',x:50,y:50,size:24}]}}}} staff onClose={()=>{}}/>:<DailyPosTicketCard actions={{correctClosedTicket:async()=>{throw Error('No financial writes allowed in this fixture')}}} businessDateCompactLabel='Nov 13' canApplyFinancialCorrection={true} canEdit={true} dailyNumber={mode==='only'?25:24} isBusinessDateLocked={false} returnTo='/pos-tickets' services={[{id:id(30),name:'Full Set'}]} staff={[{id:id(10),display_name:'Kim'}]} ticket={selectedTicket} timeZone='America/Chicago'/>}</main>);`;
 const replacements={
  '@/components/workspace-language':'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;',
  '@/app/pos-tickets/actions':'export const correctClosedPosTicketInline=async()=>{};export const submitLockedStaffFinancialCorrection=async()=>{};',
  'next/navigation':"export const usePathname=()=>'/reports';export const useRouter=()=>({refresh(){},push(){}});export const useSearchParams=()=>new URLSearchParams(location.search);",
  'next/link':'export default function Link({children,prefetch,scroll,...props}){return <a {...props}>{children}</a>}',
 };
 const built=await build({write:false,bundle:true,platform:'browser',format:'iife',outfile:'fixture.js',jsx:'automatic',stdin:{resolveDir:process.cwd(),loader:'tsx',contents},plugins:[{name:'fixture-transports',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(replacements,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:replacements[a.path]}));}}]});
 const app=resolve('app').replaceAll('\\','/'),components=resolve('components').replaceAll('\\','/');
 const globals=(await fs.readFile('app/globals.css','utf8')).replace('@import "tailwindcss";',`@import "tailwindcss" source(none);\n@source "${app}";\n@source "${components}";`);
 const css=(await postcss([tailwind()]).process(globals,{from:resolve('app/globals.css')})).css+'\n'+(built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'');
 const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const server=createServer(async(req,res)=>{
  if(req.url==='/a.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}
  if(req.url==='/a.css'){res.setHeader('Content-Type','text/css');return res.end(css);}
  if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,items:[]}));}
  if(req.url.startsWith('/brand/')||req.url.startsWith('/gift-cards/')){try{res.setHeader('Content-Type',req.url.endsWith('.webp')?'image/webp':'image/png');return res.end(await fs.readFile(join('public',req.url)));}catch{res.statusCode=404;return res.end();}}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/a.css"><div id="root"></div><script src="/a.js"></script>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const out=resolve(process.env.GIFT_TICKET_QA_OUTPUT_DIR||'artifacts/gift-ticket-unified/browser');await fs.mkdir(out,{recursive:true});const results=[];
 try{
  for(const screen of ['ticket','only','named-only','reward','gift-used','split-payment','voided','service-only','checkout','report','closing','today','success'])for(const width of [320,390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   await page.goto(origin+'/?screen='+screen);await page.locator('main').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,screen+' overflow '+width);
   if(screen==='ticket'){assert.equal(await page.locator('[data-ticket-gift-item]').count(),1);assert.match(await page.locator('[data-compact-ticket]').innerText(),/Total \$154.00/);assert.match(await page.locator('[data-ticket-payment-sources]').innerText(),/Cash \$154.00/);}
   const giftRow=page.locator('[data-ticket-gift-item]');
   if(['ticket','only','named-only','reward','split-payment'].includes(screen)){
    assert.equal(await giftRow.count(),1);
    assert.equal(await giftRow.locator('[data-ticket-gift-staff]').innerText(),'','Gift staff/seller column stays blank');
    assert.doesNotMatch(await giftRow.innerText(),/Kim|Different recording operator|Sold by|Operator/,'no inferred seller');
   }
   assert.equal(await page.getByText(/Sold by/).count(),0);
   if(screen==='named-only'){assert.match(await page.locator('[data-compact-ticket]').innerText(),/Linh/);assert.doesNotMatch(await page.locator('[data-ticket-payment-sources]').innerText(),/Walk-in/);assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).count(),0);}
   if(screen==='reward'){const text=await page.locator('[data-compact-ticket]').innerText();assert.match(text,/Discount −\$5.00/);assert.match(text,/Reward −\$5.00/);assert.match(text,/Total \$149.00/);assert.match(text,/Cash \$149.00/);}
   if(screen==='gift-used'){const text=await page.locator('[data-compact-ticket]').innerText();assert.equal(await giftRow.count(),0);assert.match(text,/Total \$60.00/);assert.match(text,/Gift card \$25.00/);assert.match(text,/Cash \$35.00/);assert.match(text,/Tip \$10.00/);}
   if(screen==='split-payment'){const text=await page.locator('[data-ticket-payment-sources]').innerText();assert.match(text,/Cash \$54.00/);assert.match(text,/Card \$100.00/);}
   if(screen==='voided')assert.match(await page.locator('main').innerText(),/Voided/);
   if(screen==='service-only'){assert.equal(await giftRow.count(),0);assert.match(await page.locator('[data-compact-ticket]').innerText(),/Kim/);assert.match(await page.locator('[data-compact-ticket]').innerText(),/Total \$54.00/);}
   if(screen==='only'){assert.equal(await page.getByRole('button',{name:'Edit',exact:true}).count(),0);assert.match(await page.locator('[data-compact-ticket]').innerText(),/Total \$100.00/);assert.equal(await page.getByText('No services recorded.',{exact:true}).count(),0);}
   if(screen==='checkout'){assert.equal(await page.locator('[data-checkout-gift-item]').count(),1);assert.equal(await page.locator('[data-customer-display-receipt-total]').textContent(),'$154.00');}
   if(screen==='report'){assert.match(await page.locator('main').innerText(),/Gift card · •••• 4821/);assert.equal(await page.locator('[data-pos-collection-breakdown]').count(),1);}
   if(screen==='today'){const links=await page.locator('a[href^="/pos-tickets/"]').count();assert.equal(links,3,'every source alert points directly to its Ticket');}
   if(screen==='success')assert.match(await page.locator('[data-gift-completion-receipt]').innerText(),/T00024.*\$100.00/);
   assert.deepEqual(errors,[],screen+' '+width);
   if(width===1440&&(screen==='ticket'||screen==='only'))await page.locator('[data-compact-ticket]').screenshot({path:join(out,screen+'-'+width+'.png')});
   else if(width===1440||width===390)await page.screenshot({path:join(out,screen+'-'+width+'.png'),fullPage:true});
   results.push({screen,width,passed:true});await page.close();
  }
  await fs.writeFile(join(out,'results.json'),JSON.stringify({passed:true,layer:'Actual components with isolated synthetic boundary data; no hosted writes',checks:results},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
