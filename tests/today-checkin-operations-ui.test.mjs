import {browserServerBoundary} from './helpers/browser-server-boundary.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync,readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const browserPath = process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
test('Today shows real visit lifecycle and separate live staff state without mobile overflow or historical live claims', { timeout: 60000, skip: !existsSync(browserPath) }, async () => {
  const repo = resolve('.').replaceAll('\\', '/');
  const metric = (label, value) => ({ label, value, chart: null, detail: null, href: null });
  const member = (id, displayName, operationalState) => ({ id, displayName, operationalState, status: 'checked_in', statusLabel: 'Checked in', jobTitle: null, checkInAt: '2026-11-11T14:00:00Z', checkOutAt: null, turns: {large: 0, small: 0, total: 0} });
  const dashboard = {
    pendingSections: {metrics: [], details: false}, attention: [], businessHours: {buckets: []}, date: '2026-11-11',
    dayView: {currentDate: '2026-11-11', selectedDate: '2026-11-11', maxDate: '2026-11-11', previousDate: '2026-11-10', nextDate: null, todayHref: '/staff/today', isCurrentDate: true, invalidDate: null},
    generatedAt: '2026-11-11T17:00:00Z', greetingName: 'Owner', loadErrors: [], noAccess: false,
    performance: {bookingStatus: {active: 0, completed: 0, upcoming: 0}, emptyLabel: null, salesTrend: [], sales: null, staffBars: []},
    permissions: {canViewBookings: false, canViewDashboard: true, canViewReports: false, canViewStaffFinancials: false, canViewTickets: true},
    quickAccesses: {available: [], selected: []}, rightNow: {scheduleHref: null, upcomingBookings: [], waitingClients: []}, salonName: 'King Nails',
    summary: {customers: metric('Checked in', '55'), sales: metric('Sales Today', '--'), staff: metric('Staff available', '1'), waiting: metric('Waiting', '31')},
    team: [member('a', 'Anna', 'busy'), member('b', 'Bella', 'available'), member('c', 'Chris', 'offDuty')], timezone: 'America/Chicago',
    checkinOperations: {enabled: true, currentDay: true, businessDate: '2026-11-11', counts: {checkedIn: 55, waiting: 31, inService: 2, readyToPay: 3, submitted: 18, cancelled: 1}, staff: {busy: 1, available: 1, offDuty: 1}, staffStates: []},
  };
  const bundle = await build({stdin: {resolveDir: repo, loader: 'tsx', contents: `import React from'react';import{createRoot}from'react-dom/client';import{TodayDashboardView}from'./app/staff/today/today-dashboard-view';const root=createRoot(document.getElementById('root')),dashboard=${JSON.stringify(dashboard)};window.historical=()=>{const next={...dashboard,date:'2026-11-10',dayView:{...dashboard.dayView,isCurrentDate:false,selectedDate:'2026-11-10'},summary:{...dashboard.summary,staff:{...dashboard.summary.staff,label:'Staff Worked',value:'3'}},team:dashboard.team.map(({operationalState,...member})=>member),checkinOperations:{...dashboard.checkinOperations,currentDay:false,staff:null,staffStates:[]}};root.render(<TodayDashboardView dashboard={next} isOwner={false}/>)};root.render(<TodayDashboardView dashboard={dashboard} isOwner={false}/>);`}, bundle: true, outfile:"fixture.js", write: false, jsx: 'automatic', format: 'iife', alias: {'@': repo}, plugins: [browserServerBoundary(),{name: 'view-boundaries', setup(b) {
    b.onResolve({filter: /^(next\/link|.*workspace-language|.*owner-market-promo|.*quick-access-editor)$/}, args => ({path: args.path, namespace: 'fixture'}));
    b.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({resolveDir: repo, loader: 'tsx', contents: path === 'next/link' ? `import React from'react';export default({children,...props})=>React.createElement('a',props,children);` : path.endsWith('workspace-language') ? `import React from'react';export const useWorkspaceTranslation=()=>text=>text;export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='div',children,...props})=>React.createElement(as,props,children);` : 'export const OwnerMarketPromo=()=>null;export const QuickAccessPanel=()=>null;'}));
  }}]});
  const css = await postcss([tailwind({base: repo})]).process(readFileSync('app/globals.css','utf8'), {from: join(repo,'app/globals.css')});
  const server = createServer((req, res) => { if (req.url === '/bundle.js') {res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith(".js")).text);} else if (req.url === '/style.css') {res.setHeader('Content-Type','text/css');res.end(css.css+(bundle.outputFiles.find(f=>f.path.endsWith(".css"))?.text??""));} else {res.setHeader('Content-Type','text/html');res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({args: ['--no-proxy-server'], executablePath: browserPath, headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1080}});
    const errors = []; page.on('pageerror', error => {errors.push(error.message);console.error('Today fixture browser:',error.stack)});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Checked in', {exact:true}).waitFor({timeout:5000}).catch(async e=>{console.error('Today body:',await page.locator('body').innerText());throw e});
    const progress = page.getByRole('region', {name:'Check-in progress'});
    await progress.getByText('Ready to pay', {exact:true}).waitFor();
    assert.equal(await progress.getByText('18', {exact:true}).textContent(), '18');
    await page.getByText('Team & staff details',{exact:true}).click();
    for (const label of ['Busy','Available','Off duty']) assert.equal(await page.getByText(label,{exact:true}).filter({visible:true}).count(),1);
    assert.equal(await page.getByRole('columnheader', {name:'Services', exact:true}).count(),0,'no financial columns without permission');
    const output = 'artifacts/checkin-shared-lifecycle-20261111';mkdirSync(output,{recursive:true});
    await page.screenshot({path:join(output,'today-operations-desktop.png'),fullPage:true});
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no overflow at ${width}: `+JSON.stringify(await page.locator("body *").evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})))));
      for (const label of ['Busy','Available','Off duty']) assert.equal(await page.getByText(label,{exact:true}).filter({visible:true}).count(),1);
    }
    await page.screenshot({path:join(output,'today-operations-mobile.png'),fullPage:true});
    await page.evaluate(()=>window.historical());
    await progress.getByText(/Current state of visits checked in on this date/).waitFor();
    assert.equal(await page.getByText('Staff available',{exact:true}).count(),0);
    assert.equal(await page.getByText('Busy',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
});
