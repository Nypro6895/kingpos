import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const scope = '00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003';
const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
  import{usePortableDraft}from'./app/pos/portable/use-portable-draft';
  function App(){const[amount,setAmount]=useState('127.50');const[revision,setRevision]=useState(0);
    const draft=usePortableDraft({scope:'display-scope',operationScope:'${scope}',version:0,recovery:{amount},restore:value=>setAmount(value.amount),onVersion:()=>{}});
    useEffect(()=>{window.draftFixture.restart=()=>setRevision(value=>value+1);window.draftFixture.queue=()=>draft.persistLocal({token:'synthetic',staffLines:[],selectedStaffId:null,customer:null,discount:0,subtotal:127.5,tax:0,tip:0,total:127.5,totalBeforeTip:127.5},{amount})},[draft,amount]);
    return <main data-revision={revision}><label>Amount<input value={amount} onChange={event=>setAmount(event.target.value)}/></label><output data-ready={String(draft.ready)}>{draft.status}</output></main>}
  createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', plugins: [{ name: 'draft-lock-fixture', setup(builder) {
  builder.onResolve({ filter: /portable-native-client$|portable-operations$|pos-local-display$/ }, ({ path }) => ({ path, namespace: 'draft-lock' }));
  builder.onLoad({ filter: /.*/, namespace: 'draft-lock' }, ({ path }) => ({ contents: path.endsWith('portable-native-client')
    ? `export const PORTABLE_NATIVE_READY_CHANGED='kingpos:native-readiness';`
    : path.endsWith('portable-operations') ? 'export async function portableCheckpoint(){return 0}' : 'export function publishLocalDisplaySnapshot(){}' }));
} }] });

async function fixture(hold, work) {
  const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/bundle.js' ? built.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(hold => {
      window.draftFixture = { calls: [], values: {}, replies: [], hold, posts: [], release() { this.replies.shift()?.(); } };
      const state = window.draftFixture;
      window.__reylumiNativePayments = 1;
      window.webkit = { messageHandlers: { reylumi: {} } };
      window.__reylumiPortableDevice = { version: 1, platform: 'ios', storage: {
        get(key) { return state.values[key] ?? null; },
        set(key, value) { state.calls.push({ action: 'set', key }); state.values[key] = value; },
        remove(key) { delete state.values[key]; },
      }, async request(input) {
        state.calls.push(structuredClone(input));
        if (input.action === 'writer.acquire') {
          if (state.hold) await new Promise(resolve => state.replies.push(resolve));
          return { acquired: true, token: 'synthetic-writer' };
        }
        if (input.action === 'writer.release') return { released: true };
        throw Error('Unexpected native request');
      } };
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input).includes('/api/')) { state.posts.push(String(input)); return Promise.reject(Error('Business API forbidden in fixture')); }
        return original(input, init);
      };
    }, hold);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/pos/portable`);
    await work(page);
    assert.deepEqual(errors, []);
    assert.deepEqual(await page.evaluate(() => window.draftFixture.posts), []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

test('lock during initial native writer acquisition cannot be undone by late acquire, readiness or reset', async () => {
  await fixture(true, async page => {
    await page.waitForFunction(() => window.draftFixture.replies.length === 1);
    await page.evaluate(() => { window.dispatchEvent(new Event('kingpos:native-portable-lock')); window.draftFixture.release(); });
    await page.waitForFunction(() => window.draftFixture.calls.some(call => call.action === 'writer.release'));
    await page.evaluate(() => { for (const event of ['reylumi:app-local-reset', 'kingpos:native-writer-reset', 'kingpos:native-readiness', 'online', 'reylumi:foreground']) window.dispatchEvent(new Event(event)); });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('output').getAttribute('data-ready'), 'false');
    assert.equal(await page.evaluate(() => window.draftFixture.calls.filter(call => call.action === 'writer.acquire').length), 1);
    assert.equal(await page.evaluate(() => window.draftFixture.calls.filter(call => call.action === 'set').length), 0);
  });
});

test('locking a ready native draft retains its input and pending work without reacquisition or upload', async () => {
  await fixture(false, async page => {
    await page.locator('output[data-ready="true"]').waitFor();
    await page.getByLabel('Amount').fill('199.00');
    await page.waitForFunction(() => Object.values(window.draftFixture.values).some(value => value.includes('199.00')));
    await page.evaluate(() => { window.draftFixture.queue(); window.dispatchEvent(new Event('kingpos:native-portable-lock')); });
    const saved = await page.evaluate(() => structuredClone(window.draftFixture.values));
    await page.evaluate(() => { for (const event of ['reylumi:app-local-reset', 'kingpos:native-writer-reset', 'kingpos:native-readiness', 'online', 'reylumi:foreground']) window.dispatchEvent(new Event(event)); });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('output').getAttribute('data-ready'), 'false');
    assert.equal(await page.getByLabel('Amount').inputValue(), '199.00');
    assert.deepEqual(await page.evaluate(() => window.draftFixture.values), saved);
    assert.equal(await page.evaluate(() => window.draftFixture.calls.filter(call => call.action === 'writer.acquire').length), 1);
  });
});
