import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import ts from 'typescript';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

// Execute the actual server functions with only authentication, clock and RPC
// boundaries replaced. No database or production session is used.
function functionsFrom(file, names, dependencies) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text));
  assert.equal(selected.length, names.length);
  const code = ts.transpileModule(selected.map(s => s.getText(source)).join('\n'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const exports = {};
  new Function('exports', ...Object.keys(dependencies), code)(exports, ...Object.values(dependencies));
  return exports;
}

test('production Portable Report rejects other dates and preserves the signed save scope', async () => {
  let at='2026-10-27T01:30:00Z';
  class Clock extends Date {constructor(...args){super(...(args.length?args:[at]));}}
  const {getTodayDate}=functionsFrom('lib/staff-workdays.ts',['getTodayDate'],{Date:Clock});
  const calls=[];const session={salon_id:'salon',salon_timezone:'America/Chicago',salon_name:'Sample Salon'};
  const supabase={rpc(name,args){calls.push({name,args});return {data:null,error:null};}};
  const api=functionsFrom('app/pos/portable/actions.ts',['getPortableReportData','savePortableReportClosing'],{
    requirePortableCapability:async()=>({keyId:'key',signature:'signature',portableSession:session,supabase}),
    PORTABLE_POS_CAPABILITIES:{reportView:'report'},getTodayDate,
    parsePortableCurrencyToCents:value=>Math.round(Number(value)*100),centsToPortableMoney:cents=>cents/100,revalidatePath:()=>{},
  });
  for(const date of ['2026-10-25','2026-10-27','not-a-date']){
    await assert.rejects(api.getPortableReportData(date),/today only/);
    assert.equal((await api.savePortableReportClosing({reportDate:date,expectedScope:'salon:key'})).ok,false);
  }
  assert.equal(calls.length,0,'denied dates never reach the report RPC');
  assert.equal((await api.getPortableReportData()).reportDate,'2026-10-26');
  const input={reportDate:'2026-10-26',expectedScope:'salon:key',cashAmount:'226',creditCardAmount:'0',otherAmount:'0',note:''};
  const before=calls.length;
  assert.equal((await api.savePortableReportClosing({...input,expectedScope:'other:key'})).ok,false);
  assert.equal(calls.length,before,'mismatched session scope stays denied');
  assert.equal((await api.savePortableReportClosing(input)).ok,true);
  assert.equal(calls.find(c=>c.name==='save_pos_workspace_report_closing').args.p_report_date,'2026-10-26');
  session.salon_timezone='Asia/Tokyo';
  await assert.rejects(api.getPortableReportData('2026-10-26'),/today only/);
  assert.equal((await api.getPortableReportData()).reportDate,'2026-10-27');
  session.salon_timezone='America/Chicago';at='2026-10-27T05:00:01Z';
  const midnightCalls=calls.length;
  assert.equal((await api.savePortableReportClosing(input)).ok,false);
  assert.equal(calls.length,midnightCalls,'stale forms cannot write yesterday');
});

test('Report and navigation render flat, preserve saving, and hide stale reports', {timeout:90000}, async () => {
  const bundle = await build({bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic', outfile:'preview.js',
    stdin:{loader:'tsx', resolveDir:process.cwd(), contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import Report from './app/(app)/pos/portable/report/page';
      import {PortableWorkspaceTabs} from './app/pos/portable/portable-workspace-tabs';
      import {PORTABLE_POS_ROUTE_LINKS} from './lib/pos-portable-routes';
      const closingInputs={cashAmount:0,creditCardAmount:0,otherAmount:0,note:null,status:'draft'};
      window.sampleReport={closingScope:'salon:device',reportDate:'2026-10-26',salonName:'King Nails Spa LLC',timezone:'America/Chicago',closingInputs,lock:{isLocked:false,status:'draft'},totals:{expectedTotal:226},setupMessage:null};
      window.posts=[];let current={revision:1,reportDate:'2026-10-26',locked:false,closingInputs};
      window.fetch=async(url,init={})=>{
        if(String(url).startsWith('/api/pos/portable/workspace'))return Response.json(window.sampleReport);if(!String(url).startsWith('/api/pos/closing'))throw Error('Unexpected request '+url);
        if(init.method==='POST'){const body=JSON.parse(init.body);window.posts.push(body);current={...current,revision:current.revision+1,closingInputs:{...closingInputs,...body.values}};return Response.json({ok:true,current,receipt:current,requestId:body.requestId});}
        return Response.json({ok:true,current,scope:'sample-device'});
      };
      void(async()=>{const report=await Report({searchParams:Promise.resolve({date:'1999-01-01'})});
        createRoot(document.getElementById('root')).render(<main className="portable-kiosk-surface relative flex h-dvh w-dvw flex-col overflow-hidden bg-zinc-100 text-zinc-950" data-portable-shell>
          <PortableWorkspaceTabs localPanels items={PORTABLE_POS_ROUTE_LINKS} salonId="salon" salonLogoUrl={null} salonName="King Nails Spa LLC" salonTimezone="America/Chicago"/>
          <div className="min-h-0 flex-1 overflow-hidden">{report}</div></main>);
      })();
    `},plugins:[{name:'isolated-portable-report',setup(b){
      const mocks={
        'next/navigation':`export const usePathname=()=>'/pos/portable/report';export const useRouter=()=>({prefetch(){}});`,
        'next/link':`import React from 'react';export const useLinkStatus=()=>({pending:false});export default function Link({prefetch,...props}){return <a {...props}/>}`,
        'next/image':`import React from 'react';export default function Image({fill,priority,...props}){return <img {...props}/>}`,
        '@/components/experience-page':`export const withExperiencePage=p=>p;`,
        '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>s=>s;`,
        '@/app/pos/portable/actions':`export const logoutPortablePosAction=()=>{};export async function getPortableReportData(date){window.requestedReportDate=date;return window.sampleReport;}export async function savePortableReportClosing(body){window.posts.push(body);window.sampleReport={...window.sampleReport,closingInputs:{...window.sampleReport.closingInputs,...body,cashAmount:Number(body.cashAmount),creditCardAmount:Number(body.creditCardAmount),otherAmount:Number(body.otherAmount)}};return {ok:true,data:window.sampleReport};}`,
        '@/app/pos/portable/use-portable-draft':`export const clearPortableLocalDrafts=()=>{};`,
        '@/app/pos/portable/portable-workspace-state':`export const usePortableWorkspaceState=()=>({scope:'salon:device',businessDate:new URLSearchParams(location.search).has('stale')?'2026-10-27':'2026-10-26',offlineEnabled:true});`,
        '@/lib/pos-workspace-sync':`export const usePosResourceRefresh=()=>{};`,
        '@/lib/portable-operations':`export const listPortableOperations=async()=>[];export const PORTABLE_OPERATIONS_CHANGED='operations';`,
        '@/app/pos/pos-workspace-realtime-refresh':`export const PosWorkspaceRealtimeRefresh=()=>null;`,
        '@/app/pos/portable/portable-sync-indicator':`import React from 'react';export const PortableSyncIndicator=()=> <button className="h-10 w-10" aria-label="Sync">✓</button>;`,
        './desktop-tools':`import React from 'react';export const DesktopTools=()=> <><button className="h-10 w-10" aria-label="Display">▣</button><button className="h-10 w-10" aria-label="App menu">⋮</button></>;`,
        './device-input-settings':`import React from 'react';export const DeviceInputSettingsButton=()=>null;`,
        './portable-booking-notifications':`import React from 'react';export const PortableBookingNotifications=()=> <button className="h-10 w-10" aria-label="Notifications">♧</button>;`,
        './portable-fullscreen-button':`import React from 'react';export const PortableFullscreenButton=()=> <button className="h-10 w-10" aria-label="Fullscreen">⛶</button>;`,
      };
      b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
      b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
    }}]});
  const source = readFileSync('app/globals.css','utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./pos/portable";\n@source "./(app)/pos/portable";\n@source "./reports/closing-save-notice.tsx";');
  const {css} = await postcss([tailwind()]).process(source, {from:resolve('app/globals.css')});
  const script = bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const server = createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?script:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/app.js"></script>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const out = process.env.PORTABLE_REPORT_QA_DIR || 'artifacts/portable-report-flat-today-20261026';mkdirSync(out,{recursive:true});
  const evidence=[];
  try {
    const page = await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const url=`http://127.0.0.1:${server.address().port}`;
    for(const width of [768,1024,1280,1417,1904]){
      await page.setViewportSize({width,height:898});await page.goto(url);
      const cash=page.locator('[data-amount="cashAmount"]');await cash.waitFor();
      await page.waitForFunction(()=>!document.body.textContent.includes('Loading saved amounts'));
      assert.equal(await page.locator('input[type=date]').count(),0);
      assert.equal(await page.evaluate(()=>window.requestedReportDate),undefined, 'page ignores historical query date');
      const metrics=await page.evaluate(()=>{
        const page=document.querySelector('[data-portable-pos-page=report]'),nav=document.querySelector('nav'),active=nav.querySelector('[aria-current=page]'),heading=page.querySelector('h2');
        return{width:innerWidth,scroll:document.documentElement.scrollWidth,background:getComputedStyle(page).backgroundColor,
          panelBackground:getComputedStyle(heading.parentElement.parentElement).backgroundColor,
          activeShadow:getComputedStyle(active).boxShadow,activeBg:getComputedStyle(active).backgroundColor,
          activeRadius:getComputedStyle(active).borderRadius,activeColor:getComputedStyle(active).color,
          iconColor:getComputedStyle(active.querySelector('svg')).color,
          activeTop:active.getBoundingClientRect().top,activeBottom:active.getBoundingClientRect().bottom,
          barTop:nav.parentElement.getBoundingClientRect().top,barBottom:nav.parentElement.getBoundingClientRect().bottom,
          navX:nav.getBoundingClientRect().left,brandRight:nav.previousElementSibling.getBoundingClientRect().right,
          firstLinkX:nav.firstElementChild.getBoundingClientRect().left,headingX:heading.getBoundingClientRect().left,
          pageBottom:page.getBoundingClientRect().bottom,height:innerHeight};
      });
      assert.ok(metrics.scroll<=width,JSON.stringify(metrics));assert.equal(metrics.background,'rgb(255, 255, 255)');
      assert.equal(metrics.activeShadow,'none');assert.notEqual(metrics.activeBg,'rgba(0, 0, 0, 0)');
      assert.equal(metrics.activeRadius,'0px');assert.equal(metrics.activeBg,'rgb(231, 247, 245)');
      assert.equal(metrics.activeColor,'rgb(0, 122, 117)');assert.equal(metrics.iconColor,metrics.activeColor);
      assert.equal(metrics.activeTop,metrics.barTop);assert.equal(metrics.activeBottom,metrics.barBottom);
      assert.ok(metrics.headingX>=24);
      assert.ok(metrics.pageBottom>=metrics.height, 'white report canvas fills the viewport');
      if(width>=1280){assert.ok(metrics.navX-metrics.brandRight<=16);assert.ok(metrics.firstLinkX-metrics.navX<2);}
      evidence.push(metrics);await page.screenshot({path:`${out}/report-${width}.png`,fullPage:true});
    }
    await page.locator('[data-amount="cashAmount"]').fill('226');
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.waitForFunction(()=>window.posts.length===1);
    assert.equal(await page.evaluate(()=>window.posts[0].reportDate),'2026-10-26');
    assert.equal(await page.evaluate(()=>Number(window.posts[0].cashAmount)),226);
    await page.goto(url+'/?stale');await page.getByRole('alert').waitFor();
    assert.equal(await page.locator('[data-amount]').count(),0,'stale amounts are hidden after midnight');
    assert.equal(await page.getByRole('button',{name:'Reload',exact:true}).count(),1);
    assert.deepEqual(errors,[]);writeFileSync(`${out}/browser-evidence.json`,JSON.stringify(evidence,null,2));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
