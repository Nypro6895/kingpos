import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

// Only the text boundary and the remote callbacks are synthetic. Exercise the
// production React hook, normalization, persistence and notice together.
const sourceRoot = resolve(process.env.DAILY_CLOSING_SOURCE_ROOT || process.cwd());
const row = (card = 150, extra = {}) => ({ cashAmount: 0, creditCardAmount: card, otherAmount: 0, note: null, status: 'balanced', ...extra });
const values = (card = '150', extra = {}) => ({ cashAmount: '', creditCardAmount: card, otherAmount: '', note: '', ...extra });
const scopeA = 'closing:salon-a:2026-10-21';
let browser, server, origin;

before(async () => {
  const output = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useEffect, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {useDailyClosingSave, closingSessionStorage} from '@/lib/daily-closing-save';
      import {ClosingSaveNotice} from '@/app/reports/closing-save-notice';
      window.requests=[];window.reads=[];window.notifications=0;
      window.saveMode='immediate';window.readMode='immediate';
      function App(){
        const [config,setConfig]=useState(window.boot);
        window.patch=next=>setConfig(old=>({...old,...next}));
        const closing=useDailyClosingSave({initial:config.initial, storageKey:config.storageKey,
          storage:closingSessionStorage,readOnly:!!config.readOnly,
          save:(values,expected)=>{
            const captured={values,expected,storageKey:config.storageKey};
            const promise=new Promise((resolve,reject)=>Object.assign(captured,{resolve,reject}));
            window.requests.push(captured);
            if(window.saveMode==='immediate') captured.resolve({...expected,cashAmount:Number(values.cashAmount||0),creditCardAmount:Number(values.creditCardAmount||0),otherAmount:Number(values.otherAmount||0),note:values.note.trim()||null});
            if(window.saveMode==='reject') captured.reject(new Error('Synthetic connection interruption'));
            return promise;
          },
          read:()=>{
            const captured={storageKey:config.storageKey};
            const promise=new Promise((resolve,reject)=>Object.assign(captured,{resolve,reject}));
            window.reads.push(captured);
            if(window.readMode==='immediate') captured.resolve({closingInputs:config.initial,readOnly:!!config.readOnly});
            return promise;
          },onSaved:()=>window.notifications++});
        useEffect(()=>{window.api=closing;window.config=config;});
        return <main><label>Card<input aria-label="Card" value={closing.values.creditCardAmount} onChange={event=>closing.updateValue('creditCardAmount',event.target.value)}/></label>
          <label>Note<input aria-label="Note" value={closing.values.note} onChange={event=>closing.updateValue('note',event.target.value)}/></label>
          <button disabled={closing.blocked} onClick={()=>void closing.save(true)}>Save</button>
          <div data-notice><ClosingSaveNotice {...closing}/></div>
          <output data-phase>{closing.phase}</output></main>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', alias: { '@': sourceRoot }, nodePaths: [resolve('node_modules')],
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'closing-text-boundary', setup(builder) {
      builder.onResolve({ filter: /workspace-language$/ }, () => ({ path: 'text', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const WorkspaceText=({text})=>text;', loader: 'tsx' }));
    } }],
  });
  const js = output.outputFiles[0].text;
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? js : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const useWebKit = process.env.TEST_BROWSER_ENGINE === 'webkit';
  browser = await (useWebKit ? webkit : chromium).launch({ headless: true, executablePath: process.env.TEST_BROWSER_PATH,
    ...(useWebKit ? {} : { args: ['--no-proxy-server'], channel: process.env.TEST_BROWSER_PATH ? undefined : 'chrome' }) });
});
after(async () => { await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); });

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 40)));
}
async function fixture(t, { initial = row(), storageKey = scopeA, draft, readOnly = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'no browser runtime errors'); });
  await page.addInitScript(({ initial, storageKey, draft, readOnly }) => {
    window.boot = JSON.parse(sessionStorage.getItem('fixture:boot') ?? 'null') ?? { initial, storageKey, readOnly };
    if (!sessionStorage.getItem('fixture:seeded')) {
      sessionStorage.setItem('fixture:seeded', 'yes');
      if (draft) sessionStorage.setItem(storageKey, JSON.stringify(draft));
    }
  }, { initial, storageKey, draft, readOnly });
  await page.goto(origin);
  await page.waitForFunction(() => window.api && window.api.phase !== 'loading');
  await settle(page);
  return page;
}
async function patch(page, changes) {
  await page.evaluate(next => window.patch(next), changes);
  await page.waitForFunction(next => Object.entries(next).every(([key, value]) => JSON.stringify(window.config?.[key]) === JSON.stringify(value)), changes);
  if (changes.initial) await page.waitForFunction(initial => JSON.stringify(window.api?.latest) === JSON.stringify(initial), changes.initial);
  // A page reload receives the latest synthetic server props, just as a real
  // navigation would. Keep this separate from the production draft storage.
  await page.evaluate(() => sessionStorage.setItem('fixture:boot', JSON.stringify(window.config)));
  await settle(page);
}
async function state(page) { return page.evaluate(() => ({ phase: window.api.phase, values: window.api.values, baseline: window.api.baseline, latest: window.api.latest, pending: window.api.pending, blocked: window.api.blocked })); }
async function quiet(page) {
  assert.notEqual((await state(page)).phase, 'review');
  assert.equal((await page.locator('[data-notice]').innerText()).trim(), '');
  assert.equal(await page.getByRole('button', { name: 'Check saved result', exact: true }).count(), 0);
}
async function capture(page, name) {
  if (!process.env.DAILY_CLOSING_SCREENSHOT_DIR) return;
  const directory = resolve(process.env.DAILY_CLOSING_SCREENSHOT_DIR);
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}-${process.env.TEST_BROWSER_ENGINE || 'chromium'}.png`), fullPage: true });
}

test('fresh load and unchanged refetch stay quiet without writes', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await quiet(page);
  await patch(page, { initial: row() });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '150.00');
  assert.equal(await page.evaluate(() => window.requests.length), 0);
  await capture(page, 'daily-closing-clean-fixture');
});

test('same monetary values ignore field order, status and null/empty/space note differences', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { initial: { note: '  ', status: 'over', otherAmount: 0, creditCardAmount: 150, cashAmount: 0, updatedAt: 'synthetic-new-timestamp' } });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  assert.equal((await state(page)).baseline.status, 'over', 'CAS baseline adopts current metadata without a false conflict');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  assert.equal(await page.evaluate(() => window.requests[0].expected.status), 'over');
  assert.equal(await page.evaluate(() => window.requests[0].expected.note), '  ', 'preserve the full current row for optimistic locking');
});

test('untouched initial snapshot hydrates to refreshed values silently', { timeout: 15000 }, async t => {
  const page = await fixture(t, { initial: row(0) });
  await patch(page, { initial: row(150) });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '150.00');
  assert.equal(await page.evaluate(() => window.requests.length), 0);
});

test('clean stale restored draft adopts the current report without review', { timeout: 15000 }, async t => {
  const page = await fixture(t, { initial: row(150), draft: { version: 1, values: values('100'), baseline: row(100), pending: null } });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '150.00');
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), scopeA), null);
});

test('restored draft already equal to current report is cleared silently', { timeout: 15000 }, async t => {
  const page = await fixture(t, { initial: row(150), draft: { version: 1, values: values('150.0', { cashAmount: '0.00', note: '  ' }), baseline: row(100), pending: null } });
  await quiet(page);
  assert.equal(Number(await page.getByLabel('Card').inputValue()), 150);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), scopeA), null);
});

test('dirty draft survives restore and reload when remote still equals baseline', { timeout: 15000 }, async t => {
  const page = await fixture(t, { draft: { version: 1, values: values('175'), baseline: row(), pending: null } });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  await page.reload();
  await page.waitForFunction(() => window.api && window.api.phase !== 'loading');
  await settle(page);
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  assert.equal(await page.evaluate(() => window.requests.length), 0);
});

test('real remote edit preserves dirty input and blocks writes until reviewed', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { initial: row(200) });
  assert.equal((await state(page)).phase, 'review');
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  await page.evaluate(() => { void window.api.save(true); });
  assert.equal(await page.evaluate(() => window.requests.length), 0);
  await page.getByRole('button', { name: 'Use saved amounts', exact: true }).click();
  await settle(page);
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '200.00');
});

test('normal conflict has one compact review notice and no redundant check button', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { initial: row(200, { note: 'Remote note' }) });
  assert.equal((await state(page)).phase, 'review');
  assert.equal(await page.getByRole('button', { name: 'Check saved result', exact: true }).count(), 0);
  const status = page.locator('[data-notice] [role="status"]');
  assert.equal(await status.count(), 1);
  const panel = status.locator('..');
  assert.equal(await panel.getByRole('button').count(), 2, 'message, current amounts and review actions share one panel');
  assert.match(await panel.innerText(), /200\.00/);
  assert.match(await page.locator('[data-notice]').innerText(), /200\.00/);
  await capture(page, 'daily-closing-conflict-fixture');
});

test('keeping conflicting entries requires an explicit save against reviewed remote values', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { initial: row(200) });
  await page.evaluate(() => window.api.review(false));
  await settle(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  await page.evaluate(() => { void window.api.save(); });
  assert.equal(await page.evaluate(() => window.requests.length), 0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  assert.equal(await page.evaluate(() => window.requests[0].expected.creditCardAmount), 200);
});

test('remote convergence with the current draft resolves existing false conflict quietly', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { initial: row(200) });
  assert.equal((await state(page)).phase, 'review');
  await patch(page, { initial: row(175) });
  await quiet(page);
  assert.equal(Number(await page.getByLabel('Card').inputValue()), 175);
  assert.equal(await page.evaluate(() => window.requests.length), 0);
});

test('own acknowledged save followed by equivalent server refetch stays quiet', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.api.phase === 'saved');
  await patch(page, { initial: { status: 'over', note: '', cashAmount: 0, otherAmount: 0, creditCardAmount: 175 } });
  await quiet(page);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
  assert.equal(await page.evaluate(() => window.notifications), 1);
});

test('pending uncertain save stays protected even when refetch matches its values', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'reject'; });
  await page.getByLabel('Card').fill('175');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.api.phase === 'unknown');
  await patch(page, { initial: row(175) });
  assert.equal((await state(page)).phase, 'unknown');
  assert.ok((await state(page)).pending);
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Check saved result', exact: true }).count(), 1);
  await page.evaluate(() => { void window.api.save(true); });
  assert.equal(await page.evaluate(() => window.requests.length), 1);
});

test('pending restore is preserved rather than discarded as a matching stale draft', { timeout: 15000 }, async t => {
  const pending = { values: values('175'), expectedClosing: row() };
  const page = await fixture(t, { initial: row(175), draft: { version: 1, values: values('175'), baseline: row(), pending } });
  assert.equal((await state(page)).phase, 'unknown');
  assert.ok((await state(page)).pending);
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await page.waitForFunction(() => window.api.pending === null);
  await quiet(page);
  assert.equal(Number(await page.getByLabel('Card').inputValue()), 175);
});

test('business date and salon switches isolate drafts and restore them when returning', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { storageKey: 'closing:salon-a:2026-10-22', initial: row(300) });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '300.00');
  await page.getByLabel('Card').fill('325');
  await patch(page, { storageKey: 'closing:salon-b:2026-10-22', initial: row(500) });
  assert.equal(await page.getByLabel('Card').inputValue(), '500.00');
  await patch(page, { storageKey: scopeA, initial: row(150) });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  await patch(page, { storageKey: 'closing:salon-a:2026-10-22', initial: row(300) });
  assert.equal(await page.getByLabel('Card').inputValue(), '325');
  assert.equal(await page.evaluate(() => window.requests.length), 0);
});

test('late save from prior scope cannot overwrite the next salon or its draft', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'hold'; });
  await page.getByLabel('Card').fill('175');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  await patch(page, { storageKey: 'closing:salon-b:2026-10-21', initial: row(500) });
  assert.equal(await page.getByLabel('Card').inputValue(), '500.00');
  await page.getByLabel('Card').fill('525');
  await page.evaluate(saved => window.requests[0].resolve(saved), row(175));
  await settle(page);
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '525');
  assert.equal((await state(page)).baseline.creditCardAmount, 500);
  assert.equal(await page.evaluate(() => window.notifications), 0);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('closing:salon-b:2026-10-21')).values.creditCardAmount), '525');
});

test('read-only changes still block saves without inventing amount conflicts', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('175');
  await patch(page, { initial: row(150, { status: 'locked' }), readOnly: true });
  await quiet(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '175');
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  await page.evaluate(() => { void window.api.save(true); });
  assert.equal(await page.evaluate(() => window.requests.length), 0);
});

test('formatting-only edits during save acknowledge cleanly without a newer-edits notice', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'hold'; });
  await page.getByLabel('Card').fill('175');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  await page.getByLabel('Card').fill('175.00');
  await page.getByLabel('Note').fill('   ');
  await page.evaluate(saved => window.requests[0].resolve(saved), row(175));
  await page.waitForFunction(() => window.api.pending === null);
  assert.equal((await state(page)).phase, 'saved');
  await quiet(page);
  assert.equal((await state(page)).pending, null);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), scopeA), null);
});

test('true newer edits during a pending save remain unsaved and never get overwritten', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'hold'; });
  await page.getByLabel('Card').fill('175');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  await page.getByLabel('Card').fill('180');
  await page.getByLabel('Note').fill('New local note');
  await page.evaluate(saved => window.requests[0].resolve(saved), row(175));
  await page.waitForFunction(() => window.api.pending === null);
  assert.equal(await page.getByLabel('Card').inputValue(), '180');
  assert.equal(await page.getByLabel('Note').inputValue(), 'New local note');
  assert.equal((await state(page)).baseline.creditCardAmount, 175);
  await page.evaluate(() => { void window.api.save(); });
  assert.equal(await page.evaluate(() => window.requests.length), 1, 'newer edits require explicit save');
});

test('first explicit all-zero save is preserved but never repeated after acknowledgement', { timeout: 15000 }, async t => {
  const page = await fixture(t, { initial: row(0) });
  await page.evaluate(() => { void window.api.save(); });
  assert.equal(await page.evaluate(() => window.requests.length), 0, 'pristine zero blur is not a write');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.api.phase === 'saved');
  assert.equal(await page.evaluate(() => window.requests.length), 1);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await settle(page);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
  await quiet(page);
});

test('matching zero refetch and readback never silently confirm an unresolved zero save', { timeout: 15000 }, async t => {
  const page = await fixture(t, { initial: row(0) });
  await page.evaluate(() => { window.saveMode = 'reject'; });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.api.phase === 'unknown');
  await patch(page, { initial: row(0, { status: 'short', note: '' }) });
  assert.equal((await state(page)).phase, 'unknown');
  assert.ok((await state(page)).pending);
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await page.waitForFunction(() => window.api.phase === 'review');
  assert.ok((await state(page)).pending);
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Check saved result', exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
});

test('readback of matching nonzero pending save preserves newer local edits', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'reject'; });
  await page.getByLabel('Card').fill('175');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.api.phase === 'unknown');
  await page.getByLabel('Card').fill('180');
  await patch(page, { initial: row(175) });
  await page.getByRole('button', { name: 'Check saved result', exact: true }).click();
  await page.waitForFunction(() => window.api.pending === null);
  assert.equal(await page.getByLabel('Card').inputValue(), '180');
  assert.equal((await state(page)).baseline.creditCardAmount, 175);
  await page.evaluate(() => { void window.api.save(); });
  assert.equal(await page.evaluate(() => window.requests.length), 1);
});

test('typing the old baseline during conflict never adopts remote amounts over that input', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.getByLabel('Card').fill('200');
  await patch(page, { initial: row(250) });
  assert.equal((await state(page)).phase, 'review');
  await page.getByLabel('Card').fill('150');
  assert.equal(await page.getByLabel('Card').inputValue(), '150');
  assert.equal((await state(page)).phase, 'review');
  assert.equal((await state(page)).latest.creditCardAmount, 250);
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  await patch(page, { initial: row(250, { status: 'over', updatedAt: 'synthetic-later' }) });
  assert.equal(await page.getByLabel('Card').inputValue(), '150');
  assert.equal((await state(page)).phase, 'review');
  await page.evaluate(() => { void window.api.checkSaved(); });
  await page.waitForFunction(() => window.api.phase !== 'checking');
  assert.equal(await page.getByLabel('Card').inputValue(), '150');
  assert.equal((await state(page)).phase, 'review');
  await page.reload();
  await page.waitForFunction(() => window.api && window.api.phase !== 'loading');
  await settle(page);
  assert.equal(await page.getByLabel('Card').inputValue(), '150');
  assert.equal((await state(page)).phase, 'review');
  assert.equal((await state(page)).latest.creditCardAmount, 250);
});

test('a newer remote refresh arriving during own save survives its earlier acknowledgement', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'hold'; });
  await page.getByLabel('Card').fill('200');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  await patch(page, { initial: row(250) });
  await page.evaluate(saved => window.requests[0].resolve(saved), row(200));
  await page.waitForFunction(() => window.api.pending === null);
  await quiet(page);
  assert.equal(Number(await page.getByLabel('Card').inputValue()), 250);
  assert.equal((await state(page)).baseline.creditCardAmount, 250);
  await patch(page, { initial: row(250) });
  await quiet(page);
  assert.equal(Number(await page.getByLabel('Card').inputValue()), 250);
});

test('newer local edits and remote refresh during save retain both sides for review', { timeout: 15000 }, async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.saveMode = 'hold'; });
  await page.getByLabel('Card').fill('200');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.requests.length === 1);
  await page.getByLabel('Card').fill('220');
  await patch(page, { initial: row(250) });
  await page.evaluate(saved => window.requests[0].resolve(saved), row(200));
  await page.waitForFunction(() => window.api.pending === null);
  assert.equal((await state(page)).phase, 'review');
  assert.equal(await page.getByLabel('Card').inputValue(), '220');
  assert.equal((await state(page)).latest.creditCardAmount, 250);
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.requests.length), 1);
});
