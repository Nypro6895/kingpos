import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const executablePath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
async function fixture() {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
import{usePortableDraft}from'@/app/pos/portable/use-portable-draft';
import{OwnerQueueRuntime}from'@/app/pos/owner-queue-runtime';
import{usePosResourceRefresh}from'@/lib/pos-workspace-sync';
import{useLiveExperienceRefresh}from'@/lib/use-live-experience-refresh';
import*as ops from'@/lib/portable-operations';window.ops=ops;
const scope='owner:fixture-salon:fixture-viewer',resources=['staff','tickets'];
function Draft(){const[amount,setAmount]=useState('');const draft=usePortableDraft({scope:'fixture-salon:live-draft',operationScope:'fixture-salon:device-key',version:1,recovery:{amount},emptyRecovery:{amount:''},restore:v=>setAmount(v.amount),onVersion(){}});window.recoveryKey=()=>draft.recoveryKey.current;return <><p role='status'>{draft.status}</p><input aria-label='Amount' disabled={!draft.ready} value={amount} onChange={e=>{const value=e.target.value;setAmount(value);draft.persistLocal({token:'live-draft',selectedStaffId:null,staffLines:[],customer:null,discount:0,subtotal:Number(value),tax:0,tip:0,total:Number(value),totalBeforeTip:Number(value)},{amount:value})}}/></>}
function Resume(){const[value,setValue]=useState(''),[staff,setStaff]=useState(0),[pay,setPay]=useState(0);usePosResourceRefresh('fixture-salon','staff',async()=>{const r=await fetch('/staff-read');setStaff((await r.json()).version)},{initialReconcile:false});useLiveExperienceRefresh('fixture-salon',resources,async()=>{const r=await fetch('/pay-read');setPay((await r.json()).version)});return <><OwnerQueueRuntime scope={scope}/><input aria-label='Unsubmitted filter' value={value} onChange={e=>setValue(e.target.value)}/><output data-staff>{staff}</output><output data-pay>{pay}</output></>}
function RetainedDraft(){const[visible,setVisible]=useState(true);window.setDraftVisible=setVisible;return <Activity mode={visible?'visible':'hidden'}><Draft/></Activity>}
createRoot(document.getElementById('root')).render(location.pathname==='/draft'?<Draft/>:location.pathname==='/retained'?<RetainedDraft/>:<Resume/>);
` }, bundle: true, write: false, jsx: 'automatic', alias: { '@': process.cwd() },
    plugins: [{ name: 'local-only', setup(builder) {
      builder.onResolve({ filter: /(?:workspace-language|supabase\/browser)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path.endsWith('workspace-language')
        ? 'export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return s=>s}'
        : 'export function createSupabaseBrowserClient(){return null}' }));
    } }] });
  const requests = [], committed = new Set();
  let loseReply = true, reads = { staff: 0, pay: 0 };
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return; }
    if (request.url === '/staff-read' || request.url === '/pay-read') {
      const kind = request.url === '/staff-read' ? 'staff' : 'pay';
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ version: ++reads[kind] })); return;
    }
    if (request.url === '/api/pos/owner/operations') {
      let text = ''; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text); requests.push(body); committed.add(body.id);
      if (loseReply) { loseReply = false; response.destroy(); return; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ kind: 'ok', data: { ticketId: body.id } })); return;
    }
    if (request.url.startsWith('/api/')) { response.writeHead(503); response.end('{}'); return; }
    response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    window.__reylumiNativePayments = 1;
    window.webkit = { messageHandlers: { reylumi: { postMessage() {} } } };
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  return { context, origin, requests, committed, reads, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('native POS recovery survives a new WebView and sessionStorage, protects the writer, and honors the submitted checkpoint', { skip: !existsSync(executablePath), timeout: 40000 }, async () => {
  const app = await fixture();
  try {
    const first = await app.context.newPage(); await first.goto(app.origin + '/draft');
    await first.getByLabel('Amount').fill('125.75');
    const saved = await first.evaluate(() => ({ key: window.recoveryKey(), value: JSON.parse(localStorage.getItem(window.recoveryKey())) }));
    assert.ok(saved.key.endsWith(':native'));
    const second = await app.context.newPage(); await second.goto(app.origin + '/draft');
    await second.getByText('POS is already open in another window. Continue there or close it first.').waitFor();
    assert.equal(await second.getByLabel('Amount').isDisabled(), true);
    await second.close(); await first.close();
    const reopened = await app.context.newPage(); await reopened.goto(app.origin + '/draft');
    await reopened.waitForFunction(() => document.querySelector('[aria-label="Amount"]').value === '125.75');
    assert.equal(await reopened.evaluate(() => window.recoveryKey()), saved.key);
    assert.equal(await reopened.evaluate(() => JSON.parse(localStorage.getItem(window.recoveryKey())).outbox.head?.id ?? JSON.parse(localStorage.getItem(window.recoveryKey())).outbox.next?.id), saved.value.outbox.head?.id ?? saved.value.outbox.next?.id);
    assert.equal(app.requests.length, 0, 'offline restore cannot submit money');
    await reopened.evaluate(async () => {
      await window.ops.savePortableOperation('fixture-salon:device-key', 'receipt', { localDraftKey: window.recoveryKey(), total: 125.75 });
    });
    await reopened.close();
    const afterSubmit = await app.context.newPage(); await afterSubmit.goto(app.origin + '/draft');
    await afterSubmit.waitForFunction(() => !document.querySelector('[aria-label="Amount"]').disabled);
    assert.equal(await afterSubmit.getByLabel('Amount').inputValue(), '', 'a saved receipt is never resurrected as a new money draft');
    assert.equal((await afterSubmit.evaluate(() => window.ops.listPortableOperations('fixture-salon:device-key'))).length, 1);
    assert.equal(app.requests.length, 0);
  } finally { await app.close(); }
});

test('retained native POS disables edits after another window takes its released writer', { skip: !existsSync(executablePath), timeout: 40000 }, async () => {
  const app = await fixture();
  try {
    const retained = await app.context.newPage(); await retained.goto(app.origin + '/retained');
    await retained.getByLabel('Amount').fill('33.75');
    await retained.evaluate(() => window.setDraftVisible(false));
    await retained.getByLabel('Amount').waitFor({ state: 'hidden' });
    const active = await app.context.newPage(); await active.goto(app.origin + '/draft');
    await active.getByLabel('Amount').fill('44.25');
    await retained.evaluate(() => window.setDraftVisible(true));
    await retained.getByText('POS is already open in another window. Continue there or close it first.').waitFor();
    assert.equal(await retained.getByLabel('Amount').isDisabled(), true);
    const stored = await active.evaluate(() => JSON.parse(localStorage.getItem(window.recoveryKey())));
    assert.equal(stored.recovery.amount, '44.25');
    assert.equal(app.requests.length, 0);
  } finally { await app.close(); }
});

test('native foreground catches up staff/pay without replacing inputs and retries the same durable receipt after a lost reply', { skip: !existsSync(executablePath), timeout: 40000 }, async () => {
  const app = await fixture();
  try {
    const page = await app.context.newPage(); await page.goto(app.origin + '/resume');
    await page.getByLabel('Unsubmitted filter').fill('retain this work');
    const operation = await page.evaluate(() => {
      window.inputIdentity = document.querySelector('[aria-label="Unsubmitted filter"]');
      return window.ops.savePortableOperation('owner:fixture-salon:fixture-viewer', 'receipt', { localDraftKey: 'draft-a', ownerCartId: 'cart-a', total: 50 });
    });
    assert.equal(app.requests.length, 0);
    await page.evaluate(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true });
      for (let i = 0; i < 3; i++) window.dispatchEvent(new Event('reylumi:foreground'));
    });
    await page.waitForFunction(() => document.querySelector('[data-staff]').textContent === '1' && document.querySelector('[data-pay]').textContent === '1');
    await page.waitForFunction(async () => (await window.ops.listPortableOperations('owner:fixture-salon:fixture-viewer'))[0].state === 'pending');
    assert.equal(app.reads.staff, 1); assert.equal(app.reads.pay, 1);
    await page.evaluate(() => window.dispatchEvent(new Event('reylumi:foreground')));
    await page.waitForFunction(async () => (await window.ops.listPortableOperations('owner:fixture-salon:fixture-viewer'))[0].state === 'synced');
    assert.equal(app.committed.size, 1);
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[0].id, operation.id); assert.equal(app.requests[1].id, operation.id);
    assert.deepEqual(app.requests[0].payload, app.requests[1].payload);
    assert.equal(await page.getByLabel('Unsubmitted filter').inputValue(), 'retain this work');
    assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Unsubmitted filter"]') === window.inputIdentity), true);
  } finally { await app.close(); }
});
