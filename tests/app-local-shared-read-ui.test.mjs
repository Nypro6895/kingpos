import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright-core';

const engine = process.env.TEST_BROWSER_ENGINE;
const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('web and installed-app reads share freshness, burst deduplication, retry cooldown and fail-closed suspension', { skip: engine !== 'webkit' && !existsSync(browserPath), timeout: 30000 }, async () => {
  const output = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,seedAppLocalResource,refreshAppLocalResource,resetAppLocalResources,appLocalResourceCache}from'./lib/app-local-resource';
    import{experienceResourceCache}from'./lib/experience-resource-cache';
    import{getReadRequestMetrics}from'./lib/read-request-metrics';
    window.cache=appLocalResourceCache;window.webCache=experienceResourceCache;window.metrics=getReadRequestMetrics;window.reset=resetAppLocalResources;
    window.seed=()=>{window.seededAt=Date.now();window.seededData={label:'Saved data',payload:'x'.repeat(window.payloadSize??0)};seedAppLocalResource('owner-a','owner.workspace',{}, {schemaVersion:1,status:200,scope:'owner-a',etag:'v1',updatedAt:window.seededAt,data:window.seededData});};
    window.seed();window.manual=()=>refreshAppLocalResource('owner-a','owner.workspace',{});
    window.wake=()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('reylumi:foreground'));document.dispatchEvent(new Event('visibilitychange'));};
    function View({id}){const r=useAppLocalResource('owner-a','owner.workspace');return <section data-view={id}><p>{r.data?.label??'empty'}</p><input aria-label={id} defaultValue='draft'/><span data-error>{r.error??''}</span></section>}
    function App(){const[visible,setVisible]=useState(true);window.show=setVisible;return <><Activity mode={visible?'visible':'hidden'}><View id='one'/><View id='two'/></Activity></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, banner: { js: `window.clock=Date.now();Date.now=()=>window.clock;window.calls=0;window.mode='304';window.pendingReads=[];` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'native-read-fixture', setup(b) {
    b.onResolve({ filter: /(?:^|\/)app-local-host$/ }, () => ({ path: 'host', namespace: 'fixture' }));
    b.onResolve({ filter: /(?:^|\/)app-local-data-policy$/ }, () => ({ path: 'policy', namespace: 'fixture' }));
    b.onResolve({ filter: /(?:^|\/)experience-persistent-cache$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'host' ? `export const getAppLocalHost=()=>({isNative:true,cache:async()=>window.holdDisk?new Promise(resolve=>window.finishDisk=resolve):null,read:async(name,args,options)=>{window.calls++;if(window.mode==='offline')return{schemaVersion:1,status:200,scope:options.scope,etag:'old',updatedAt:Date.now()-60000,offline:true,data:{label:'Old offline data'}};if(window.mode==='failure')throw Object.assign(Error('Network timeout'),{status:503});if(window.mode==='data')return{schemaVersion:1,status:200,scope:options.scope,etag:'v2',updatedAt:Date.now(),data:{label:window.label??'Loaded data',payload:'x'.repeat(window.payloadSize??0)}};if(window.mode==='held')return new Promise(resolve=>window.pendingReads.push(resolve));return{schemaVersion:1,status:304,scope:options.scope,etag:'v1',updatedAt:Date.now()}}});` : path === 'policy' ? 'export const appLocalReadIsDurable=()=>true;' : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
  } }] });
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? output.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('[data-view="two"] p').filter({hasText:'Saved data'}).waitFor();
    await page.getByLabel('one').fill('unsaved work');
    await page.evaluate(()=>{window.original=document.querySelector('[data-view="one"]');window.wake();});await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),0,'fresh data survives combined wake events');
    await page.evaluate(()=>{window.clock+=31000;window.wake();});await page.waitForFunction(()=>window.calls===1);await page.waitForTimeout(180);
    await page.evaluate(()=>window.wake());await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),1,'304 validates freshness for every observer');
    await page.evaluate(()=>Promise.all([window.manual(),window.manual()]));
    assert.equal(await page.evaluate(()=>window.calls),2,'manual force is joined while in flight');
    await page.evaluate(()=>{window.show(false);});await page.waitForTimeout(50);
    await page.evaluate(()=>{window.clock+=31000;window.wake();});await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),2,'retained hidden views do not read');
    await page.evaluate(()=>window.show(true));await page.waitForFunction(()=>window.calls===3);
    assert.equal(await page.getByLabel('one').inputValue(),'unsaved work');
    assert.equal(await page.locator('[data-view="one"]').evaluate(node=>node===window.original),true);
    await page.evaluate(()=>{window.mode='failure';window.clock+=31000;window.wake();});await page.waitForFunction(()=>window.calls===4);
    await page.locator('[data-view="one"] [data-error]').filter({hasText:'Network timeout'}).waitFor();
    await page.evaluate(()=>window.wake());await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),4,'automatic failure retry window belongs to the shared cache');
    assert.equal(await page.locator('[data-view="one"] p').textContent(),'Saved data');
    await page.evaluate(async()=>{window.mode='304';await window.manual();});
    assert.equal(await page.evaluate(()=>window.calls),5,'explicit retry can bypass the failure cooldown');
    await page.evaluate(()=>window.webCache.suspend());
    assert.equal(await page.locator('[data-view="one"] p').textContent(),'Saved data','hosted cache authority cannot change native admission');
    await page.evaluate(()=>window.cache.suspend());
    await page.locator('[data-view="one"] p').filter({hasText:'empty'}).waitFor();
    await page.evaluate(()=>window.wake());await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),5,'suspended authority cannot perform reads');
    await page.evaluate(()=>{window.reset();window.mode='data';window.cache.resume('owner-a');});
    await page.locator('[data-view="one"] p').filter({hasText:'Loaded data'}).waitFor();
    assert.equal(await page.evaluate(()=>window.calls),6,'a cold active page reads automatically after authority resume');
    await page.evaluate(async()=>{window.payloadSize=2700000;await window.manual();});
    assert.equal(await page.evaluate(()=>window.calls),7);
    assert.equal(await page.evaluate(()=>window.cache.stats().entries),0,'oversize DTO is kept only in its retained view');
    await page.evaluate(()=>{window.clock+=1000;window.wake();});await page.waitForTimeout(180);
    await page.evaluate(()=>{window.show(false);});await page.waitForTimeout(40);await page.evaluate(()=>window.show(true));await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),7,'successful validation survives shared-cache admission rejection and reveal');
    assert.equal(await page.locator('[data-view="one"] p').textContent(),'Loaded data');
    await page.evaluate(()=>window.show(false));await page.waitForTimeout(40);
    await page.evaluate(()=>{window.label='Changed data';window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete',{detail:{scope:'owner-a'}}));});
    await page.evaluate(()=>window.show(true));await page.waitForFunction(()=>window.calls===8);
    await page.locator('[data-view="one"] p').filter({hasText:'Changed data'}).waitFor();
    await page.evaluate(()=>{window.clock+=31000;window.mode='offline';window.wake();});await page.waitForFunction(()=>window.calls===9);await page.waitForTimeout(120);
    assert.equal(await page.locator('[data-view="one"] p').textContent(),'Changed data','older native fallback cannot replace newer retained data');
    await page.evaluate(()=>window.wake());await page.waitForFunction(()=>window.calls===10);
    assert.equal(await page.locator('[data-view="one"] p').textContent(),'Changed data','an offline fallback must not manufacture a fresh validation');
    await page.evaluate(()=>{window.holdDisk=true;window.reset();window.mode='304';window.seed();});
    await page.waitForFunction(()=>typeof window.finishDisk==='function');
    await page.evaluate(async()=>{window.clock+=31000;await window.manual();});
    assert.equal(await page.evaluate(()=>window.calls),11);
    await page.evaluate(()=>{window.holdDisk=false;window.finishDisk({data:window.seededData,revision:'v1',updatedAt:window.seededAt});});await page.waitForTimeout(60);
    await page.evaluate(()=>window.wake());await page.waitForTimeout(180);
    assert.equal(await page.evaluate(()=>window.calls),11,'a delayed equal-version disk snapshot cannot undo an oversized 304 validation');
    assert.deepEqual(await page.evaluate(()=>{
      const context={scope:'owner-a',key:'app-local:'+JSON.stringify(['owner.workspace',{orphan:true}])};
      window.cache.seed(context,{schemaVersion:1,status:200,scope:'owner-a',etag:'orphan',updatedAt:Date.now(),data:{label:'Evicted view'}});
      const before=!!window.cache.get(context);window.reset();
      return {before,after:!!window.cache.get(context),entries:window.cache.stats().entries};
    }),{before:true,after:false,entries:0},'reset clears admitted DTOs even when their view cells are no longer tracked');
    assert.deepEqual(errors,[]);
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
});
