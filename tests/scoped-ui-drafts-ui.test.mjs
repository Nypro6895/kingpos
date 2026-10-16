import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const skip = !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH;
async function fixture(kind = 'draft', { hold = false, seed = null, seedAt = 1 } = {}) {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const root = resolve('.').replaceAll('\\', '/');
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import React,{Activity,useLayoutEffect,useState}from'react';import{createRoot}from'react-dom/client';
import{useScopedUiDraft}from'${root}/lib/use-scoped-ui-draft';
import{usePersistentReadView}from'${root}/lib/use-persistent-read-view';
import{StaffIncomeAutosaveInputs}from'${root}/app/payroll/staff-income-autosave-inputs';
import{StaffRelay}from'${root}/app/service-relay/staff-relay';
import{OfflineNetworkFormGuard}from'${root}/components/offline-network-form-guard';
window.online=true;Object.defineProperty(Navigator.prototype,'onLine',{get:()=>window.online});
window.scope='account-a';window.authorized=true;window.staffApproved=false;window.writes=[];window.removals=[];window.reads=[];window.pendingReads=[];window.mutations=[];window.submits=[];window.hold=${hold};window.seed=${JSON.stringify(seed)};window.seedAt=${seedAt};
window.resolveReads=()=>{for(const item of window.pendingReads.splice(0))item.resolve(window.seed?{data:window.seed,updatedAt:window.seedAt,retainUntil:Date.now()+3600000}:null)};
function Draft({scope}){const[value,setValue]=useState('');const[dirty,setDirty]=useState(false);const draft=useScopedUiDraft({scope,domain:'test',params:{record:'one'},value:{text:value},dirty,validate:v=>!!v&&typeof v.text==='string',onRestore:v=>{setValue(v.text);setDirty(true)}});return <><input aria-label="Draft" value={value} onChange={e=>{draft.markEdited();setValue(e.target.value);setDirty(true)}}/><button onClick={()=>setDirty(false)}>Confirm saved</button></>}
function Read({scope}){const[value,setValue]=useState({text:'server',timestamp:10});useLayoutEffect(()=>{window.freshServer=()=>setValue({text:'fresh server',timestamp:100})},[]);usePersistentReadView({scope,domain:'read-test',params:{record:'one'},data:{text:value.text},updatedAt:value.timestamp,validate:v=>!!v&&typeof v.text==='string',onRestore:(v,timestamp)=>setValue({...v,timestamp})});return <p data-read>{value.text}</p>}
function Forms(){return <><OfflineNetworkFormGuard/><form data-form="network" action={async data=>{window.submits.push(Object.fromEntries(data))}}><input aria-label="Entry" name="entry" defaultValue="kept"/><button>Save online</button></form><form data-offline-local-submit="true" onSubmit={e=>{e.preventDefault();window.submits.push('local')}}><button>Save locally</button></form></>}
function App(){const[scope,setScope]=useState('account-a');const[shown,setShown]=useState(true);const[mount,setMount]=useState(true);const[revision,setRevision]=useState(0);useLayoutEffect(()=>{window.hide=()=>setShown(false);window.show=()=>setShown(true);window.unmount=()=>setMount(false);window.remount=()=>{setRevision(v=>v+1);setMount(true)};window.changeScope=s=>{window.scope=s;setScope(s)}},[]);return <><p data-visible>{shown?'shown':'hidden'}</p>{mount&&<Activity mode={shown?'visible':'hidden'}><div key={revision+'|'+scope}>${kind === 'payroll' ? '<StaffIncomeAutosaveInputs bonusAmount={0} bonusPayoutMethod="cash" canManage={true} checkNumber={null} cycleType="weekly" note={null} periodStart="2026-10-12" periodEnd="2026-10-18" staffId="staff-a" taxBonus={false}/>' : kind === 'relay' ? '<StaffRelay salonId="salon-a" scope={scope}/>' : kind === 'forms' ? '<Forms/>' : kind === 'read' ? '<Read scope={scope}/>' : '<Draft scope={scope}/>'}</div></Activity>}</>}
createRoot(document.getElementById('root')).render(<App/>);
` }, jsx: 'automatic', bundle: true, write: false, platform: 'browser', plugins: [{ name: 'controlled-role-fixture', setup(builder) {
    builder.onResolve({ filter: /experience-persistent-cache$/ }, () => ({ path: 'storage', namespace: 'fixture' }));
    builder.onResolve({ filter: /(?:workspace-language|experience-scope|payroll-edit-boundary|use-payroll-refresh-batch|pos-workspace-sync)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }));
    builder.onResolve({ filter: /\/actions$/ }, args => { const importer = args.importer.replaceAll('\\', '/'); return importer.includes('/payroll/') || importer.includes('/service-relay/') ? { path: importer.includes('/payroll/') ? 'payroll-actions' : 'relay-actions', namespace: 'fixture' } : undefined; });
    builder.onResolve({ filter: /\.module\.css$/ }, () => ({ path: 'style', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: ({
      storage: `export const isExperienceSnapshotAuthorized=s=>window.authorized&&s===window.scope;export const isExperienceSnapshotContextAuthorized=c=>isExperienceSnapshotAuthorized(c.scope)&&(!c.domain.startsWith('draft:staff-')||window.staffApproved);export async function readExperienceSnapshot(context){window.reads.push(context);if(window.hold)return new Promise(resolve=>window.pendingReads.push({context,resolve}));return window.seed?{data:window.seed,updatedAt:window.seedAt,retainUntil:Date.now()+3600000}:null}export async function writeExperienceSnapshot(value){window.writes.push(value);return true}export async function removeExperienceSnapshot(value){window.removals.push(value);return true}`,
      'workspace-language': 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>value=>value;',
      'experience-scope': 'export const useExperienceScope=()=>({context:{scope:window.scope,authenticated:true}});',
      'payroll-edit-boundary': 'export const usePayrollEdits=()=>({update:()=>{}});',
      'use-payroll-refresh-batch': 'export function usePayrollRefreshBatch(){}',
      'pos-workspace-sync': 'export const subscribePosChanges=()=>()=>{};',
      'payroll-actions': `export async function autosavePayrollPeriodStaffInputAction(previous,data){window.mutations.push({kind:'payroll',data:Object.fromEntries(data)});return{status:'saved',message:null,savedAt:'2026-10-16T00:00:00.000Z'}}`,
      'relay-actions': `export async function loadServiceRelay(){return{data:{installed:true,staffId:'staff-a',services:[{id:'service-a',name:'Manicure'}],tickets:[{id:'ticket-a',visitId:'visit-a',customerName:'Fixture customer',queueNumber:1,revision:2,lines:[],offers:[{id:'offer-a',staffId:'staff-a',serviceId:'service-a',status:'working'}]}]}}}export async function saveServiceRelay(value){window.mutations.push({kind:'relay',data:value});return{}}export async function respondServiceRelay(){throw Error('Unexpected response mutation')}export async function findServiceRelay(){throw Error('Unexpected find mutation')}`,
      style: 'export default {}',
    })[args.path] }));
  } }] });
  const server = createServer((request, response) => { if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text); } else { response.setHeader('Content-Type', 'text/html'); response.end('<style>[hidden]{display:none}input,button{margin:6px;padding:8px}</style><div id="root"></div><script src="/bundle.js"></script>'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  return { page, errors, async close() { assert.deepEqual(errors, []); await browser.close(); await new Promise(resolve => server.close(resolve)); } };
}

test('scoped draft ignores late restore after input, keeps Activity draft and restores only on true remount', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('draft', { hold: true, seed: { text: 'older stored draft' } }); const { page } = app;
  try {
    await page.getByLabel('Draft').fill('current typing');
    await page.evaluate(() => window.hide()); await page.getByText('hidden', { exact: true }).waitFor();
    await page.evaluate(() => window.resolveReads()); await page.evaluate(() => window.show());
    assert.equal(await page.getByLabel('Draft').inputValue(), 'current typing');
    await page.evaluate(() => window.resolveReads());
    await page.waitForFunction(() => window.writes.some(v => v.data.text === 'current typing'));
    assert.equal(await page.evaluate(() => window.reads.length), 2, 'a hidden unresolved read can be retried without replaying its stale result');
    await page.evaluate(() => { window.hold = false; window.seed = { text: 'remount draft' }; window.unmount(); });
    await page.getByLabel('Draft').waitFor({ state: 'detached' }); await page.evaluate(() => window.remount());
    await page.waitForFunction(() => document.querySelector('input').value === 'remount draft');
    await page.getByRole('button', { name: 'Confirm saved' }).click();
    await page.waitForFunction(() => window.removals.length > 0);
  } finally { await app.close(); }
});

test('scope change rejects old async draft; logout prevents late restore and subsequent writes', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('draft', { hold: true, seed: { text: 'private account a' } }); const { page } = app;
  try {
    await page.getByLabel('Draft').waitFor();
    await page.evaluate(() => window.changeScope('account-b'));
    await page.evaluate(() => { window.seed = { text: 'account b' }; window.resolveReads(); });
    await page.waitForFunction(() => document.querySelector('input').value === 'account b');
    assert.equal(await page.evaluate(() => window.writes.some(v => v.scope === 'account-a' && v.data.text === 'account b')), false);
    await page.evaluate(() => { window.authorized = false; window.dispatchEvent(new Event('reylumi:experience-reset')); });
    const before = await page.evaluate(() => window.writes.length);
    await page.getByLabel('Draft').fill('after logout');
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.resolveReads(); });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.writes.length), before);
  } finally { await app.close(); }
});

test('recovered payroll draft never triggers the 700ms autosave or blur; explicit review saves once', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('payroll', { seed: { bonus: '45.50', check: 'fixture-123' } }); const { page } = app;
  try {
    await page.waitForFunction(() => document.querySelector('[name=bonus_amount]').value === '45.50');
    await page.getByLabel('Check #:').focus(); await page.getByLabel('Bonus:').focus();
    await page.waitForTimeout(950);
    assert.equal(await page.evaluate(() => window.mutations.length), 0);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForFunction(() => window.mutations.length === 1);
    assert.equal(await page.evaluate(() => window.mutations[0].data.bonus_amount), '45.50');
    await page.waitForFunction(() => window.removals.length > 0);
  } finally { await app.close(); }
});

test('staff service refuses cross-route stored data; offline unsent entries remain through Activity and reconnect without replay', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('relay', { seed: { lines: [{ id: 'line-draft', serviceId: 'service-a', amount: '35.00' }], revision: 2 } }); const { page } = app;
  try {
    await page.getByLabel('Price 1').waitFor();
    assert.equal(await page.getByLabel('Price 1').inputValue(), '', 'a different-route lease cannot authorize protected staff disk restoration');
    assert.equal(await page.evaluate(() => window.reads.length), 0);
    await page.evaluate(() => { window.online = false; });
    await page.getByLabel('Price 1').fill('35.00'); await page.waitForTimeout(1100);
    await page.evaluate(() => window.hide()); await page.getByText('hidden', { exact: true }).waitFor();
    await page.evaluate(() => window.show()); await page.getByLabel('Price 1').waitFor();
    assert.equal(await page.getByLabel('Price 1').inputValue(), '35.00');
    await page.evaluate(() => { window.online = true; window.dispatchEvent(new Event('online')); }); await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.mutations.length), 0);
    await page.getByRole('button', { name: 'Send to POS', exact: true }).click();
    await page.waitForFunction(() => window.mutations.length === 1);
    assert.equal(await page.evaluate(() => window.mutations[0].data.lines[0].amount), '35.00');
    assert.equal(await page.evaluate(() => window.writes.length), 0);
  } finally { await app.close(); }
});

test('offline network form guard retains fields, permits explicit local submit, and never replays on reconnect', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('forms'); const { page } = app;
  try {
    await page.getByLabel('Entry').fill('unsent changes'); await page.evaluate(() => { window.online = false; });
    await page.getByRole('button', { name: 'Save online' }).click();
    await page.getByRole('status').waitFor();
    assert.deepEqual(await page.evaluate(() => window.submits), []);
    assert.equal(await page.getByLabel('Entry').inputValue(), 'unsent changes');
    await page.getByRole('button', { name: 'Save locally' }).click();
    assert.deepEqual(await page.evaluate(() => window.submits), ['local']);
    await page.evaluate(() => { window.online = true; window.dispatchEvent(new Event('online')); });
    assert.deepEqual(await page.evaluate(() => window.submits), ['local']);
    await page.getByRole('button', { name: 'Save online' }).click();
    await page.waitForFunction(() => window.submits.length === 2);
    assert.equal(await page.evaluate(() => window.submits[1].entry), 'unsent changes');
    await page.evaluate(() => { window.online = false; window.hide(); }); await page.getByText('hidden', { exact: true }).waitFor();
    await page.evaluate(() => window.show()); await page.getByLabel('Entry').waitFor();
    await page.getByRole('button', { name: 'Save online' }).click(); await page.getByRole('status').waitFor();
    assert.equal(await page.evaluate(() => window.submits.length), 2);
  } finally { await app.close(); }
});

test('persistent read restores newer authorized data but never replaces a newer server response or survives reset', { skip, timeout: 60_000 }, async () => {
  const app = await fixture('read', { hold: true, seed: { text: 'saved read' }, seedAt: 20 }); const { page } = app;
  try {
    await page.getByText('server', { exact: true }).waitFor();
    await page.evaluate(() => window.resolveReads()); await page.getByText('saved read', { exact: true }).waitFor();
    await page.evaluate(() => { window.freshServer(); }); await page.getByText('fresh server', { exact: true }).waitFor();
    await page.evaluate(() => { window.resolveReads(); });
    await page.waitForFunction(() => window.writes.some(v => v.data.text === 'fresh server'));
    assert.equal(await page.locator('[data-read]').textContent(), 'fresh server');
    const before = await page.evaluate(() => window.writes.length);
    await page.evaluate(() => { window.authorized = false; window.dispatchEvent(new Event('reylumi:experience-reset')); window.seed = { text: 'denied read' }; window.seedAt = 1000; window.resolveReads(); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-read]').textContent(), 'fresh server');
    assert.equal(await page.evaluate(() => window.writes.length), before);
  } finally { await app.close(); }
});
