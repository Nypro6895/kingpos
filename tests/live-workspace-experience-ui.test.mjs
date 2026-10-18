import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import ts from 'typescript';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

function serverHelpers() {
  const exports = {};
  const source = ts.transpileModule(readFileSync('lib/experience-live-resource-server.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', source)(name => name === 'node:crypto' ? { createHash } : {}, exports);
  return exports;
}

test('mobile Today and My Work retain the live view and update only changed authorized sections', { skip: !process.env.TEST_BROWSER_PATH }, async () => {
  const { createLiveResourceSnapshot, liveResourceResponse } = serverHelpers();
  const metric = (label, value) => ({ label, value, chart: null, detail: null, href: null, tone: 'default' });
  const today = {
    attention: [], businessHours: {}, date: '2026-10-11',
    dayView: { currentDate: '2026-10-11', selectedDate: '2026-10-11', maxDate: '2026-10-11', previousDate: '2026-10-10', nextDate: null, todayHref: '/staff/today', isCurrentDate: true, invalidDate: null },
    generatedAt: '2026-10-11T15:00:00Z', greetingName: 'Owner', loadErrors: [], noAccess: false,
    performance: { bookingStatus: { active: 0, completed: 0, upcoming: 0 }, emptyLabel: null, salesTrend: [], sales: null, staffBars: [] },
    permissions: { canViewBookings: false, canViewDashboard: true, canViewReports: false, canViewStaffFinancials: false, canViewTickets: false },
    quickAccesses: { selected: [] }, rightNow: { scheduleHref: null, upcomingBookings: [], waitingClients: [] },
    salonName: 'My Salon', summary: { customers: metric('Appointments', '0'), sales: metric('Sales Today', '$100'), staff: metric('Staff Working', '1'), waiting: metric('Waiting', '0') }, team: [], timezone: 'America/Chicago',
  };
  const ticket = total => ({ id: 'own-ticket', bigTurns: 1, closedAt: '2026-10-11T14:00:00Z', customerName: 'Client', customerPhone: null, firstActivityAt: null, hasEarning: true, openedAt: '2026-10-11T13:00:00Z', serviceTotal: total, services: [], smallTurns: 0, status: 'closed', ticketNumber: '1', tipAmount: 0, totalEarning: total, totalTurns: 1 });
  const work = { salonId: 'staff-salon', staff: { id: 'staff', display_name: 'Staff', public_profile_photo_path: null }, today: '2026-10-11', workTickets: [ticket(10)], excludedTicketCount: 0, workStatus: 'working', workStatusLabel: 'Working', salonTimezone: 'America/Chicago', greetingHistory: null, staffDisplayName: 'Staff', staffAvatarUrl: null, payrollData: null, analysisData: null, generatedAt: '2026-10-11T15:00:00Z' };
  const initialToday = createLiveResourceSnapshot(today, ['generatedAt']);
  const initialWork = createLiveResourceSnapshot(work, ['generatedAt']);
  let authorized = true, apiCalls = 0;
  const changedKeys = [];
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{Activity,useState} from 'react';import{createRoot}from'react-dom/client';
    import{TodayDashboardClient}from'./app/staff/today/today-dashboard-client';
    import{StaffMyWorkClient}from'./app/staff/my-work/staff-my-work-client';
    import{experienceResourceCache}from'./lib/experience-resource-cache';
    window.clearPrivate=()=>experienceResourceCache.suspend();
    function App(){const[active,setActive]=useState('today');return <><nav><button onClick={()=>setActive('today')}>Open Today</button><button onClick={()=>setActive('work')}>Open My Work</button></nav><Activity mode={active==='today'?'visible':'hidden'}><TodayDashboardClient initialSnapshot={${JSON.stringify(initialToday)}} scope="owner" salonId="owner-salon" isOwner={false}/></Activity><Activity mode={active==='work'?'visible':'hidden'}><StaffMyWorkClient initialSnapshot={${JSON.stringify(initialWork)}} scope="staff" params={{}}/></Activity><div style={{height:1200}}/></>}
    createRoot(document.getElementById('root')).render(<App/>);` }, outfile: 'bundle.js', bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'authorized-live-fixture', setup(b) {
      b.onResolve({ filter: /^(next\/link|next\/navigation|.*workspace-language|.*owner-market-promo|.*quick-access-editor|.*staff-profile-settings-drawer|.*contextual-support|.*staff-relay|.*staff-load-retry|.*pos-workspace-sync|.*customer-name|.*payroll-ledger-panel)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: process.cwd(), loader: 'tsx', contents:
        path.endsWith('workspace-language') ? `import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='div',children,...props})=>React.createElement(as,props,children);export const useWorkspaceTranslation=()=>text=>text;`
        : path.endsWith('payroll-ledger-panel') ? `export const PayrollAdjustmentHistory=()=>null;`
        : path.endsWith('customer-name') ? `export const CustomerName=({name,children})=>name??children??null;`
        : path === 'next/link' ? `import React from'react';export const useLinkStatus=()=>({pending:false});export default({children,...props})=>React.createElement('a',props,children);`
        : path === 'next/navigation' ? `export const useRouter=()=>({refresh(){},push(){},replace(){}});`
        : path.endsWith('pos-workspace-sync') ? `const listeners=new Map();window.emitWorkspace=(salonId,resource)=>{for(const callback of listeners.get(salonId)??[])callback({resource})};export function subscribePosChanges(id,callback){let callbacks=listeners.get(id);if(!callbacks)listeners.set(id,callbacks=new Set());callbacks.add(callback);return()=>callbacks.delete(callback)}`
        : `export const OwnerMarketPromo=()=>null;export const QuickAccessPanel=()=>null;export const StaffProfileSettingsDrawer=()=>null;export const ContextualSupport=()=>null;export const StaffRelay=()=>null;export const StaffLoadRetry=()=>null;`
      }));
    } }] });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/experience/')) {
      apiCalls++;
      const owner = url.pathname.endsWith('/today');
      const expectedScope = owner ? 'owner' : 'staff';
      if (!authorized || url.searchParams.get('scope') !== expectedScope) { response.writeHead(403); response.end(); return; }
      const req = new Request(`http://localhost${request.url}`, { headers: request.headers });
      const liveResponse = liveResourceResponse(req, createLiveResourceSnapshot(owner ? today : work, ['generatedAt']));
      response.writeHead(liveResponse.status, Object.fromEntries(liveResponse.headers));
      const body = await liveResponse.text();
      if (body) changedKeys.push(Object.keys(JSON.parse(body).data));
      response.end(body); return;
    }
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font-family:Arial}nav{position:sticky;top:0;background:white;z-index:100}nav button{min-height:44px}main{padding:16px}details{margin:8px}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('$100', { exact: true }).waitFor();
    await page.evaluate(() => { window.originalToday = document.querySelector('[data-today-dashboard]'); window.originalHeader = window.originalToday.querySelector('header'); window.originalToday.querySelector('details').open = true; });
    await page.getByRole('button', { name: 'Open My Work', exact: true }).click();
    await page.getByText('$10.00', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Open Today', exact: true }).click();
    assert.equal(await page.evaluate(() => document.querySelector('[data-today-dashboard]') === window.originalToday && window.originalToday.querySelector('details').open), true);
    const before = apiCalls;
    today.summary = { ...today.summary, sales: { ...today.summary.sales, value: '$150' } };
    await page.evaluate(() => { window.scrollTo(0, 120); window.emitWorkspace('owner-salon', 'tickets'); });
    await page.getByText('$150', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.originalToday.querySelector('header') === window.originalHeader && window.originalToday.querySelector('details').open), true);
    assert.equal(await page.evaluate(() => window.scrollY), 120);
    assert.deepEqual(changedKeys.at(-1).sort(), ['generatedAt', 'summary']);
    assert.equal(apiCalls, before + 1);
    await page.evaluate(() => window.emitWorkspace('owner-salon', 'tickets'));
    await page.waitForFunction(count => performance.getEntriesByType('resource').filter(entry => entry.name.includes('/api/experience/today')).length >= count, 2);
    assert.equal(changedKeys.length, 1, 'unchanged resource returns 304 with no body');
    await page.getByRole('button', { name: 'Open My Work', exact: true }).click();
    work.workTickets = [ticket(20)];
    await page.evaluate(() => window.emitWorkspace('staff-salon', 'tickets'));
    await page.getByText('$20.00', { exact: true }).first().waitFor();
    assert.deepEqual(changedKeys.at(-1).sort(), ['generatedAt', 'workTickets']);
    authorized = false;
    await page.evaluate(() => window.emitWorkspace('staff-salon', 'staff'));
    await page.getByText('Getting things ready…', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-staff-today]').count(), 0, 'access rejection immediately removes private display');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

