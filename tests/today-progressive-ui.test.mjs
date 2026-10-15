import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('Today keeps same-day warm details while a new business day starts with its own actual counts', { timeout: 60000, skip: !existsSync(browserPath) }, async () => {
  const serverModule = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync('lib/experience-live-resource-server.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => name === 'node:crypto' ? { createHash } : {}, serverModule);
  const metric = (label, value) => ({ label, value, chart: null, detail: null, href: null });
  const core = { pendingSections: { metrics: ['sales'], details: true }, attention: [], businessHours: {}, date: '2026-10-12', dayView: { currentDate: '2026-10-12', selectedDate: '2026-10-12', maxDate: '2026-10-12', previousDate: '2026-10-11', nextDate: null, todayHref: '/staff/today', isCurrentDate: true, invalidDate: null }, generatedAt: '2026-10-12T15:00:00Z', greetingName: 'Owner', loadErrors: [], noAccess: false, performance: { bookingStatus: { active: 0, completed: 0, upcoming: 0 }, emptyLabel: null, salesTrend: [], sales: null, staffBars: [] }, permissions: { canViewBookings: true, canViewDashboard: true, canViewReports: true, canViewStaffFinancials: true, canViewTickets: true }, quickAccesses: { selected: [] }, rightNow: { scheduleHref: null, upcomingBookings: [], waitingClients: [] }, salonName: 'My Salon', summary: { customers: metric('Appointments', '12'), sales: { ...metric('Sales Today', '--'), detail: 'Financial totals require Reports permission.' }, staff: metric('Staff Working', '4'), waiting: metric('Waiting', '2') }, team: [], timezone: 'America/Chicago' };
  const full = { ...core, pendingSections: { metrics: [], details: false }, summary: { ...core.summary, sales: metric('Sales Today', '$325') } };
  const initial = serverModule.createLiveResourceSnapshot(core, ['generatedAt']);
  const final = serverModule.createLiveResourceSnapshot(full, ['generatedAt']);
  const nextCore = { ...core, date: '2026-10-13', generatedAt: '2026-10-13T15:00:00Z', dayView: { ...core.dayView, currentDate: '2026-10-13', selectedDate: '2026-10-13', maxDate: '2026-10-13', previousDate: '2026-10-12' }, summary: { ...core.summary, staff: metric('Staff Working', '7') } };
  const nextInitial = serverModule.createLiveResourceSnapshot(nextCore, ['generatedAt']);
  const nextFinal = serverModule.createLiveResourceSnapshot({ ...nextCore, pendingSections: { metrics: [], details: false }, summary: { ...nextCore.summary, sales: metric('Sales Today', '$450') } }, ['generatedAt']);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TodayDashboardClient}from'./app/staff/today/today-dashboard-client';function App(){const[key,setKey]=useState(0),[initial,setInitial]=useState(${JSON.stringify(initial)});window.restart=()=>setKey(value=>value+1);window.nextDay=()=>{setInitial(${JSON.stringify(nextInitial)});setKey(value=>value+1)};return <TodayDashboardClient key={key} initialSnapshot={initial} scope="owner" salonId="salon" isOwner={false}/>};createRoot(document.getElementById('root')).render(<App/>);` }, outfile: 'bundle.js', bundle: true, write: false, jsx: 'automatic', format: 'iife', alias: { '@': process.cwd() }, plugins: [{ name: 'ui-fixture', setup(b) {
    b.onResolve({ filter: /^(next\/link|.*workspace-language|.*owner-market-promo|.*quick-access-editor|.*pos-workspace-sync)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: 'tsx', contents: path === 'next/link' ? `import React from'react';export default({children,...props})=>React.createElement('a',props,children);` : path.endsWith('workspace-language') ? `import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='div',children,...props})=>React.createElement(as,props,children);` : `export const OwnerMarketPromo=()=>null;export const QuickAccessPanel=()=>null;export const subscribePosChanges=()=>()=>{};` }));
  } }] });
  let calls = 0, failing = true;
  let release, releaseNext = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  let responseGate = gate, responseSnapshot = final;
  const server = createServer(async (req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url.startsWith('/api/experience/today')) { calls++; await responseGate; if (failing) { res.writeHead(503); res.end('{}'); return; } const result = serverModule.liveResourceResponse(new Request(`http://localhost${req.url}`, { headers: req.headers }), responseSnapshot); res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text()); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('12', { exact: true }).waitFor();
    assert.equal(await page.getByText('4', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Financial totals require Reports permission.', { exact: true }).count(), 0);
    assert.equal(await page.getByText('$0', { exact: true }).count(), 0);
    assert.equal(await page.locator('[aria-busy=true]').count(), 4);
    await page.evaluate(() => { window.firstHeader = document.querySelector('header'); document.querySelector('details').open = true; });
    release();
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    assert.equal(calls, 2, 'finite read retry budget');
    failing = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText('$325', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('header') === window.firstHeader && document.querySelector('details').open), true);
    assert.equal(await page.locator('[aria-busy=true]').count(), 0);
    const previousCalls = calls;
    await page.evaluate(() => window.restart());
    await page.getByText('$325', { exact: true }).waitFor();
    assert.equal(await page.locator('[aria-busy=true]').count(), 0);
    assert.equal(calls, previousCalls, 'complete retained data wins over a new partial initial frame');
    responseGate = new Promise(resolve => { releaseNext = resolve; });
    responseSnapshot = nextFinal;
    await page.evaluate(() => window.nextDay());
    await page.getByText('7', { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await page.getByText('$325', { exact: true }).count(), 0, 'a new resolved business date never reuses yesterday’s complete snapshot');
    assert.equal(await page.locator('[aria-busy=true]').count(), 4);
    releaseNext();
    await page.getByText('$450', { exact: true }).waitFor();
    assert.equal(await page.locator('[aria-busy=true]').count(), 0);
    assert.deepEqual(errors, []);
  } finally { release(); releaseNext(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('the Today resource key binds selected and current business dates while the live endpoint stays unchanged', () => {
  let options;
  const endpoints = [];
  const api = {};
  const modules = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    '@/components/loading-feedback': { PageLoadingSkeleton: 'loading' },
    '@/lib/fetch-live-experience-resource': { fetchLiveExperienceResource: endpoint => { endpoints.push(endpoint); return async () => ({ data: {} }); } },
    '@/lib/use-experience-resource': { useExperienceResource: value => { options = value; return { data: value.initialData, available: true, refresh: async () => {}, error: undefined, refreshing: false }; } },
    '@/lib/use-live-experience-refresh': { useLiveExperienceRefresh() {} },
    './today-dashboard-view': { TodayDashboardView: 'today' },
  };
  new Function('require', 'exports', ts.transpileModule(readFileSync('app/staff/today/today-dashboard-client.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => modules[name] ?? {}, api);
  const key = (date, currentDate, requestedDate) => {
    api.TodayDashboardClient({ initialSnapshot: { data: { date, dayView: { currentDate }, pendingSections: { details: true } }, revision: 'initial', updatedAt: new Date().toISOString() }, scope: 'owner', salonId: 'salon', requestedDate, isOwner: true });
    return options.key;
  };
  assert.notEqual(key('2026-10-12', '2026-10-12'), key('2026-10-13', '2026-10-13'));
  assert.notEqual(key('2026-10-12', '2026-10-12', '2026-10-12'), key('2026-10-12', '2026-10-13', '2026-10-12'));
  assert.deepEqual(endpoints, ['/api/experience/today', '/api/experience/today', '/api/experience/today?date=2026-10-12', '/api/experience/today?date=2026-10-12']);
});
