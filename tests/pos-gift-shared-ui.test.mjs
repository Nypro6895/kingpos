import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

test('POS single lower gift card and shared customer dialog/session', {

  timeout: 120000,
}, async () => {
  const { build } = await import('esbuild');
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {GiftCustomerControl} from './components/gift-card/pos-gift-card';
      import {PosDeskClient} from './app/pos/pos-desk-client';
      import {setSupplementalKeyboard} from './lib/portable-keyboard-preference';window.setSupplementalKeyboard=setSupplementalKeyboard;
      createRoot(document.getElementById('root')).render(
        location.pathname==='/customer'?<GiftCustomerControl token='fixture-token'/>:<main className="portable-kiosk-surface flex h-dvh flex-col overflow-hidden bg-zinc-100">
          <header style={{height:80,flexShrink:0}}>POS test</header>
          <div className="min-h-0 flex-1 p-2">
            <PosDeskClient surface="portable" actions={{searchPosDeskCustomers:async()=>[],getPosLiveDraft:async()=>({ok:true,data:null})}} activeSession={{id:'fixture',status:'active',lines:[{id:'line',staff_id:'staff',staff_name:'Alex',service_id:'service',service_label:'Manicure',sort_order:1,amount:100,amount_input:'100',amount_parts:[100],turn_large_count:1,turn_small_count:0}]}} liveDraft={{id:'draft',token:'fixture-token',status:'draft',salon_id:'salon',version:1,customer:null,staff_lines:[],subtotal:100,tax:0,total:100,total_before_tip:100,tip:0,discount:0,server_now:new Date().toISOString()}} salonName="Test salon" services={[]} staff={[]}
              defaults={{tipSuggestions:[5,10,15,20],largeTurnThreshold:25,showServiceName:true,showStaffName:true,staffCheckInEnabled:false}} />
          </div>
        </main>);
    ` },
    bundle: true, write: false, outdir: 'fixture', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'isolate-backend', setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
      build.onResolve({ filter: /supabase\/browser$/ }, () => ({ path: 'supabase', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'navigation'
        ? 'const router={refresh(){},push(){},replace(){}}; export const useRouter=()=>router; export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>"/pos/portable";'
        : 'export const createSupabaseBrowserClient=()=>null;' }));
      build.onResolve({ filter: /\/actions$/ }, ({ path, importer }) => ({
        path: resolve(path.startsWith('@/') ? path.slice(2) : join(dirname(importer), path)) + '.ts', namespace: 'actions',
      }));
      build.onLoad({ filter: /.*/, namespace: 'actions' }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const names = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(match => match[1]);
        return { contents: names.map(name => `export async function ${name}(){window.qaCalls??=[];window.qaCalls.push('${name}');return {ok:false,error:'Synthetic QA: no backend writes'};}`).join('\n') };
      });
    } }],
  });
  const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
  const moduleCss = built.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const sources='@source "'+resolve('app').split(String.fromCharCode(92)).join('/')+'";';
  const globals = (await readFile('app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n'+sources);
  const globalCss = await postcss([tailwindcss()]).process(globals, { from: resolve('app/globals.css') });
  assert.ok(globalCss.css.includes('.h-dvh'),'Render the real portable layout utilities');
  const css = globalCss.css + '\n' + moduleCss;

  let session={id:'shared-synthetic',revision:1,prompt:0,mode:'use',entry:'code',status:'open',amount:0,total:10000,purchase:0,card:null,approved:false,qrVisible:false,mobile:'synthetic-mobile',expires:new Date(Date.now()+600000).toISOString()};let custom=false;const ops=[];
  const server=createServer(async(req,res)=>{if(req.url==='/gift-cards/shared-default.webp'){res.setHeader('Content-Type','image/webp');res.end(await readFile('public/gift-cards/shared-default.webp'));return;}if(req.url==='/api/gift-cards'){let raw='';for await(const c of req)raw+=c;const q=JSON.parse(raw);ops.push(q.op);res.setHeader('Content-Type','application/json');if(q.op==='appearance'){res.end(JSON.stringify({salonName:'Test salon',design:custom?{background:'#ece1ef',color:'#46224a',image:'',logo:'',elements:[{id:'title',kind:'text',text:'Owner saved design',x:50,y:50,size:24,font:'serif'}]}:undefined}));return;}if(q.op==='open')session={...session,...q.args,revision:session.revision+1,prompt:session.prompt+1,qrVisible:q.args.entry==='scan'};if(q.op==='buy')session={...session,purchase:q.args.amount,revision:session.revision+1};res.end(JSON.stringify({installed:true,session}));return;}res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/app.css'?'text/css':'text/html');res.end(req.url==='/app.js'?js:req.url==='/app.css'?css:'<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const out=resolve('artifacts/checkin-design-20261110');await mkdir(out,{recursive:true});
  try{const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);const slot=page.locator('[data-pos-gift-card-slot]');await slot.getByRole('button',{name:'Use a card',exact:true}).waitFor();assert.equal(await page.locator('[data-gift-pos]').count(),1);assert.equal(await page.locator('[data-pos-gift-card-placeholder]').count(),0);assert.equal(await page.locator('[data-pos-amount-panel] [data-gift-pos]').count(),1);const bounds=await slot.boundingBox(),adj=await page.locator('[data-pos-adjustments]').boundingBox();assert.ok(bounds.y>=adj.y+adj.height,'Gift card below Discount/Tip');await page.screenshot({path:join(out,'pos-gift-lower.png'),fullPage:true});
  const customer=await browser.newPage({viewport:{width:1366,height:768}});await customer.goto(origin+'/customer');await customer.getByRole('button',{name:'Use a card',exact:true}).waitFor();await page.bringToFront();await slot.getByRole('button',{name:'Use a card',exact:true}).click();const d=page.getByRole('dialog',{name:'Gift card',exact:true});await d.locator('[data-gift-artwork="default"]').waitFor();await d.getByRole('button',{name:'Customer wallet',exact:true}).waitFor();await d.locator('[data-gift-artwork="default"] img').evaluate(img=>img.decode());assert.ok(await d.locator('[data-gift-artwork="default"] img').evaluate(img=>img.naturalWidth>0));await page.screenshot({path:join(out,'pos-gift-popup.png'),fullPage:true});await customer.bringToFront();const cd=customer.getByRole('dialog',{name:'Gift card',exact:true});await cd.locator('[data-gift-artwork="default"]').waitFor();assert.equal(await cd.getByRole('button',{name:'Customer wallet',exact:true}).count(),0);assert.equal(await cd.locator('.gc-approved-columns').count(),await d.locator('.gc-approved-columns').count());await customer.screenshot({path:join(out,'shared-gift-customer.png'),fullPage:true});
  await cd.getByRole('button',{name:'Buy a gift card',exact:true}).click();await cd.getByRole('textbox',{name:'Gift card amount',exact:true}).fill('50');await cd.getByRole('button',{name:'Add $50 to purchase',exact:true}).click();await page.bringToFront();await d.getByText('$50.00 requested.',{exact:false}).waitFor();assert.equal(await d.getByRole('button',{name:'Buy a gift card',exact:true}).getAttribute('aria-pressed'),'true');await page.screenshot({path:join(out,'pos-gift-synced-buy.png'),fullPage:true});
  await d.getByRole('button',{name:'Close gift card',exact:true}).click();custom=true;await slot.getByRole('button',{name:'Use a card',exact:true}).click();await d.getByText('Owner saved design',{exact:true}).waitFor();assert.equal(await d.locator('[data-gift-artwork="default"]').count(),0);await page.keyboard.press('Escape');
  for(const v of [{width:1024,height:768},{width:900,height:620}]){await page.setViewportSize(v);await slot.scrollIntoViewIfNeeded();assert.ok(await slot.evaluate(e=>e.scrollWidth<=e.clientWidth+1));const submit=await page.locator('[data-pos-checkout-actions]').getByRole('button',{name:'Submit',exact:true}).boundingBox();assert.ok(submit.y>=0&&submit.y+submit.height<=v.height,'Submit visible');}
  assert.deepEqual(errors,[]);assert.equal(ops.includes('submit'),false,'No sale submission');const{writeFile}=await import('node:fs/promises');await writeFile(join(out,'pos-gift-browser-result.json'),JSON.stringify({passed:true,synthetic:true,oneLowerEntry:true,sharedSession:true,defaultAndOwnerDesign:true,noFinancialSubmission:true,ops},null,2));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
