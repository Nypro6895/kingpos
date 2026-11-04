import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import ts from 'typescript';
import { chromium } from 'playwright-core';

const root = process.cwd();
const browserPath = process.env.TEST_BROWSER_PATH ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const options = { skip: !browserPath, timeout: 30000 };
let browser, server, base;

// Execute the installed-app generator's actual esbuild plugin, rather than a
// copy of its classification rule. Importing the packaging script itself would
// replace production bundle outputs, which a synthetic regression must avoid.
async function installedClientPlugin() {
  const file = 'scripts/build-app-local-bundle.mjs';
  const source = ts.createSourceFile(file, await fs.readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(item => item.name.getText(source) === 'nextPlugin');
  assert.ok(declaration?.initializer, 'the production client-boundary plugin must exist');
  const policy = JSON.parse(await fs.readFile('lib/app-local-command-policy.json', 'utf8'));
  const commandNames = new Map(Object.entries(policy.modules).flatMap(([module, names]) => names.map(name => [
    module + '#' + name,
    'action.' + createHash('sha256').update(module + '#' + name).digest('hex').slice(0, 24),
  ])));
  return new Function('fs', 'path', 'ts', 'root', 'wrappers', 'commandNames', 'unsupported',
    'return (' + declaration.initializer.getText(source) + ');')(
    fs, path, ts, root, 'app-local-next', commandNames, new Map());
}

before(async () => {
  if (!browserPath) return;
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{ownerCampaignPromptAction,saveCampaignLimitAction,dismissCampaignPromptAction}from'./app/campaigns/actions';
    import{setAppLocalCommandScope}from'./lib/app-local-command-client';
    import{useAppLocalResource,appLocalResourceCache,seedAppLocalResource,resetAppLocalResources,rememberAppLocalRoleResources,reconcileAppLocalRoleResources}from'./lib/app-local-resource';
    const scope='v3:'+'a'.repeat(64),staffScope='v3:'+'b'.repeat(64),generation='generation-0000000001';
    const names=['page.owner-today','owner.bookings','page.owner-payroll','page.market'];
    window.__reylumiAppLocalContext={generation,scopeEpoch:1,nonce:'fixture'};
    const h=window.h={commands:[],reads:[],completions:[],value:null,failure:0,hold:false,network:0};
    window.fetch=()=>{h.network++;throw Error('No remote request is authorized in this synthetic fixture');};
    window.addEventListener('reylumi:app-local-command-complete',event=>h.completions.push(event.detail));
    window.host={isNative:true,cache:async()=>null,read:async(name,args,options)=>{
      const row={name,args,scope:options.scope,id:h.reads.length+1};h.reads.push(row);
      return{schemaVersion:1,status:200,scope:row.scope,etag:'fixture-'+row.id,updatedAt:Date.now(),data:{marker:name+':'+row.id},offline:false};
    },command:async(name,args,options)=>{
      h.commands.push({name,args,scope:options.scope});
      if(h.hold)await new Promise(resolve=>window.releaseCommand=resolve);
      if(h.failure)throw Object.assign(Error('Fixture command denied'),{status:h.failure});
      return{value:h.value};
    }};
    function Read({name}){const value=useAppLocalResource(scope,name,{});return <output data-testid={name}>{value.data?.marker??'opening'}</output>;}
    function App(){const[visible,set]=useState(true);window.setVisible=set;return visible?names.map(name=><Read key={name} name={name}/>):null;}
    const cache=(scope,name)=>appLocalResourceCache.get({scope,key:'app-local:'+JSON.stringify([name,{}])});
    window.memory=()=>names.map(name=>({name,etag:cache(scope,name)?.data.etag,marker:cache(scope,name)?.data.data?.marker}));
    const staffContext={schemaVersion:1,context:{scope:staffScope,authenticated:true,viewerId:'fixture-viewer',salonId:'fixture-salon',workspaceId:'staff-workspace',permissionRevision:'r1'},grant:{kind:'staff',grantRevision:'grant-r1',generation},access:{ownerWorkspace:false,staffWorkspace:true},onlineValidatedAt:Date.now()};
    window.rememberStaff=()=>{seedAppLocalResource(staffScope,'staff.my-work',{}, {schemaVersion:1,status:200,scope:staffScope,etag:'staff-quarantine',updatedAt:Date.now(),data:{marker:'staff-kept'},offline:false});rememberAppLocalRoleResources(staffContext,generation);};
    window.restoreStaff=()=>{resetAppLocalResources(staffScope);reconcileAppLocalRoleResources(staffContext,generation,true);return cache(staffScope,'staff.my-work')?.data.data??null;};
    window.setScope=setAppLocalCommandScope;setAppLocalCommandScope(scope);
    window.call=kind=>kind==='write'?saveCampaignLimitAction('00000000-0000-4000-8000-000000000001',100,false):kind==='dismiss'?dismissCampaignPromptAction('00000000-0000-4000-8000-000000000002'):ownerCampaignPromptAction();
    createRoot(document.getElementById('root')).render(<App/>);window.fixtureReady=true;
  ` }, bundle: true, write: false, platform: 'browser', jsx: 'automatic', plugins: [{ name: 'synthetic-native-transport', setup(builder) {
    builder.onResolve({ filter: /app-local-host$|experience-persistent-cache$|app-local-shell-workspace-navigation$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('app-local-host')
      ? 'export const getAppLocalHost=()=>window.host;export const appLocalPath=value=>value;'
      : args.path.endsWith('app-local-shell-workspace-navigation')
        ? 'export const completeWorkspaceHandoff=()=>{throw Error("Unexpected workspace handoff")};export const navigateToWorkspace=()=>{throw Error("Unexpected navigation")};export const requestWorkspaceResolution=()=>{throw Error("Unexpected recovery")};'
        : 'export const getExperienceOfflineGrant=()=>null;export const isExperienceSnapshotAuthorized=()=>false;export const readExperienceSnapshot=async()=>null;export const writeExperienceSnapshot=async()=>{};export const removeExperienceSnapshot=async()=>{};' }));
  } }, await installedClientPlugin()] });
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    response.end(request.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});

after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no unhandled browser errors'));
  await page.goto(base);
  await page.waitForFunction(() => window.fixtureReady && h.reads.length === 4 && document.querySelectorAll('output').length === 4 && !document.body.innerText.includes('opening'));
  await page.evaluate(() => window.rememberStaff());
  return page;
}

for (const [label, value] of [['no eligible suggestion', null], ['claimed suggestion', { id: 'fixture-prompt', target: { sourceId: 'fixture-post', sourceType: 'beauty_post', salonId: 'fixture-salon', title: 'Fixture post' } }]]) {
  test(`generated campaign prompt proxy preserves active Owner caches and Staff quarantine: ${label}`, options, async t => {
    const page = await fixture(t);
    const before = await page.evaluate(() => window.memory());
    assert.deepEqual(await page.evaluate(async value => { h.value = value; return window.call('prompt'); }, value), value);
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => h.commands.length), 1, 'claim still reaches the original command boundary once');
    assert.equal(await page.evaluate(() => h.reads.length), 4, 'prompt eligibility must not refetch Today, Bookings, Payroll or Market');
    assert.equal(await page.evaluate(() => h.completions.length), 0);
    assert.deepEqual(await page.evaluate(() => window.memory()), before, 'cached DTO identities and data remain unchanged');
    assert.deepEqual(await page.evaluate(() => window.restoreStaff()), { marker: 'staff-kept' }, 'unrelated role quarantine survives the claim');
    await page.evaluate(() => window.setVisible(false));
    await page.waitForFunction(() => document.querySelectorAll('output').length === 0);
    await page.evaluate(() => window.setVisible(true));
    await page.waitForFunction(() => document.querySelectorAll('output').length === 4);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => h.reads.length), 4, 'reopening fresh Owner pages reuses their existing DTOs');
    assert.equal(await page.evaluate(() => h.network), 0);
  });
}

for (const action of ['write', 'dismiss']) {
  test(`real campaign ${action} keeps conservative resource and cross-role invalidation`, options, async t => {
    const page = await fixture(t);
    await page.evaluate(async action => { h.value = { ok: true }; await window.call(action); }, action);
    await page.waitForFunction(() => h.reads.length === 8 && document.querySelectorAll('output').length === 4 && !document.body.innerText.includes('opening'));
    assert.deepEqual(await page.evaluate(() => Object.fromEntries([...new Set(h.reads.map(row => row.name))].map(name => [name, h.reads.filter(row => row.name === name).length]))), {
      'page.owner-today': 2, 'owner.bookings': 2, 'page.owner-payroll': 2, 'page.market': 2,
    });
    assert.equal(await page.evaluate(() => h.commands.length), 1);
    assert.equal(await page.evaluate(() => h.completions.length), 1);
    assert.equal(await page.evaluate(() => h.completions[0].source), 'app/campaigns/actions.ts');
    assert.deepEqual(await page.evaluate(() => window.restoreStaff()), null, 'business writes still withdraw quarantined roles');
  });
}

test('prompt failures preserve errors and require current command authority without retrying', options, async t => {
  const page = await fixture(t);
  const denied = await page.evaluate(async () => { h.failure = 403; try { await window.call('prompt'); } catch (error) { return { message: error.message, status: error.status }; } });
  assert.deepEqual(denied, { message: 'Fixture command denied', status: 403 });
  assert.equal(await page.evaluate(() => h.commands.length), 1);
  await page.evaluate(() => window.setScope(undefined));
  assert.match(await page.evaluate(async () => { try { await window.call('prompt'); } catch (error) { return error.message; } }), /verify your account/);
  assert.equal(await page.evaluate(() => h.commands.length), 1, 'missing authority fails before transport');
  assert.equal(await page.evaluate(() => h.completions.length), 0);
  assert.equal(await page.evaluate(() => h.reads.length), 4);
  assert.deepEqual(await page.evaluate(() => window.restoreStaff()), { marker: 'staff-kept' });
});

for (const boundary of ['scope', 'generation']) {
  test(`a late prompt response cannot cross the ${boundary} boundary`, options, async t => {
    const page = await fixture(t);
    await page.evaluate(() => {
      h.hold = true; h.value = { id: 'late-prompt' };
      window.pendingCommand = window.call('prompt').then(value => ({ value }), error => ({ error: error.message }));
    });
    await page.waitForFunction(() => typeof window.releaseCommand === 'function');
    await page.evaluate(boundary => {
      if (boundary === 'scope') window.setScope('v3:' + 'c'.repeat(64));
      else window.__reylumiAppLocalContext.generation = 'generation-0000000002';
      window.releaseCommand();
    }, boundary);
    assert.match((await page.evaluate(() => window.pendingCommand)).error, /account has changed/);
    assert.equal(await page.evaluate(() => h.commands.length), 1);
    assert.equal(await page.evaluate(() => h.completions.length), 0);
    assert.equal(await page.evaluate(() => h.reads.length), 4);
  });
}
