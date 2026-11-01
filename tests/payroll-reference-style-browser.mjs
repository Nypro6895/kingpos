import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
import {payrollContextFixture,payrollContextBoundaryPlugin} from './payroll-history-context-fixture.mjs';

const dir='artifacts/payroll-style-reference-20261101/browser';mkdirSync(dir,{recursive:true});
// The preview renders actual web/native page components; only backend/router boundaries use fixtures.
const fixture=payrollContextFixture
 .replace("import PayrollPage", "import {ShopMoneyWorkspace} from '@/app/payroll/shop-money-workspace';\nimport PayrollPage")
 .replace('root.render(element);', `root.render(params.tab==='expenses'?<main style={{padding:16,maxWidth:1100,margin:'auto'}}><ShopMoneyWorkspace salonId={salon} start={period.startDate} end={period.endDate} view="expenses"/></main>:element);`);
await build({stdin:{contents:fixture,loader:'tsx',resolveDir:process.cwd()},bundle:true,outfile:dir+'/app.js',jsx:'automatic',alias:{'@':process.cwd()},plugins:[payrollContextBoundaryPlugin()]});
const globals=readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";','@import "tailwindcss" source(none);\n@source "'+resolve('app').replaceAll('\\','/')+'";');
writeFileSync(dir+'/global.css',(await postcss([tailwindcss()]).process(globals,{from:resolve('app/globals.css')})).css);
const sample={today:'2026-10-31',timezone:'America/Chicago',days:[{date:'2026-10-16',expected:100},{date:'2026-10-17',expected:500},{date:'2026-10-18',expected:600}],collections:[{business_date:'2026-10-17',cash:200,card:300,other:0,revision:1,legacy_snapshot:null},{business_date:'2026-10-18',cash:200,card:420,other:0,revision:1,legacy_snapshot:null}],legacy:[],expenses:[{id:'rent-1',business_date:'2026-10-01',paid_at:'2026-10-01T14:00:00Z',amount:400,source:'bank',category:'rent',note:'October rent',revision:1,recurrence_key:'2026-10'},{id:'supply-1',business_date:'2026-10-20',paid_at:'2026-10-20T19:35:00Z',amount:70,source:'cash',category:'supplies',note:'Nail supplies',revision:1}],opening:null,settings:{rent:400,rent_day:1,fee_rate:2.5,fee_each:.1,revision:1},giftOpening:200,giftClosing:300,giftActivity:[{id:'g1',kind:'sale',delta:20000,last4:'1234',created_at:'2026-10-17T18:00:00Z'},{id:'g2',kind:'redemption',delta:-10000,last4:'1234',created_at:'2026-10-18T18:00:00Z'}],rewardOpening:1000,rewardClosing:1300,rewardCredits:500,rewardDebits:200,rewardActivity:[{id:'r1',reason:'Earned',delta:500,customer_name:'Sample customer',user_id:'sample-customer',created_at:'2026-10-17T18:00:00Z'}],discounts:[{id:'d1',ticket_number:'T00042',total:80,reward:30,opened_at:'2026-10-18T18:00:00Z'}],history:[],cardTransactions:20};
let writes=0;
const server=createServer(async(req,res)=>{
 const name=(req.url??'').split('?')[0].slice(1);
 if(name==='api/shop-money'){
  let body='';for await(const chunk of req)body+=chunk;
  if(req.method!=='POST'||JSON.parse(body).op!=='read'){writes++;res.writeHead(405);res.end('{"error":"Read-only design preview"}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(sample));return;
 }
 if(name==='api/financial-input-history'){res.setHeader('Content-Type','application/json');res.end('{"rows":[]}');return;}
 if(['app.js','app.css','global.css'].includes(name)){res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(dir+'/'+name));return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>body{margin:0;background:white}.preview-header{padding:18px 16px 8px;max-width:1440px;margin:auto;display:flex;justify-content:space-between;font:14px Arial}.preview-header small{display:block;color:#777;font-size:11px;margin-top:3px}</style><header class="preview-header"><div><b>King Nails Spa LLC</b><small>Owner · Sample data</small></div><b style="letter-spacing:2px;color:#174e3d">REYLUMI</b></header><div id="root"></div><script src="/app.js"></script>');
});
const serve=process.argv.includes('--serve');await new Promise(r=>server.listen(serve?43161:0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
if(serve){console.log('Read-only actual-component preview: '+base+'/payroll');}
else{
 let browser;const checks=[],errors=[];
 try{
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  for(const runtime of ['web','native'])for(const width of [320,390,768,1440])for(const tab of ['shop','staff','gifts','tools','settings','tax','download','expenses']){
   await page.setViewportSize({width,height:1000});await page.goto(base+'/payroll?runtime='+runtime+'&tab='+tab+'&mode=plain');
   if(['shop','gifts','expenses'].includes(tab))await page.locator('[data-shop-money]').waitFor();else await page.locator('main').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${runtime}/${tab}/${width} viewport overflow`);
   if(tab!=='expenses'){
    const rail=page.getByRole('navigation',{name:'Payroll sections'});
    assert.deepEqual(await rail.locator('a').allTextContents(),['Shop','Staff','Gift & Rewards','Tools']);
   }
   if(tab==='shop'){
    assert.match(await page.locator('body').innerText(),/Short\s+\$100\.00/);
    await page.getByRole('button',{name:'Collected breakdown',exact:true}).click();
    await page.getByRole('button',{name:'Staff payout breakdown',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Collected breakdown',exact:true}).getAttribute('aria-expanded'),'false');
    await page.getByRole('button',{name:'Staff payout breakdown',exact:true}).click();
   }
   if(tab==='gifts'){
    await page.getByRole('button',{name:'Rewards',exact:true}).click();assert.match(await page.locator('body').innerText(),/1300|1,300/);
    await page.getByRole('heading',{name:'Rewards',exact:true}).waitFor();
    await page.getByRole('button',{name:'Discounts',exact:true}).click();await page.getByRole('heading',{name:'Discounts',exact:true}).waitFor();
    assert.match(await page.locator('body').innerText(),/\$80\.00/);
    await page.getByRole('button',{name:'Gift cards',exact:true}).click();
   }
   if(tab==='staff'){
    const card=page.locator('details').filter({has:page.getByText('Kim',{exact:true})}).first();await card.locator('summary').first().click();
    assert.match(await card.innerText(),/\$84\.00/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   if(tab==='expenses'){
    await page.getByRole('button',{name:'+ Add',exact:true}).click();await page.getByRole('button',{name:'Save expense',exact:true}).waitFor();
    const input=page.getByLabel('Amount',{exact:true});assert.equal(await input.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
   }
   if(runtime==='web'&&[390,1440].includes(width))await page.screenshot({path:dir+'/'+tab+'-'+width+'.png',fullPage:true});
   checks.push({runtime,tab,width,passed:true});
  }
  assert.deepEqual(errors,[]);assert.equal(writes,0);writeFileSync(dir+'/results.json',JSON.stringify({passed:true,checks,errors,writes,limitation:'Sample data, actual components/CSS; no live or physical device acceptance'},null,2));console.log({passed:true,views:checks.length,errors,writes});
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
