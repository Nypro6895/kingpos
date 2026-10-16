import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import React from 'react';
import { renderToString } from 'react-dom/server';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let output;
const hydrationTree = `function HydrationTree(){return <WorkspaceLanguageProvider scope='hydration' enabled portableEnabled={false} expiresAt={null}><input aria-label='Hydration draft' defaultValue='server draft'/><button id='hydrate-save'><WorkspaceText text='Save'/></button><WorkspaceElement as='input' aria-label='Hydration translated attribute' placeholder='Save' name='unchanged_field' defaultValue='unmodified'/></WorkspaceLanguageProvider>}`;
let serverMarkup;
async function hydrationMarkup() {
  if (serverMarkup !== undefined) return serverMarkup;
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import{WorkspaceLanguageProvider,WorkspaceText,WorkspaceElement}from'./components/workspace-language';${hydrationTree};export{HydrationTree};` }, bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], alias: { '@': process.cwd() },
    plugins: [{ name: 'server-route-only', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'server-route', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const usePathname=()=>'/hydrate';` }));
    } }],
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  serverMarkup = renderToString(React.createElement(module.exports.HydrationTree));
  assert.match(serverMarkup, />Save<\/button>/);
  return serverMarkup;
}
function bundle() {
  return output ??= build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', sourcefile: 'cold-language-fixture.tsx', contents: `
    import React,{Activity,useEffect,useState}from'react';import{createRoot,hydrateRoot}from'react-dom/client';import{usePathname}from'next/navigation';
    import{WorkspaceLanguageProvider,WorkspaceLanguageConfiguration,WorkspaceText,WorkspaceElement,workspaceDialogText}from'./components/workspace-language';
    import{loadWorkspaceTranslator}from'./lib/workspace-translator-client';
    ${hydrationTree}
    function Draft(){useEffect(()=>{window.mounts=(window.mounts??0)+1},[]);return <><input aria-label='Draft' defaultValue='original'/><button id='save'><WorkspaceText text='Save'/></button><WorkspaceElement as='input' name='unchanged_field' value='unchanged_value' readOnly placeholder='Save' aria-label='Translated attribute'/><button id='dialog' onClick={()=>window.dialogText=workspaceDialogText('Save')}>Dialog</button></>}
    function App(){const[scope,setScope]=useState('a'),[initial,setInitial]=useState({enabled:false,portableEnabled:false,expiresAt:null}),[settings,setSettings]=useState({scope:'none',enabled:false,portableEnabled:false,expiresAt:null}),[visible,setVisible]=useState(true);const pathname=usePathname();useEffect(()=>{window.configure=setSettings;window.changeScope=setScope;window.changeInitial=setInitial;window.hide=()=>setVisible(false);window.show=()=>setVisible(true);window.ready=true},[]);return <main data-path={pathname} data-scope={scope} data-visible={visible}><Activity mode={visible?'visible':'hidden'}><WorkspaceLanguageProvider scope={scope} {...initial} portableSession><Draft/><WorkspaceLanguageConfiguration {...settings}/></WorkspaceLanguageProvider></Activity></main>}
    if(location.pathname==='/hydrate'){window.recoverable=[];window.cacheTranslator=()=>loadWorkspaceTranslator().then(()=>{window.translatorCached=true});window.beginHydration=()=>hydrateRoot(document.getElementById('root'),<HydrationTree/>,{onRecoverableError:error=>window.recoverable.push(error.message)});window.ready=true}else createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: 'fixture-output', entryNames: 'entry', chunkNames: '[name]-[hash]', format: 'esm', splitting: true, metafile: true,
  jsx: 'automatic', platform: 'browser', alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'public-route-hook-fixture', setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', resolveDir: process.cwd(), contents: `import{useSyncExternalStore}from'react';window.changePath=path=>{history.replaceState({},'',path);window.dispatchEvent(new Event('fixture-route'))};export function usePathname(){return useSyncExternalStore(listener=>{window.addEventListener('fixture-route',listener);return()=>window.removeEventListener('fixture-route',listener)},()=>location.pathname,()=>location.pathname)}` }));
  } }], });
}

async function fixture(route = '/market') {
  const compiled = await bundle(), dictionary = [], files = new Map(compiled.outputFiles.map(file => ['/' + path.basename(file.path), file.text]));
  const markup = route === '/hydrate' ? await hydrationMarkup() : '';
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
    if (files.has(pathname)) {
      response.setHeader('Content-Type', 'text/javascript');
      if (pathname.includes('vietnamese-dictionary-')) dictionary.push({ response, body: files.get(pathname), finished: false });
      else response.end(files.get(pathname));
    } else { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root">' + markup + '</div><script type="module" src="/entry.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(6000);
  const origin = `http://127.0.0.1:${server.address().port}`, errors = [];
  await page.route('**/*', request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort());
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + route);
  await page.waitForFunction(() => window.ready === true);
  return { page, dictionary, errors,
    async waitForDictionary() { await page.waitForFunction(() => document.querySelector('main') !== null); while (!dictionary.length) await new Promise(resolve => setImmediate(resolve)); },
    release(failed = false) { const item = dictionary.find(item => !item.finished); assert.ok(item, 'expected one held dictionary request'); item.finished = true; item.response.statusCode = failed ? 503 : 200; item.response.end(failed ? 'Unavailable' : item.body); },
    async close() { for (const item of dictionary) if (!item.finished) item.response.destroy(); await browser.close(); await new Promise(resolve => server.close(resolve)); },
  };
}
const configure = (page, values = {}) => page.evaluate(values => window.configure({ scope: 'a', enabled: true, portableEnabled: false, expiresAt: null, ...values }), values);

test('English, excluded public/personal routes, expired entitlement and disabled portable never request the dictionary', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/explore');
  try {
    await configure(app.page);
    for (const route of ['/explore', '/admin/users', '/book/fixture', '/beauty', '/my-bookings', '/activity', '/pos/portable']) {
      await app.page.evaluate(route => window.changePath(route), route);
      await app.page.waitForFunction(route => document.querySelector('main').dataset.path === route, route);
      assert.equal(await app.page.locator('#save').textContent(), 'Save');
    }
    await configure(app.page, { enabled: false, portableEnabled: false });
    await app.page.evaluate(() => window.changePath('/market'));
    await app.page.waitForFunction(() => document.querySelector('main').dataset.path === '/market');
    await configure(app.page, { enabled: true, expiresAt: '2000-01-01T00:00:00Z' });
    await app.page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    await app.page.evaluate(() => window.configure({ scope: 'old-scope', enabled: true, portableEnabled: true, expiresAt: null }));
    assert.equal(app.dictionary.length, 0);
    assert.equal(await app.page.locator('html').getAttribute('lang'), 'en');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('eligible language loads separately while drafts remain usable, then reuses the translator without remounting', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.page.getByLabel('Draft', { exact: true }).fill('money and notes stay here');
    await app.page.evaluate(() => window.original = document.querySelector('[aria-label=Draft]'));
    await configure(app.page);
    await app.waitForDictionary();
    assert.equal(await app.page.locator('#save').textContent(), 'Save');
    await app.page.locator('#dialog').click();
    assert.equal(await app.page.evaluate(() => window.dialogText), 'Save', 'dialogs cannot translate before the dictionary is usable');
    await app.page.getByLabel('Draft', { exact: true }).fill('still editable while held');
    app.release();
    await app.page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    await app.page.locator('#dialog').click();
    assert.equal(await app.page.evaluate(() => window.dialogText), 'Lưu');
    assert.equal(await app.page.getByLabel('Draft', { exact: true }).inputValue(), 'still editable while held');
    assert.equal(await app.page.evaluate(() => window.original === document.querySelector('[aria-label=Draft]') && window.mounts === 1), true);
    assert.equal(await app.page.locator('input[name=unchanged_field]').inputValue(), 'unchanged_value');
    assert.equal(await app.page.locator('input[name=unchanged_field]').getAttribute('placeholder'), 'Lưu');
    await app.page.evaluate(() => window.changePath('/explore'));
    await app.page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    await app.page.locator('#dialog').click();
    assert.equal(await app.page.evaluate(() => window.dialogText), 'Save');
    await app.page.evaluate(() => window.changePath('/market'));
    await app.page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    assert.equal(app.dictionary.length, 1, 'cached UI copy is safe to reuse within each freshly eligible view');
    assert.equal(await app.page.evaluate(() => window.original === document.querySelector('[aria-label=Draft]')), true);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('late dictionary completion cannot activate a changed scope or accept stale server configuration', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await configure(app.page);
    await app.waitForDictionary();
    await app.page.evaluate(() => window.changeScope('b'));
    await app.page.waitForFunction(() => document.querySelector('main').dataset.scope === 'b');
    app.release();
    await app.page.evaluate(() => window.configure({ scope: 'a', enabled: true, portableEnabled: true, expiresAt: null }));
    await app.page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    await app.page.locator('#dialog').click();
    assert.equal(await app.page.evaluate(() => window.dialogText), 'Save');
    await configure(app.page, { scope: 'b' });
    await app.page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    assert.equal(app.dictionary.length, 1, 'new authorized eligibility can reuse loaded public copy without another download');
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('expiry during the held import and a late personal-route reply both stay untranslated', { skip, timeout: 60000 }, async () => {
  for (const change of ['expiry', 'personal']) {
    const app = await fixture();
    try {
      if (change === 'expiry') {
        await app.page.evaluate(() => { window.expiry = Date.now() + 250; window.configure({ scope: 'a', enabled: true, portableEnabled: false, expiresAt: new Date(window.expiry).toISOString() }); });
      } else await configure(app.page);
      await app.waitForDictionary();
      if (change === 'expiry') await app.page.waitForFunction(() => Date.now() >= window.expiry);
      else { await app.page.evaluate(() => window.changePath('/explore')); await app.page.waitForFunction(() => document.querySelector('main').dataset.path === '/explore'); }
      app.release();
      await app.page.locator('#dialog').click();
      assert.equal(await app.page.locator('#save').textContent(), 'Save');
      assert.equal(await app.page.evaluate(() => window.dialogText), 'Save');
      assert.equal(await app.page.locator('html').getAttribute('lang'), 'en');
      assert.deepEqual(app.errors, []);
    } finally { await app.close(); }
  }
});

test('dictionary import failure leaves the same draft interactive and does not automatically retry', { skip, timeout: 60000 }, async () => {
  const app = await fixture();
  try {
    await app.page.getByLabel('Draft', { exact: true }).fill('keep draft after failure');
    await configure(app.page);
    await app.waitForDictionary();
    app.release(true);
    await app.page.getByLabel('Draft', { exact: true }).fill('editable after failure');
    await app.page.locator('#dialog').click();
    assert.equal(await app.page.evaluate(() => window.dialogText), 'Save');
    assert.equal(await app.page.locator('#save').textContent(), 'Save');
    assert.equal(await app.page.evaluate(() => window.mounts), 1);
    assert.equal(app.dictionary.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('portable static entitlement still enables language and disabled portable entitlement loads nothing', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/pos/portable');
  try {
    await app.page.evaluate(() => { window.changeScope(''); window.changeInitial({ enabled: true, portableEnabled: false, expiresAt: null }); });
    await app.page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    assert.equal(app.dictionary.length, 0);
    await app.page.evaluate(() => window.changeInitial({ enabled: true, portableEnabled: true, expiresAt: null }));
    await app.waitForDictionary();
    app.release();
    await app.page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    assert.equal(await app.page.locator('html').getAttribute('lang'), 'vi');
    await app.page.evaluate(() => window.changeInitial({ enabled: true, portableEnabled: false, expiresAt: null }));
    await app.page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    assert.equal(app.dictionary.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('compiled initial language entry excludes every dictionary and copy JSON input', async () => {
  const compiled = await bundle(), outputs = compiled.metafile.outputs;
  const entry = Object.keys(outputs).find(file => outputs[file].entryPoint === 'cold-language-fixture.tsx');
  assert.ok(entry);
  const seen = new Set();
  function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const item = outputs[file];
    assert.ok(item, file);
    for (const input of Object.keys(item.inputs)) assert.equal(/vietnamese-(?:dictionary|.*copy|payroll|workspace|booking)/.test(input), false, `eager copy input: ${input}`);
    for (const dependency of item.imports) if (!dependency.external && dependency.kind !== 'dynamic-import') visit(dependency.path);
  }
  visit(entry);
  assert.ok(Object.keys(outputs).some(file => /vietnamese-dictionary-/.test(file)), 'full copy remains in a separate importable chunk');
});

test('already cached copy cannot change a delayed provider first hydration render or replace its typed draft DOM', { skip, timeout: 60000 }, async () => {
  const app = await fixture('/hydrate'), warnings = [];
  app.page.on('console', message => { if (message.type() === 'error') warnings.push(message.text()); });
  try {
    await app.page.getByLabel('Hydration draft', { exact: true }).fill('typed before hydration');
    await app.page.evaluate(() => { window.originalDraft = document.querySelector('[aria-label="Hydration draft"]'); void window.cacheTranslator(); });
    // This view intentionally has not hydrated yet, so only its shared copy is
    // loaded. It models a later streamed provider after another active view.
    while (!app.dictionary.length) await new Promise(resolve => setImmediate(resolve));
    app.release();
    await app.page.waitForFunction(() => window.translatorCached === true);
    assert.equal(await app.page.locator('#hydrate-save').textContent(), 'Save');
    assert.equal(await app.page.getByLabel('Hydration translated attribute', { exact: true }).getAttribute('placeholder'), 'Save');
    await app.page.evaluate(() => window.beginHydration());
    await app.page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    assert.deepEqual(await app.page.evaluate(() => window.recoverable), []);
    assert.deepEqual(warnings, []);
    assert.equal(await app.page.evaluate(() => window.originalDraft === document.querySelector('[aria-label="Hydration draft"]')), true);
    assert.equal(await app.page.getByLabel('Hydration draft', { exact: true }).inputValue(), 'typed before hydration');
    assert.equal(await app.page.getByLabel('Hydration translated attribute', { exact: true }).getAttribute('placeholder'), 'Lưu');
    assert.equal(app.dictionary.length, 1);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
