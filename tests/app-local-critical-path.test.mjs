import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import test from 'node:test';

// This measures the post-admission resource path, not auth, bundle parsing,
// native storage or phone speed. Only the host/storage boundary is synthetic.
const browserPath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
let compiled;
async function fixture() {
  compiled ??= build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React,{useLayoutEffect,useState} from 'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,refreshAppLocalResource,resetAppLocalResources,seedAppLocalResource}from'./lib/app-local-resource';
    window.events=[];window.refreshListeners=new Set();window.pendingCache=[];window.cacheHolds=true;window.freshHolds=false;window.pendingFresh=[];window.freshFailure=0;
    window.host={isNative:true,cache:async(op,args)=>{if(op!=='get')return;window.events.push({kind:'cache.start',scope:args.scope,at:performance.now()});
      if(window.cacheHolds)return new Promise(resolve=>window.pendingCache.push({scope:args.scope,resolve}));return null;},
      read:async(name,args,options)=>{window.events.push({kind:'read.start',scope:options.scope,at:performance.now()});
        if(window.freshHolds)await new Promise(resolve=>window.pendingFresh.push(resolve));
        if(window.freshFailure)throw Object.assign(Error('Synthetic failed read'),{status:window.freshFailure});
        const raw=JSON.stringify({label:'fresh:'+options.scope}),before=performance.now(),data=JSON.parse(raw);
        window.events.push({kind:'parse.end',scope:options.scope,at:performance.now(),duration:performance.now()-before});
        return{schemaVersion:1,status:200,scope:options.scope,etag:'fresh',updatedAt:Date.now(),data};}};
    window.releaseCache=(label='saved',offset=60000)=>{window.cacheHolds=false;for(const item of window.pendingCache.splice(0))item.resolve({data:{label:label+':'+item.scope},revision:'saved',updatedAt:Date.now()+offset});};
    const args={phase:'shell',date:'2026-10-21'};
    window.scheduleRefresh=()=>{for(const listener of window.refreshListeners)listener();};
    window.explicitRefresh=scope=>refreshAppLocalResource(scope,'page.owner-today',args);
    window.seed=scope=>seedAppLocalResource(scope,'page.owner-today',args,{schemaVersion:1,status:200,scope,etag:'seed',updatedAt:Date.now(),data:{label:'seed:'+scope}});
    window.reset=()=>resetAppLocalResources();
    function App(){const[scope,setScope]=useState('scope-owner-a');window.selectScope=setScope;
      const state=useAppLocalResource(scope,'page.owner-today',args);
      useLayoutEffect(()=>{window.events.push({kind:'commit',scope,label:state.data?.label??null,at:performance.now()});},[scope,state.data]);
      return <main data-scope={scope}><p data-value>{state.data?.label??'Opening'}</p></main>;}
    window.reactStartedAt=performance.now();createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    alias: { '@': process.cwd() }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'post-admission-host-boundaries', setup(b) {
      const modules = {
        'app-local-host': 'export const getAppLocalHost=()=>window.host;',
        'experience-persistent-cache': 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>false;export const removeExperienceSnapshot=async()=>false;',
        'read-refresh-scheduler': 'export const canAutomaticallyRefreshRead=()=>true;export const subscribeReadRefresh=fn=>{window.refreshListeners.add(fn);return()=>window.refreshListeners.delete(fn)};',
        'experience-trace': 'export const recordExperienceTrace=()=>{};export const nextExperienceTraceOperation=()=>0;',
        'read-request-metrics': 'export const recordReadRequest=()=>{};export const readResourceCategory=()=>"app-local";',
      };
      for (const name of Object.keys(modules)) b.onResolve({ filter: new RegExp('(?:^|/)' + name + '$') }, () => ({ path: name, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: modules[path], loader: 'js' }));
    } }] });
  const output = await compiled;
  const server = createServer((req, res) => {
    res.setHeader('content-type', req.url === '/app.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/app.js' ? output.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: browserPath });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.pendingCache?.length === 1);
    return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
  } catch (e) { await browser?.close(); await new Promise(resolve => server.close(resolve)); throw e; }
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('a held durable restore serializes the initial online read after authority admission', { skip }, async () => {
  const f = await fixture();
  try {
    await settle(f.page);
    assert.equal(await f.page.evaluate(() => window.events.filter(e => e.kind === 'read.start').length), 0);
    assert.equal(await f.page.locator('[data-value]').textContent(), 'Opening');
    await f.page.evaluate(() => window.releaseCache('saved', -60000));
    await f.page.waitForFunction(() => document.querySelector('[data-value]').textContent === 'fresh:scope-owner-a');
    const events = await f.page.evaluate(() => window.events);
    assert.ok(events.findIndex(e => e.kind === 'cache.start') < events.findIndex(e => e.kind === 'read.start'));
  } finally { await f.close(); }
});

test('late durable restoration cannot replace a completed foreground read even with a newer cache clock', { skip }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.scheduleRefresh());
    await f.page.waitForFunction(() => document.querySelector('[data-value]').textContent === 'fresh:scope-owner-a');
    await f.page.evaluate(() => window.releaseCache());
    await settle(f.page);
    assert.equal(await f.page.locator('[data-value]').textContent(), 'fresh:scope-owner-a');
    assert.equal(await f.page.evaluate(() => window.events.some(e => e.kind === 'commit' && e.label === 'saved:scope-owner-a')), false);
  } finally { await f.close(); }
});

test('late restoration after reset and scope change never repopulates the departed scope', { skip }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => { window.reset(); window.selectScope('scope-staff-b'); });
    await f.page.waitForFunction(() => window.pendingCache.length === 2);
    await f.page.evaluate(() => window.releaseCache('saved', -60000));
    await f.page.waitForFunction(() => document.querySelector('[data-value]').textContent === 'fresh:scope-staff-b');
    const labels = await f.page.evaluate(() => window.events.filter(e => e.kind === 'commit' && e.scope === 'scope-staff-b').map(e => e.label));
    assert.ok(labels.every(label => label === null || label.endsWith(':scope-staff-b')));
    assert.equal(await f.page.locator('main').getAttribute('data-scope'), 'scope-staff-b');
  } finally { await f.close(); }
});

test('an explicitly accepted seed also fences a previously pending durable restore', { skip }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => window.seed('scope-owner-a'));
    await f.page.waitForFunction(() => document.querySelector('[data-value]').textContent === 'seed:scope-owner-a');
    await f.page.evaluate(() => window.releaseCache()); await settle(f.page);
    assert.equal(await f.page.locator('[data-value]').textContent(), 'seed:scope-owner-a');
  } finally { await f.close(); }
});

test('an unavailable foreground read still permits an otherwise authorized cached restoration', { skip }, async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(async () => { window.freshFailure = 503; await window.explicitRefresh('scope-owner-a'); });
    await f.page.evaluate(() => window.releaseCache()); await settle(f.page);
    assert.equal(await f.page.locator('[data-value]').textContent(), 'saved:scope-owner-a');
  } finally { await f.close(); }
});

