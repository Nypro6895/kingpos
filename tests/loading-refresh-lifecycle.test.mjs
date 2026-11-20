import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

test('named reads: fresh returns stay idle; requests coalesce; failures settle and preserve the last read', { timeout: 30000 }, async () => {
  const bundle = await build({ bundle: true, write: false, format: 'iife', jsx: 'automatic', stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,seedAppLocalResource}from'./lib/app-local-resource';
    window.h={reads:0,states:[],fail:false,hold:false};
    window.host={isNative:true,cache:async()=>null,read:async(name,args,options)=>{
      h.reads++;if(h.hold)await new Promise(resolve=>window.release=resolve);
      if(h.fail)throw Error('Temporary failure');
      return{schemaVersion:1,status:200,scope:options.scope,etag:'new',updatedAt:Date.now(),data:{value:'new'}};
    }};
    seedAppLocalResource('scope-A','customer.activity',{}, {schemaVersion:1,status:200,scope:'scope-A',etag:'old',updatedAt:Date.now(),data:{value:'saved'}});
    function App(){const r=useAppLocalResource('scope-A','customer.activity');window.refresh=r.refresh;
      useEffect(()=>{h.states.push(r.refreshing)},[r.refreshing]);
      return <output data-busy={String(r.refreshing)} data-error={r.error??''}>{r.data?.value}</output>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, plugins: [{ name: 'read-boundaries', setup(b) {
    b.onResolve({ filter: /\/(app-local-host|experience-persistent-cache)$/ }, a => ({ path: a.path.split('/').at(-1), namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'app-local-host' ? 'export const getAppLocalHost=()=>window.host;' : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
  } }] });
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => document.querySelector('output')?.textContent === 'saved');
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => h.reads), 0);
    assert.deepEqual(await page.evaluate(() => h.states), [false], 'a cache hit must not announce a network refresh');
    await page.evaluate(() => { h.hold = true; void refresh(); void refresh(); });
    await page.waitForFunction(() => h.reads === 1 && document.querySelector('output').dataset.busy === 'true');
    await page.evaluate(() => { h.hold = false; release(); });
    await page.waitForFunction(() => document.querySelector('output').textContent === 'new' && document.querySelector('output').dataset.busy === 'false');
    await page.evaluate(() => { h.states = []; for (let i=0;i<10;i++) window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => h.reads), 1);
    assert.deepEqual(await page.evaluate(() => h.states), [], 'fresh focus events do not flash loading');
    await page.evaluate(async () => { h.fail = true; await refresh(); });
    assert.equal(await page.locator('output').textContent(), 'new');
    assert.equal(await page.locator('output').getAttribute('data-busy'), 'false');
    assert.match(await page.locator('output').getAttribute('data-error'), /Temporary failure/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
