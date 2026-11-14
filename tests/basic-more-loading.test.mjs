import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

// Actual registry, menu, role definitions and scoped read/cache engines. The
// host is deliberately held; other registry views and persistent storage are
// outside this bounded browser test. It is not native-device acceptance.
const root = process.cwd();
const registry = path.resolve('lib/app-local-page-registry.tsx').replaceAll('\\', '/');
function importedNames(source, request) {
  const escaped = request.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('import\\s+([\\s\\S]*?)\\s+from\\s+["\\\']' + escaped + '["\\\']', 'g');
  const names = new Set(); let match;
  while ((match = pattern.exec(source))) {
    const braces = match[1].split(';').at(-1).match(/\{([\s\S]*?)\}/);
    if (braces) for (const value of braces[1].split(',')) {
      const name = value.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}
const mocks = {
  'next/link': `import React from'react';export default function Link(props){return <a {...props}/>;}`,
  '@/components/workspace-language': `export const WorkspaceText=({text})=>text;`,
  'fixture-host': `export const getAppLocalHost=()=>window.qa.host;`,
  'fixture-persistence': `export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>undefined;export const writeExperienceSnapshot=async()=>{throw Error('Unexpected persistence write')};export const removeExperienceSnapshot=async()=>{};`,
};
const keep = new Set(['./app-local-resource', '@/components/app-local-more']);
const fixture = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{getAppLocalPage}from'./lib/app-local-page-registry';
    import{resetAppLocalResources,appLocalResourceCache}from'./lib/app-local-resource';
    const qa=window.qa={reads:[],pending:[],cacheCalls:[],commands:[]};
    qa.host={isNative:true,read(name,args,options){qa.reads.push({name,args,scope:options.scope});return new Promise((resolve,reject)=>qa.pending.push({name,args,scope:options.scope,resolve,reject}));},cache:async(name,args)=>{qa.cacheCalls.push({name,args});return undefined;},command:async(...args)=>{qa.commands.push(args);throw Error('Unexpected command')},openOnline:async()=>{}};
    const root=createRoot(document.getElementById('root'));
    const descriptor=getAppLocalPage('/more');
    function App(){return <descriptor.Component path='/more' context={qa.context} navigate={()=>{}}/>;}
    qa.render=()=>flushSync(()=>root.render(<App/>));
    qa.scope=index=>'v3:'+String(index).repeat(64);
    qa.start=(role,index=1,access)=>{qa.context={schemaVersion:1,context:{scope:qa.scope(index),viewerId:'viewer-'+index,salonId:role==='personal'?null:'salon-'+index,workspaceId:role==='personal'?'personal':'salon:'+index,permissionRevision:'test',authenticated:true},access:access??{ownerWorkspace:role==='owner',staffWorkspace:role==='staff'},display:{name:'Test account'},onlineValidatedAt:Date.now(),offline:false};qa.render();};
    qa.finish=(index,data)=>{const p=qa.pending[index];p.resolve({schemaVersion:1,status:200,scope:p.scope,etag:'"test"',updatedAt:Date.now(),data});};
    qa.fail=(index,status)=>qa.pending[index].reject(Object.assign(new Error('Held read failed'),status?{status}:{}));
    qa.reset=()=>resetAppLocalResources();
    qa.snapshot=index=>appLocalResourceCache.get({scope:qa.scope(index),key:'app-local:'+JSON.stringify(['page.more',{}])})?.data;
    qa.suspend=()=>appLocalResourceCache.suspend();
    qa.withdraw=()=>{qa.context=null;qa.render();};
    qa.ready=true;
  ` },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'held-more-transport', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'mock' };
      if (/(?:^|\/)app-local-host$/.test(args.path)) return { path: 'fixture-host', namespace: 'mock' };
      if (/(?:^|\/)experience-persistent-cache$/.test(args.path)) return { path: 'fixture-persistence', namespace: 'mock' };
      if (args.importer.replaceAll('\\', '/') !== registry || keep.has(args.path) || !args.path.startsWith('.') && !args.path.startsWith('@/')) return;
      const names = importedNames(readFileSync(args.importer, 'utf8'), args.path);
      return { path: args.path, namespace: 'unrelated-view', pluginData: { contents: names.map(name => 'export const ' + name + '=()=>null;').join('\n') } };
    });
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: root }));
    b.onLoad({ filter: /.*/, namespace: 'unrelated-view' }, args => ({ contents: args.pluginData.contents, loader: 'tsx', resolveDir: root }));
  } }],
});
const js = fixture.outputFiles[0].text;
let browser, server, origin;
test.before(async () => {
  const executablePath = [process.env.TEST_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
  assert(executablePath);
  browser = await chromium.launch({ executablePath, headless: true });
  server = createServer((req, res) => {
    const script = req.url === '/fixture.js'; res.setHeader('Content-Type', script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.end(script ? js : '<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
});
test.after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function open() {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/more'); await page.waitForFunction(() => window.qa?.ready);
  return { page, errors };
}
const link = (page, href) => page.locator(`a[href="${href}"]`);
for (const role of ['owner', 'staff', 'personal']) test(`Admitted ${role} More menu is usable before page.more settles; plugin links wait for accepted data`, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(role => qa.start(role), role);
    await page.waitForFunction(() => qa.reads.length === 1);
    await link(page, '/my-place').waitFor(); await link(page, '/settings').waitFor();
    assert.equal(await link(page, '/campaigns').count(), 0);
    assert.equal(await link(page, '/customers').count(), role === 'owner' ? 1 : 0);
    assert.equal(await link(page, '/qr').count(), role === 'personal' ? 1 : 0);
    if (role !== 'owner') await link(page, '/more/saved-post').waitFor();
    const held = await page.evaluate(() => ({ reads: qa.reads, commands: qa.commands, cacheCalls: qa.cacheCalls }));
    assert.deepEqual(held.reads, [{ name: 'page.more', args: {}, scope: 'v3:' + '1'.repeat(64) }]);
    assert.deepEqual(held.commands, []); assert.ok(held.cacheCalls.every(c => c.name === 'get'));
    await page.evaluate(role => qa.finish(0, { roleKind: role, campaignInstalled: true }), role);
    await page.waitForFunction(() => qa.snapshot(1)?.data?.campaignInstalled === true);
    if (role === 'owner') await link(page, '/campaigns').waitFor();
    else assert.equal(await link(page, '/campaigns').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const status of [403, undefined]) test(`Cold More ${status ?? 'transient'} error withdraws the early menu and exposes real retry`, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => qa.start('owner')); await link(page, '/customers').waitFor();
    await page.waitForFunction(() => qa.reads.length === 1);
    await page.evaluate(status => qa.fail(0, status), status);
    await page.getByRole('alert').waitFor();
    assert.equal(await link(page, '/customers').count(), 0); assert.equal(await link(page, '/campaigns').count(), 0);
    await page.getByRole('button', { name: 'Try again' }).click(); await page.waitForFunction(() => qa.reads.length === 2);
    await page.evaluate(() => qa.finish(1, { roleKind: 'owner', campaignInstalled: false })); await link(page, '/customers').waitFor();
    await page.waitForFunction(() => qa.snapshot(1)?.data?.roleKind === 'owner');
    assert.equal(await link(page, '/campaigns').count(), 0); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Reset and account/scope replacement reject a late owner result; the new Personal menu has no owner links', async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => qa.start('owner')); await page.waitForFunction(() => qa.reads.length === 1);
    await page.evaluate(() => { qa.reset(); qa.start('personal', 2); });
    await page.waitForFunction(() => qa.reads.length === 2); await link(page, '/qr').waitFor();
    await page.evaluate(() => qa.finish(0, { roleKind: 'owner', campaignInstalled: true }));
    await page.evaluate(() => qa.finish(1, { roleKind: 'personal', campaignInstalled: false }));
    await page.waitForFunction(() => qa.snapshot(2)?.data?.roleKind === 'personal');
    assert.equal(await page.evaluate(() => qa.snapshot(1)), undefined, 'A late old-scope DTO must remain absent after reset');
    await link(page, '/qr').waitFor(); assert.equal(await link(page, '/customers').count(), 0); assert.equal(await link(page, '/campaigns').count(), 0);
    await page.evaluate(() => { qa.reset(); qa.withdraw(); }); await page.getByText('Sign in to view your account.').waitFor();
    assert.equal(await page.locator('#root a[href="/my-place"]').count(), 0); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Unavailable cache or ambiguous admitted role never invents a pending role menu', async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => qa.start('owner', 1, { ownerWorkspace: true, staffWorkspace: true }));
    await page.waitForFunction(() => qa.reads.length === 1);
    assert.equal(await link(page, '/customers').count(), 0); assert.equal(await link(page, '/qr').count(), 0);
    await page.evaluate(() => qa.finish(0, { roleKind: 'owner', campaignInstalled: false })); await link(page, '/customers').waitFor();
    await page.evaluate(() => qa.suspend()); await page.getByRole('status').waitFor();
    assert.equal(await link(page, '/customers').count(), 0); assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
