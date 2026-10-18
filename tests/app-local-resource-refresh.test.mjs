import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const skip = !existsSync(browserPath);
async function fixture() {
  const output = await build({ stdin: { loader: 'tsx', resolveDir: process.cwd(), contents: `
    import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
    import{useAppLocalResource,seedAppLocalResource}from'./lib/app-local-resource';
    window.reads=[];window.mode='unchanged';
    const names=['owner.workspace','owner.check-in','shell.navigation','disabled'];
    for(const name of names)seedAppLocalResource('scope-a',name,{}, {schemaVersion:1,status:200,scope:'scope-a',etag:'r1',updatedAt:Date.now()-60000,offline:true,data:{label:name}});
    function Resource({name,enabled=true}){const r=useAppLocalResource('scope-a',name,{}, {enabled});return <section data-name={name}><p>{r.data?.label??'empty'}</p><input aria-label={name} defaultValue='draft'/></section>}
    function App(){const[active,setActive]=useState('owner.workspace');window.show=setActive;return <><Activity mode={active==='owner.workspace'?'visible':'hidden'}><Resource name='owner.workspace'/></Activity><Activity mode={active==='owner.check-in'?'visible':'hidden'}><Resource name='owner.check-in'/></Activity><Resource name='shell.navigation'/><Resource name='disabled' enabled={false}/></>}
    window.command=source=>window.dispatchEvent(new CustomEvent('reylumi:app-local-command-complete',{detail:{scope:'scope-a',source}}));createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'resource-native-host', setup(builder) {
    builder.onResolve({ filter: /(?:^|\/)app-local-host$/ }, () => ({ path: 'host', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)experience-persistent-cache$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:^|\/)app-local-data-policy$/ }, () => ({ path: 'policy', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'host' ? `export const getAppLocalHost=()=>({isNative:true,cache:async()=>null,read:async(name,args,options)=>{window.reads.push(name);const label=window.version;if(window.holdName===name)await new Promise(resolve=>window.finishHeld=resolve);return{schemaVersion:1,status:label?200:304,scope:options.scope,etag:'r1',updatedAt:Date.now(),...(label?{data:{label}}:{})}}});` : path === 'policy' ? 'export const appLocalReadIsDurable=()=>true;' : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
  } }] });
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/app.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/app.js' ? output.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: browserPath, headless: true }), page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.reads.length === 2);
  return { page, async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(errors, []); } };
}
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('successful unchanged validation prevents repeated reads and keeps the original draft DOM', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); try {
    await app.page.locator('input[aria-label="owner.workspace"]').fill('118.75');
    await app.page.locator('input[aria-label="owner.workspace"]').evaluate(node => window.originalInput = node);
    for (let i = 0; i < 4; i++) { await app.page.evaluate(() => window.show('owner.check-in')); await settle(app.page); await app.page.evaluate(() => window.show('owner.workspace')); await settle(app.page); }
    assert.equal(await app.page.evaluate(() => window.reads.filter(name => name === 'owner.workspace').length), 1);
    assert.equal(await app.page.evaluate(() => window.reads.filter(name => name === 'owner.check-in').length), 1);
    assert.equal(await app.page.locator('input[aria-label="owner.workspace"]').evaluate(node => node === window.originalInput), true);
    assert.equal(await app.page.locator('input[aria-label="owner.workspace"]').inputValue(), '118.75');
  } finally { await app.close(); }
});

test('attendance refreshes affected visible data and defers hidden data without fetching disabled or static shell cells', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); try {
    await app.page.evaluate(() => { window.reads = []; window.command('app/pos/owner-check-in-actions.ts'); }); await settle(app.page);
    assert.deepEqual(await app.page.evaluate(() => window.reads), ['owner.workspace']);
    await app.page.evaluate(() => window.show('owner.check-in')); await settle(app.page);
    assert.deepEqual(await app.page.evaluate(() => window.reads), ['owner.workspace', 'owner.check-in']);
    await app.page.evaluate(() => window.show('owner.workspace')); await settle(app.page);
    assert.deepEqual(await app.page.evaluate(() => window.reads), ['owner.workspace', 'owner.check-in']);
  } finally { await app.close(); }
});

test('older command notifications retain conservative active refresh but never run disabled hooks', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); try {
    await app.page.evaluate(() => { window.reads = []; window.command(); }); await settle(app.page);
    assert.deepEqual((await app.page.evaluate(() => window.reads)).sort(), ['owner.workspace', 'shell.navigation']);
    await app.page.evaluate(() => window.show('owner.check-in')); await settle(app.page);
    assert.equal(await app.page.evaluate(() => window.reads.filter(name => name === 'owner.check-in').length), 1);
    assert.equal(await app.page.evaluate(() => window.reads.includes('disabled')), false);
  } finally { await app.close(); }
});

test('a pre-command read resolving while hidden cannot replace newer state or cancel the reveal reconciliation', { skip, timeout: 30000 }, async () => {
  const app = await fixture(); try {
    await app.page.evaluate(() => { window.version = 'Before attendance'; window.holdName = 'owner.workspace'; window.command('app/pos/owner-check-in-actions.ts'); });
    await app.page.waitForFunction(() => typeof window.finishHeld === 'function');
    await app.page.evaluate(() => window.show('owner.check-in')); await settle(app.page);
    await app.page.evaluate(() => { window.version = 'After attendance'; window.command('app/pos/owner-check-in-actions.ts'); }); await settle(app.page);
    await app.page.evaluate(() => { window.holdName = null; window.finishHeld(); }); await settle(app.page);
    await app.page.evaluate(() => window.show('owner.workspace'));
    await app.page.locator('[data-name="owner.workspace"] p').filter({ hasText: 'After attendance' }).waitFor();
    assert.equal(await app.page.locator('[data-name="owner.workspace"] p').textContent(), 'After attendance');
    assert.equal(await app.page.evaluate(() => window.reads.filter(name => name === 'owner.workspace').length), 3);
  } finally { await app.close(); }
});
