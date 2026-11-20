import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

test('compact Staff pay filter supports swipe, chooser, keyboard, boundaries and responsive summaries', { timeout: 60000 }, async () => {
  const dir = 'artifacts/staff-pay-cleanup-20261028/browser'; mkdirSync(dir, { recursive: true });
  const entry = `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{StaffMyPay,StaffMyAnalysis}from'@/app/staff/my-work/staff-pay-analysis';
  const options=[['2026-09-16','2026-09-30'],['2026-10-01','2026-10-15'],['2026-10-16','2026-10-31']].map(([startDate,endDate])=>({startDate,endDate,value:startDate+':'+endDate,label:startDate+' – '+endDate}));
  window.navigated=[];function App(){const[selected,setSelected]=useState(options[2].value),[tab,setTab]=useState('payroll');useEffect(()=>{const handle=event=>{const url=new URL(event.detail,'http://fixture');window.navigated.push(event.detail);setSelected(url.searchParams.get('payPeriodStart'));setTab(url.searchParams.get('tab'));};window.addEventListener('fixture:navigate',handle);return()=>window.removeEventListener('fixture:navigate',handle)},[]);
  const period=options.find(o=>o.value===selected);const data={period,periodOptions:options,settings:[],status:{label:'Updated'},history:[{id:'change',created_at:'2026-10-28T12:00:00Z',period_start:'2026-10-16',period_end:'2026-10-31',source_table:'staff_payroll_inputs',before_values:{bonus_amount:0},after_values:{bonus_amount:0}}],latestStatement:null,paystub:{view_url:'https://example.test/never-download'},line:{final_staff_income:558.28,final_cash_amount:200,final_check_amount:358.28,gross_sales:912,staff_commission_gross:547.2,tip_amount:11.08,bonus_amount:0,tax_withheld:0,settings_used_snapshot:[]},dailyRows:[],workPerformance:{serviceTotal:912,totalTurns:22,bigTurns:20,smallTurns:2,tipAmount:11.08,averageTicket:45.6,ticketCount:20,dailyActivity:[{businessDate:'2026-10-20',serviceTotal:260}],topServices:[{serviceId:'one',serviceName:'Full Set',count:3,revenue:120}]},comparison:{deltaAmount:812,deltaPercent:812,currentLabel:'Oct 16–28',previousLabel:'Oct 1–13'}};return <main><h1>Good afternoon, Staff-Ny</h1><nav><button onClick={()=>setTab('payroll')}>My Pay</button><button onClick={()=>setTab('analysis')}>Analysis</button></nav>{tab==='payroll'?<StaffMyPay data={data}/>:<StaffMyAnalysis data={data} today="2026-10-28"/>}</main>;}createRoot(document.getElementById('root')).render(<App/>);`;
  await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: dir+'/fixture.js', jsx: 'automatic', plugins: [{ name: 'fixture-adapters', setup(b) {
    b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
    b.onResolve({filter:/^next\/link$/},()=>({path:'link',namespace:'fixture'}));
    b.onResolve({filter:/^@\/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'tsx',resolveDir:process.cwd(),contents:args.path==='navigation'?`export const useRouter=()=>({push:url=>window.dispatchEvent(new CustomEvent('fixture:navigate',{detail:url}))});`:args.path==='link'?`import React from 'react';export default function Link(p){return <a {...p}/>}`:`import React from 'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='div',...p})=><Tag {...p}/>;export const useWorkspaceTranslation=()=>text=>text;` }));
  }}] });
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>*{box-sizing:border-box}body{margin:0;background:white;font-family:Arial}main{padding:20px;max-width:1100px;margin:auto}h1{font-size:24px}nav{display:flex;gap:20px;margin:20px 0}nav button{border:0;background:white;padding:10px}dl{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>';
  const server=createServer((req,res)=>{if(req.url==='/fixture.js'||req.url==='/fixture.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(dir+req.url));}else{res.setHeader('Content-Type','text/html');res.end(html)}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const results=[];
  try{browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:900},hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
    const trigger=page.getByRole('button',{name:/Oct 16.*Pay period/});await trigger.waitFor();assert.equal(await page.locator('select:visible').count(),0);assert.equal(await page.getByRole('link').count(),0);assert.equal(await page.getByRole('button',{name:/Download|Export/}).count(),0);
    assert.ok((await page.locator('body').innerText()).includes('$558.28'));assert.ok(await page.locator('details').evaluateAll(nodes=>nodes.every(n=>!n.open)));
    await trigger.click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByRole('combobox').selectOption('2026-09');assert.equal(await page.evaluate(()=>window.navigated.length),0);await dialog.getByRole('button',{name:/2026-09-16/}).click();await page.getByRole('button',{name:/Sep 16.*Pay period/}).waitFor();assert.ok((await page.evaluate(()=>window.navigated.at(-1))).includes('2026-09-16%3A2026-09-30'));
    await page.getByRole('button',{name:/Sep 16.*Pay period/}).press('ArrowLeft');assert.equal(await page.evaluate(()=>window.navigated.length),1);
    await page.getByRole('button',{name:/Sep 16.*Pay period/}).press('ArrowRight');await page.getByRole('button',{name:/Oct 1.*Pay period/}).waitFor();
    await page.getByRole('button',{name:'Analysis',exact:true}).click();
    const swipe=async(dx,dy=0)=>{const el=page.getByRole('button',{name:/Pay period/});const box=await el.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:6});await page.mouse.up();};
    await swipe(-80);await page.getByRole('button',{name:/Oct 16.*Pay period/}).waitFor();assert.ok((await page.evaluate(()=>window.navigated.at(-1))).includes('tab=analysis'));
    const count=await page.evaluate(()=>window.navigated.length);await swipe(-80);assert.equal(await page.evaluate(()=>window.navigated.length),count);assert.equal(await page.locator('dialog[open]').count(),0);
    await swipe(80);await page.getByRole('button',{name:/Oct 1.*Pay period/}).waitFor();await swipe(4,65);assert.equal(await page.locator('dialog[open]').count(),0);
    await page.getByRole('button',{name:/Oct 1.*Pay period/}).click();await dialog.waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
    // Real touch events exercise pan-y pointer cancellation and swipe handling.
    const cdp = await page.context().newCDPSession(page);
    const box = await page.getByRole('button',{name:/Pay period/}).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let offset=15;offset<=90;offset+=15) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-offset,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.getByRole('button',{name:/Oct 16.*Pay period/}).waitFor();
    await cdp.detach();
    assert.ok(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth));await page.screenshot({path:resolve(dir,`analysis-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'My Pay',exact:true}).click();await page.getByText('Payment details & history',{exact:true}).click();await page.locator('summary').filter({hasText:'Change history'}).waitFor();assert.equal(await page.getByRole('link').count(),0);await page.getByText('Payment details & history',{exact:true}).click();await page.screenshot({path:resolve(dir,`pay-${width}.png`),fullPage:true});assert.deepEqual(errors,[]);results.push({width,passed:true,navigations:await page.evaluate(()=>window.navigated)});await page.close();
  }writeFileSync(dir+'/results.json',JSON.stringify(results,null,2));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});

