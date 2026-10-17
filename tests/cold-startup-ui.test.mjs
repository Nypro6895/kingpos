import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';

const skipBrowser = !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function compileLayout(before = false) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const original = before ? execFileSync('git', ['show', '98db9a6:app/(app)/layout.tsx'], { encoding: 'utf8' }) : null;
  const generic = `import React from'react';const passthrough=({children})=>children??null;
export const CampaignPluginProvider=passthrough,ExperienceScopeProvider=passthrough,WorkspaceLanguageProvider=passthrough,ExploreAccountActionsProvider=passthrough,ExploreAdvertising=passthrough;
export const CampaignPluginConfiguration=()=>null,AbuseNotice=()=>null,OverlayDismissal=()=>null,WindowsPosDownloadPrompt=()=>null,OwnerCampaignRuntime=()=>null,OwnerQueueRuntime=()=>null,QuickBooking=()=>null,SessionExpiryPrompt=()=>null,ExperienceCacheLifecycle=()=>null,ExperienceNavigation=()=>null,StartupReady=()=>null;
export const campaignWalletAction=async()=>null,ownerCampaignSettings=async()=>null;
export const isSalonManageContext=()=>false,isOwnerMembership=()=>false;
export function getRequestBusinessContext(){globalThis.coldProbe.events.push('context');return globalThis.coldProbe.context.promise;}
export function getExperienceContext(context){return{scope:context.scope,viewerId:context.user.id,workspaceId:'workspace-a',permissionRevision:'fresh',authenticated:true};}
export function vietnamesePluginState(salon){globalThis.coldProbe.events.push('language:'+salon);return globalThis.coldProbe.language.promise;}
export function runReadWithDeadline(value){return value;}
export function SalonSwitcher({children}){return <><nav data-authorized-nav>Authorized workspace</nav>{children}</>;}
export function WorkspaceLanguageConfiguration({enabled,scope}){return <i data-language-ready={String(enabled)} data-language-scope={scope}/>;}
`;
  const bundle = await build({
    entryPoints: [resolve('app/(app)/layout.tsx')], bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
    plugins: [{ name: 'controlled-authorized-layout', setup(builder) {
      if (original) builder.onLoad({ filter: /[\\/]app[\\/]\(app\)[\\/]layout\.tsx$/ }, () => ({ loader: 'tsx', resolveDir: resolve('app/(app)'), contents: original }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: args.path, namespace: 'probe' }));
      builder.onResolve({ filter: /^\.\.\/layout$/ }, () => ({ path: 'metadata', namespace: 'probe' }));
      builder.onLoad({ filter: /.*/, namespace: 'probe' }, args => ({ loader: 'tsx', resolveDir: resolve('.'), contents: args.path === 'metadata' ? 'export const metadata={};' : generic }));
    } }],
  });
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
  return loaded.exports.default;
}

function stream(element) {
  const output = new PassThrough();
  let html = '';
  const shell = deferred(), firstChunk = deferred(), done = deferred();
  output.on('data', chunk => { html += chunk.toString(); firstChunk.resolve(); });
  output.on('end', () => done.resolve());
  const document = React.createElement('html', null, React.createElement('head'), React.createElement('body', null, element));
  const request = renderToPipeableStream(document, {
    onShellReady() { request.pipe(output); shell.resolve(); },
    onError(error) { done.reject(error); shell.reject(error); },
  });
  return { shell: shell.promise, firstChunk: firstChunk.promise, done: done.promise, html: () => html, abort: () => request.abort() };
}

test('cold authorized shell streams before optional language, unlike the shipped blocking baseline; context still guards every private byte', { skip: !process.env.ESBUILD_MODULE_PATH, timeout: 10_000 }, async () => {
  const context = { scope: 'scope-a', user: { id: 'user-a' }, workspaceType: 'salon', salonMode: 'manage', currentSalon: { id: 'salon-a' } };
  const language = { active: true, staff_enabled: true, portable_enabled: false, trial_ends_at: null, paid_until: '2099-01-01T00:00:00Z' };
  try {
    const Before = await compileLayout(true);
    globalThis.coldProbe = { context: deferred(), language: deferred(), events: [] };
    let oldReturned = false;
    const before = Before({ children: React.createElement('main', null, 'Authorized first content') });
    before.then(() => { oldReturned = true; });
    assert.deepEqual(globalThis.coldProbe.events, ['context']);
    globalThis.coldProbe.context.resolve(context); await tick();
    assert.equal(oldReturned, false, 'baseline layout waits for optional plugin before returning any authorized shell');
    assert.deepEqual(globalThis.coldProbe.events, ['context', 'language:salon-a']);
    globalThis.coldProbe.language.resolve(language); await before;

    const After = await compileLayout();
    globalThis.coldProbe = { context: deferred(), language: deferred(), events: [] };
    let returned = false;
    const result = After({ children: React.createElement('main', null, 'Authorized first content') });
    result.then(() => { returned = true; });
    await tick();
    assert.equal(returned, false, 'the private shell cannot bypass fresh identity');
    assert.deepEqual(globalThis.coldProbe.events, ['context']);
    globalThis.coldProbe.context.resolve(context);
    const pending = stream(await result);
    await pending.shell; await pending.firstChunk;
    assert.match(pending.html(), /data-authorized-nav/);
    assert.match(pending.html(), /Authorized first content/);
    assert.doesNotMatch(pending.html(), /data-language-ready/);
    assert.deepEqual(globalThis.coldProbe.events, ['context', 'language:salon-a']);
    globalThis.coldProbe.language.resolve(language); await pending.done;
    assert.match(pending.html(), /data-language-ready="true"/);
    assert.match(pending.html(), /data-language-scope="scope-a"/);

    globalThis.coldProbe = { context: deferred(), language: deferred(), events: [] };
    const denied = After({ children: 'Must not render' });
    globalThis.coldProbe.context.reject(new Error('identity unavailable'));
    await assert.rejects(denied, /identity unavailable/);
    assert.deepEqual(globalThis.coldProbe.events, ['context']);

    globalThis.coldProbe = { context: deferred(), language: deferred(), events: [] };
    const optionalFailure = After({ children: React.createElement('main', null, 'Working authorized content') });
    globalThis.coldProbe.context.resolve(context);
    const fallback = stream(await optionalFailure); await fallback.shell;
    globalThis.coldProbe.language.reject(new Error('optional language unavailable')); await fallback.done;
    assert.match(fallback.html(), /Working authorized content/);
    assert.match(fallback.html(), /data-language-ready="false"/);
  } finally { delete globalThis.coldProbe; }
});

async function browserFixture(language = false) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const languageApp = `
import{WorkspaceLanguageProvider,WorkspaceLanguageConfiguration,WorkspaceText}from'${root}/components/workspace-language';
function Draft(){const[value,setValue]=useState('original');useEffect(()=>{window.draftMounts=(window.draftMounts??0)+1;},[]);return <><input aria-label="Unsubmitted draft" value={value} onChange={event=>setValue(event.target.value)}/><button><WorkspaceText text="Save"/></button></>;}
function App(){const[scope,setScope]=useState('a');const[settings,setSettings]=useState({scope:'none',enabled:false,portableEnabled:false,expiresAt:null});const[initial,setInitial]=useState({enabled:false,portableEnabled:false,expiresAt:null});useEffect(()=>{window.configure=setSettings;window.changeScope=setScope;window.changeInitial=setInitial;},[]);return <WorkspaceLanguageProvider scope={scope} {...initial} portableSession><Draft/><WorkspaceLanguageConfiguration {...settings}/></WorkspaceLanguageProvider>;}
createRoot(document.getElementById('root')).render(<App/>);`;
  const shellApp = `
import{AppStartupShell}from'${root}/components/app-startup-shell';
window.screenReadyEvents=0;window.addEventListener('reylumi:screen-ready',()=>window.screenReadyEvents++);
function App(){const[loaded,setLoaded]=useState(false);useEffect(()=>{window.showRealContent=()=>setLoaded(true);window.hydrated=true;},[]);return loaded?<main data-real-content>Ready first content</main>:<AppStartupShell/>;}
hydrateRoot(document.getElementById('root'),<App/>);`;
  const shared = { jsx: 'automatic', bundle: true, write: false, platform: 'browser', plugins: [{ name: 'cold-browser-probes', setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onResolve({ filter: /\.module\.css$/ }, args => ({ path: args.path, namespace: 'style' }));
    builder.onLoad({ filter: /.*/, namespace: 'style' }, () => ({ loader: 'js', contents: 'export default new Proxy({},{get:(_,key)=>String(key)});' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path === 'next/link' ? `import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>}export function useLinkStatus(){return{pending:false}}` : `import{useSyncExternalStore}from'react';window.fixturePath='/market';window.changePath=path=>{window.fixturePath=path;window.dispatchEvent(new Event('navigate'));};export function usePathname(){return useSyncExternalStore(listener=>{window.addEventListener('navigate',listener);return()=>window.removeEventListener('navigate',listener)},()=>window.fixturePath);}` }));
  } }] };
  const bundle = await build({ ...shared, metafile: true, stdin: { resolveDir: root, loader: 'tsx', contents: `import React,{useEffect,useState}from'react';import{createRoot,hydrateRoot}from'react-dom/client';${language ? languageApp : shellApp}` } });
  if (!language) assert.equal(Object.keys(bundle.metafile.inputs).some(path => path.includes('vietnamese-')), false, 'startup hydration cannot pull the workspace dictionary');
  let html = '';
  if (!language) {
    const serverBundle = await build({ ...shared, platform: 'node', format: 'cjs', external: ['react', 'react/jsx-runtime', 'react-dom'], entryPoints: [resolve('components/app-startup-shell.tsx')] });
    const loaded = { exports: {} };
    new Function('module', 'exports', 'require', serverBundle.outputFiles[0].text)(loaded, loaded.exports, createRequire(import.meta.url));
    html = renderToStaticMarkup(React.createElement(loaded.exports.AppStartupShell));
  }
  const scripts = deferred();
  const server = createServer(async (request, response) => {
    if (request.url === '/bundle.js') {
      if (!language) await scripts.promise;
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
    } else if (request.url === '/brand/reylumi-favicon.png') {
      response.setHeader('Content-Type', 'image/png'); response.end(readFileSync('public/brand/reylumi-favicon.png'));
    } else {
      const css = readFileSync('components/app-startup-shell.module.css', 'utf8') + readFileSync('components/lumi-loading-mark.module.css', 'utf8');
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<style>' + css + '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style><div id="root">' + html + '</div><script defer src="/bundle.js"></script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + '/market', { waitUntil: language ? 'load' : 'commit' });
  return { page, errors, release: () => scripts.resolve(), async close() { scripts.resolve(); await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('cold startup presents R and CSS Lumi before JavaScript without placeholder controls or holding ready content', { skip: skipBrowser, timeout: 60_000 }, async () => {
  const app = await browserFixture(); const { page } = app;
  try {
    await page.getByRole('status', { name: 'Opening Reylumi' }).waitFor();
    assert.equal(await page.evaluate(() => window.hydrated), undefined, 'the first useful shell does not await hydration');
    assert.equal(await page.locator('[data-lumi-loading-mark]').isVisible(), true);
    assert.equal(await page.getByRole('searchbox').count(), 0);
    assert.equal(await page.getByRole('link').count(), 0);
    assert.equal(await page.locator('[data-lumi-loading-mark]').evaluate(n=>n.getBoundingClientRect().width),112);
    app.release();
    await page.waitForFunction(() => document.querySelector('[data-reylumi-shell-ready=true]'));
    assert.equal(await page.evaluate(() => window.screenReadyEvents), 1);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('[data-lumi-loading-mark] .comet').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.evaluate(() => window.showRealContent());
    await page.locator('[data-real-content]').waitFor();
    assert.equal(await page.locator('[data-lumi-loading-mark]').count(), 0, 'ready content removes the mark immediately, without a minimum loading timer');
    assert.equal(await page.locator('[data-startup-shell]').count(), 0);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('streamed language updates preserve drafts and nodes, reject another scope, and retain static, expiry and portable language rules', { skip: skipBrowser, timeout: 60_000 }, async () => {
  const app = await browserFixture(true); const { page } = app;
  try {
    await page.getByLabel('Unsubmitted draft').fill('keep this draft');
    await page.evaluate(() => { window.originalDraft = document.querySelector('input'); window.scrollTo(0, 0); });
    await page.evaluate(() => window.configure({ scope: 'a', enabled: true, portableEnabled: false, expiresAt: null }));
    await page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Unsubmitted draft').inputValue(), 'keep this draft');
    assert.equal(await page.evaluate(() => document.querySelector('input') === window.originalDraft && window.draftMounts === 1), true);
    await page.evaluate(() => window.changeScope('b'));
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    await page.evaluate(() => window.configure({ scope: 'a', enabled: true, portableEnabled: true, expiresAt: null }));
    assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 1, 'late configuration for the previous workspace cannot enable language here');
    await page.evaluate(() => window.configure({ scope: 'b', enabled: true, portableEnabled: false, expiresAt: '2000-01-01T00:00:00Z' }));
    await page.waitForFunction(() => document.querySelector('button').textContent === 'Save');
    await page.evaluate(() => window.configure({ scope: 'b', enabled: true, portableEnabled: true, expiresAt: null }));
    await page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    await page.evaluate(() => window.changePath('/explore'));
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    await page.evaluate(() => window.changePath('/pos/portable'));
    await page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    await page.evaluate(() => window.configure({ scope: 'b', enabled: true, portableEnabled: false, expiresAt: null }));
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
    await page.evaluate(() => { window.changeScope(''); window.changeInitial({ enabled: true, portableEnabled: true, expiresAt: null }); });
    await page.getByRole('button', { name: 'Lưu', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Unsubmitted draft').inputValue(), 'keep this draft');
    assert.equal(await page.evaluate(() => document.querySelector('input') === window.originalDraft && window.draftMounts === 1), true);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});
