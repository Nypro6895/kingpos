import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

test('compact POS keeps Submit visible and edits adjustments with a touch dialog', {
  skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH,
  timeout: 120000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {PosDeskClient} from './app/pos/pos-desk-client';
      createRoot(document.getElementById('root')).render(
        <main className="portable-kiosk-surface flex h-dvh flex-col overflow-hidden bg-zinc-100">
          <header style={{height:80,flexShrink:0}}>POS test</header>
          <div className="min-h-0 flex-1 p-2">
            <PosDeskClient surface="portable" activeSession={{id:'fixture',status:'active',lines:[{id:'line',staff_id:'staff',staff_name:'Alex',service_id:'service',service_label:'Manicure',sort_order:1,amount:100,amount_input:'100',amount_parts:[100],turn_large_count:1,turn_small_count:0}]}} liveDraft={null} salonName="Test salon" services={[]} staff={[]}
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
        ? 'const router={refresh(){},push(){},replace(){}}; export const useRouter=()=>router; export const usePathname=()=>"/pos/portable";'
        : 'export const createSupabaseBrowserClient=()=>null;' }));
      build.onResolve({ filter: /\/actions$/ }, ({ path, importer }) => ({
        path: resolve(path.startsWith('@/') ? path.slice(2) : join(dirname(importer), path)) + '.ts', namespace: 'actions',
      }));
      build.onLoad({ filter: /.*/, namespace: 'actions' }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const names = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(match => match[1]);
        return { contents: names.map(name => `export async function ${name}(){throw Error('Unexpected server action: ${name}');}`).join('\n') };
      });
    } }],
  });
  const js = built.outputFiles.find(file => file.path.endsWith('.js')).text;
  const moduleCss = built.outputFiles.find(file => file.path.endsWith('.css'))?.text || '';
  const globalCss = await postcss([tailwindcss()]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') });
  const css = globalCss.css + '\n' + moduleCss;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : req.url === '/app.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/app.js' ? js : req.url === '/app.css' ? css : '<link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const panel = page.locator('[data-pos-amount-panel]');
    await panel.waitFor();
    assert.equal(await panel.locator('[data-pos-adjustments]').isVisible(), true);
    assert.equal(await panel.locator('[data-pos-compact-adjustments]').isVisible(), false);
    for (const viewport of [{width:1100,height:760},{width:900,height:620},{width:1280,height:720},{width:1920,height:700},{width:1000,height:1100}]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-pos-compact-adjustments]')).display !== 'none');
      assert.equal(await panel.locator('[data-pos-adjustments]').isVisible(), false);
      const submit = panel.getByRole('button', { name: 'Submit', exact: true });
      const box = await submit.boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `Submit must fit at ${JSON.stringify(viewport)}`);
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width, 'Submit must fit horizontally');
      assert.ok(await submit.evaluate(el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }), 'Submit must not be clipped');
      await panel.locator('[data-pos-amount-scroll]').evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.equal((await submit.boundingBox()).y, box.y, 'Submit stays anchored while scrolling');
    }
    await page.setViewportSize({width:900,height:620});
    const compact = panel.locator('[data-pos-compact-adjustments]');
    await compact.getByRole('button', {name:'Discount',exact:true}).tap();
    let dialog = page.getByRole('dialog', { name: 'Discount', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('button',{name:'% Percent',exact:true}).tap();
    await dialog.getByRole('button',{name:'1',exact:true}).tap();
    await dialog.getByRole('button',{name:'5',exact:true}).tap();
    assert.equal(await dialog.getByLabel('Discount percent',{exact:true}).inputValue(),'15');
    await dialog.getByRole('button',{name:'Apply',exact:true}).tap();
    await compact.getByRole('button',{name:'Discount: 15%',exact:true}).waitFor();
    await compact.getByRole('button',{name:'Discount: 15%',exact:true}).tap();
    dialog = page.getByRole('dialog',{name:'Discount',exact:true});
    await dialog.getByLabel('Discount percent',{exact:true}).fill('101');
    assert.equal(await dialog.getByRole('button',{name:'Apply',exact:true}).isEnabled(),false);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Discount: 15%');
    await compact.getByRole('button',{name:'Tip',exact:true}).tap();
    dialog = page.getByRole('dialog',{name:'Tip',exact:true});
    await dialog.getByRole('button',{name:'$10',exact:true}).tap();
    await dialog.getByRole('button',{name:'Apply',exact:true}).tap();
    await compact.getByRole('button',{name:'Tip: $10.00',exact:true}).waitFor();
    await compact.getByRole('button',{name:'Tip: $10.00',exact:true}).tap();
    await page.getByLabel('Tip amount',{exact:true}).fill('99');
    await dialog.getByRole('button',{name:'Cancel',exact:true}).tap();
    await compact.getByRole('button',{name:'Tip: $10.00',exact:true}).waitFor();
    await compact.getByRole('button',{name:'Tip: $10.00',exact:true}).tap();
    await dialog.getByRole('button',{name:'Clear',exact:true}).tap();
    await dialog.getByRole('button',{name:'2',exact:true}).tap();
    await dialog.getByRole('button',{name:'.',exact:true}).tap();
    await dialog.getByRole('button',{name:'5',exact:true}).tap();
    await dialog.getByRole('button',{name:'Apply',exact:true}).tap();
    await compact.getByRole('button',{name:'Tip: $2.50',exact:true}).waitFor();
    assert.match(await page.locator('[data-pos-receipt-total]').innerText(), /\$87\.50/);
    if (process.env.KINGPOS_UI_SCREENSHOT_DIR) {
      await mkdir(process.env.KINGPOS_UI_SCREENSHOT_DIR,{recursive:true});
      await page.screenshot({path:join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'compact-checkout.png')});
      await compact.getByRole('button',{name:'Tip: $2.50',exact:true}).tap();
      await page.screenshot({path:join(process.env.KINGPOS_UI_SCREENSHOT_DIR,'compact-tip-popup.png')});
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-pos-compact-adjustments]')).display === 'none');
    assert.equal(await panel.locator('[data-pos-adjustments]').isVisible(),true);
    await page.setViewportSize({width:900,height:620});
    await compact.getByRole('button',{name:'Tip: $2.50',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
