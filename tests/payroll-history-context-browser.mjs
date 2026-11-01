import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
import {payrollContextFixture,payrollContextBoundaryPlugin} from './payroll-history-context-fixture.mjs';

const directory='artifacts/payroll-history-context-20261031/navigation-browser';mkdirSync(directory,{recursive:true});
await build({stdin:{contents:payrollContextFixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:directory+'/fixture.js',jsx:'automatic',alias:{'@':process.cwd()},plugins:[payrollContextBoundaryPlugin()]});
const globals=readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "'+resolve('app').replaceAll('\\','/')+'";');
writeFileSync(directory+'/global.css',(await postcss([tailwindcss()]).process(globals,{from:resolve('app/globals.css')})).css);
const server=createServer((req,res)=>{
 const name=(req.url??'').split('?')[0].slice(1);
 if(['fixture.js','fixture.css','global.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(directory+'/'+name));}
 else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const id=n=>'a0000000-1111-4111-8111-'+String(n).padStart(12,'0'),salon=id(99),results=[],requests=[],errors=[];let browser;
const event=(n,source,date='2025-01-03')=>({id:id(n),salon_id:salon,staff_id:id(98),source_id:id(98),source_table:source,period_start:date,period_end:date,before_values:{service_total:10,tip_amount:0},after_values:{service_total:15,tip_amount:0,ticket_number:'T-OLD'},actor_name:'Salon Owner',created_at:'2026-10-31T01:00:00Z',note:'Original dated record',event_action:'updated',ticket_number:'T-OLD'});
try{
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:1100},colorScheme:'light'});page.on('pageerror',e=>errors.push(e.message));
 let responseStatus=200,responseRows=[],responseRecord;
 await page.route('**/api/financial-input-history?**',route=>{
  requests.push({method:route.request().method(),url:route.request().url()});
  const focus=new URL(route.request().url()).searchParams.get('inputEvent');
  return route.fulfill({status:responseStatus,json:{rows:responseRows.filter(row=>!focus||row.id===focus),record:responseRecord?.id===focus?responseRecord:undefined}});
 });
 await page.route('**/api/shop-money',route=>{
  assert.equal(route.request().postDataJSON().op,'read','History navigation must not mutate money');
  return route.fulfill({json:{today:'2026-10-31',timezone:'America/Chicago',days:[{date:'2026-10-29',expected:132}],collections:[],legacy:[{business_date:'2026-10-29',cash:120,card:0,other:0,tip:12,entered:true,updated_at:'2026-10-31T01:00:00Z'}],expenses:[],opening:null,settings:null,giftOpening:0,giftClosing:0,giftActivity:[],rewardOpening:0,rewardClosing:0,rewardCredits:0,rewardDebits:0,rewardSummary:{issued:0,spent:0,adjustments:0},rewardActivity:[],discounts:[],history:[],cardTransactions:0}});
 });
 const base='http://127.0.0.1:'+server.address().port;
 const open=async(runtime,extra='')=>{await page.goto(`${base}/payroll?runtime=${runtime}&preset=semi_monthly_second&month=2026-10&segment=second&${extra}`);await page.getByRole('navigation',{name:'Payroll sections'}).waitFor();};
 const noGlobalHistory=async()=>{assert.equal(await page.getByRole('heading',{name:'Input change history',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:/View change history|^Updated|^Change history/}).count(),0);};
 const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const selectedPeriod=async()=>assert.match(await page.getByRole('region',{name:'Payroll period'}).innerText(),/Oct 16–31, 2026/);
 for(const runtime of ['web','native'])for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:1100});await open(runtime,'tab=overview');await page.getByText('Available to use (estimated)',{exact:true}).waitFor();await noGlobalHistory();await selectedPeriod();await noOverflow();
  assert.equal(await page.getByRole('link',{name:'Shop',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await page.getByRole('link',{name:'Gift & Rewards',exact:true}).count(),1);
  await page.getByRole('link',{name:'Tools',exact:true}).click();await page.getByRole('link',{name:/Payroll settings/}).waitFor();await noGlobalHistory();assert.equal(await page.getByRole('link',{name:'Tools',exact:true}).getAttribute('aria-current'),'page');
  for(const link of await page.locator('nav a').evaluateAll(rows=>rows.map(row=>row.href))){const url=new URL(link);assert.equal(url.searchParams.get('month'),'2026-10');assert.equal(url.searchParams.get('segment'),'second');}
  await open(runtime,'tab=history');await page.getByText('Available to use (estimated)',{exact:true}).waitFor();await noGlobalHistory();await selectedPeriod();assert.equal(await page.getByRole('link',{name:'Shop',exact:true}).getAttribute('aria-current'),'page');
  await page.screenshot({path:`${directory}/${runtime}-overview-${width}.png`,fullPage:true});results.push({runtime,width,overviewToolsNoAggregateHistory:true,legacyNoEventResolvesShop:true,selectedPeriodPreserved:true,overflow:false});
 }
 for(const runtime of ['web','native']){
  await page.setViewportSize({width:390,height:1100});
  await open(runtime,'tab=history&inputEvent=bad-id');await page.getByText('Available to use (estimated)',{exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Saved record context'}).count(),0);
  await open(runtime,'access=staff&tab=history');await page.getByRole('region',{name:'Staff payroll'}).waitFor();assert.equal(await page.getByRole('link',{name:'Staff',exact:true}).getAttribute('aria-current'),'page');assert.equal(await page.getByRole('link',{name:'Overview',exact:true}).count(),0);
  await open(runtime,'tab=history&inputEvent='+id(1));await page.locator('[data-input-event="'+id(1)+'"]').waitFor({state:'visible'});assert.equal(await page.getByRole('link',{name:'Staff',exact:true}).getAttribute('aria-current'),'page');assert.match(await page.locator('[data-input-event="'+id(1)+'"]').innerText(),/\$100\.00\s*→\s*\$120\.00/);await selectedPeriod();await noGlobalHistory();
  await open(runtime,'tab=history&inputEvent='+id(2));await page.locator('[data-input-event="'+id(2)+'"]').waitFor({state:'visible'});assert.equal(await page.getByRole('link',{name:'Shop',exact:true}).getAttribute('aria-current'),'page');await selectedPeriod();await noGlobalHistory();
  await open(runtime,'tab=history&inputEvent='+id(3));await page.getByRole('heading',{name:'Ticket T00042',exact:true}).waitFor();assert.equal(await page.locator('nav [aria-current="page"]').count(),0);const ticketLink=new URL(await page.getByRole('link',{name:'Open ticket in Today'}).getAttribute('href'),base);assert.equal(ticketLink.pathname,'/staff/today');assert.equal(ticketLink.searchParams.get('inputEvent'),id(3));assert.equal(ticketLink.searchParams.get('eventDate'),'2026-10-29');await selectedPeriod();await page.screenshot({path:`${directory}/${runtime}-ticket-390.png`,fullPage:true});
  await open(runtime,'tab=staff&mode=plain');const plainCard=page.locator('details').filter({has:page.getByText('Kim',{exact:true})}).first();await plainCard.locator('summary').first().click();assert.doesNotMatch(await plainCard.innerText(),/Edited|Earlier records|Period inputs edited|Bonus edited/);assert.equal(await page.locator('[data-input-event]').count(),0);await noGlobalHistory();
  await open(runtime,'tab=staff&mode=metadata');const kim=page.locator('details').filter({has:page.getByText('Kim',{exact:true})}).first();await kim.locator('summary').first().click();const metadata=page.locator('[data-period-payment-details]');await metadata.locator('summary').click();assert.match(await metadata.innerText(),/Check number\s+124\s*→\s*Not set/);assert.equal(await page.getByText('Period inputs edited',{exact:false}).count(),0);assert.equal(await page.getByText('Daily inputs edited',{exact:false}).count(),0);assert.equal(await page.locator('[data-input-event]').count(),0);assert.equal(await page.getByRole('region',{name:'Current obligation and recorded payments'}).count(),1);
  const payments=page.getByRole('region',{name:'Current obligation and recorded payments'});assert.match(await payments.innerText(),/Current calculated pay\s+\$84\.00/);assert.match(await payments.innerText(),/Actual recorded payments\s+\$40\.00/);assert.match(await payments.innerText(),/Amount still owed\s+\$44\.00/);assert.match(await payments.innerText(),/2026-10-16 – 2026-10-31/);
  await open(runtime,'tab=history&mode=metadata&inputEvent='+id(7));await page.locator('[data-payment-detail-event="'+id(7)+'"]').waitFor({state:'visible'});assert.equal(await page.getByRole('link',{name:'Staff',exact:true}).getAttribute('aria-current'),'page');assert.equal(await page.locator('[data-period-payment-details]').count(),1);assert.equal(await page.locator('[data-focused-input-object]').count(),0);assert.equal(await page.getByText('Bonus edited',{exact:false}).count(),0);assert.equal(await page.locator('[data-period-payment-details]').evaluate(element=>{let parent=element;while(parent){if(parent instanceof HTMLDetailsElement&&!parent.open)return false;parent=parent.parentElement;}return true;}),true);await page.screenshot({path:`${directory}/${runtime}-check-details-390.png`,fullPage:true});
  // Unknown/outside-period exact ID is read separately; never silently selects its old month.
  responseRows=[event(80,'staff_day')];await open(runtime,'tab=history&inputEvent='+id(80));await page.locator('[data-input-event="'+id(80)+'"]').waitFor();assert.equal(await page.locator('[data-input-event]').count(),1);assert.equal(await page.locator('nav [aria-current="page"]').count(),0);assert.equal(await page.getByRole('link',{name:'Open related payroll row'}).count(),0);await selectedPeriod();assert.match(await page.getByRole('region',{name:'Saved record context'}).innerText(),/2025-01-03/);
  responseRows=[event(81,'ticket','2025-01-05')];await page.evaluate(next=>{history.pushState({},'',location.href.replace(/inputEvent=[^&#]+/,'inputEvent='+next));dispatchEvent(new PopStateEvent('popstate'));},id(81));await page.getByRole('heading',{name:'Ticket T-OLD',exact:true}).waitFor();assert.equal(await page.locator('[data-input-event="'+id(80)+'"]').count(),0);assert.equal(new URL(await page.getByRole('link',{name:'Open ticket in Today'}).getAttribute('href'),base).searchParams.get('eventDate'),'2025-01-05');await selectedPeriod();
  responseStatus=404;responseRows=[];await open(runtime,'tab=history&inputEvent='+id(82));await page.getByText(/This record is unavailable in this view\./).waitFor();assert.equal(await page.locator('[data-input-event]').count(),0);responseStatus=200;responseRows=[event(82,'staff_day')];await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('[data-input-event="'+id(82)+'"]').waitFor();assert.equal(await page.locator('[data-input-event]').count(),1);
  responseStatus=403;responseRows=[];await open(runtime,'tab=history&inputEvent='+id(84));await page.getByText(/This record could not be loaded\. Please retry\./).waitFor();assert.equal(await page.locator('[data-input-event]').count(),0);assert.equal(await page.getByRole('link',{name:'Open ticket in Today'}).count(),0);responseStatus=200;
  // Empty current Staff period still retains authorized exact fallback.
  responseRows=[event(83,'staff_day')];await open(runtime,'tab=staff&empty=1&inputEvent='+id(83));await page.locator('[data-input-event="'+id(83)+'"]').waitFor();await selectedPeriod();
  await noGlobalHistory();await noOverflow();assert.doesNotMatch(await page.locator('body').innerText(),/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);await page.screenshot({path:`${directory}/${runtime}-exact-record-390.png`,fullPage:true});
  results.push({runtime,knownStaffShopInline:true,ticketTodayLinkCapturedDate:true,metadataNeutralNotIncome:true,unknownExactSingleObject:true,outsidePeriodDoesNotRecalculate:true,samePageFocusRefetched:true,notFoundRetry:true,emptyPeriodRetainsExactRecord:true,technicalIds:false});
 }
 assert.ok(requests.every(row=>row.method==='GET'));assert.deepEqual(errors,[]);
 writeFileSync(directory+'/results.json',JSON.stringify({passed:true,layer:'Actual full web Payroll page and actual app-local Owner Payroll view with actual CSS/components; backend, actions, language and router boundaries mocked; no physical device acceptance',results,requests,errors},null,2));console.log(JSON.stringify({passed:true,checks:results.length,requests:requests.length,errors},null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
