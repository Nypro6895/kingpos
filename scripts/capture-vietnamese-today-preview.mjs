// Capture the real owner Today page with fictional dashboard data.
import fs from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright-core';

const metric = (label, value, detail) => ({ label, value, detail, href: null, chart: null });
const dashboard = {
  date: '2026-10-08', generatedAt: '2026-10-08T18:30:00Z', timezone: 'America/Chicago', greetingName: 'Lan', salonName: 'Tiệm minh họa Reylumi', noAccess: false, loadErrors: [],
  businessHours: {}, dayView: { currentDate: '2026-10-08', selectedDate: '2026-10-08', maxDate: '2026-10-08', previousDate: '2026-10-07', nextDate: null, invalidDate: null, isCurrentDate: true, todayHref: '/staff/today' },
  permissions: { canViewDashboard: true, canViewBookings: true, canViewReports: true, canViewStaffFinancials: true, canViewTickets: true },
  summary: { sales: metric('Sales', '$640.00', '12 phiếu đã hoàn tất'), customers: metric('Customers', '14', '12 khách đã phục vụ · 2 khách đang chờ'), waiting: metric('Waiting', '2', 'Nhân viên đang phục vụ khách'), staff: metric('Staff', '3 / 4', '3 nhân viên đang làm việc') },
  rightNow: { scheduleHref: '/bookings', waitingClients: [{ id: 'waiting-1', displayName: 'Khách A', checkedInAt: '2026-10-08T18:15:00Z', source: 'walk_in', status: 'waiting', assignedStaff: null, serviceLabel: 'Sơn gel', href: null }, { id: 'waiting-2', displayName: 'Khách B', checkedInAt: '2026-10-08T18:20:00Z', source: 'appointment', status: 'waiting', assignedStaff: { id: 'staff-1', name: 'Lan Anh' }, serviceLabel: 'Pedicure Spa', href: null }], upcomingBookings: [{ id: 'booking-1', customerName: 'Khách C', assignedStaff: { id: 'staff-2', name: 'Minh' }, serviceLabel: 'Chăm sóc móng tay', startAt: '2026-10-08T19:00:00Z', status: 'confirmed', href: '/bookings' }] },
  attention: [{ id: 'request-1', label: 'Requests', detail: 'Có 1 yêu cầu điều chỉnh đang chờ bạn xem xét.', count: 1, tone: 'notice', actionLabel: 'Review', href: '/notifications' }],
  team: ['Lan Anh', 'Minh', 'Thảo'].map((displayName, index) => ({ id: `staff-${index + 1}`, displayName, jobTitle: 'Nhân viên', checkInAt: '2026-10-08T14:00:00Z', checkOutAt: null, status: index === 1 ? 'checked_in' : 'working', statusLabel: index === 1 ? 'Available' : 'In service', serviceSales: [250, 190, 200][index], tips: [35, 25, 30][index], earnings: [185, 139, 150][index], turns: { large: 2, small: 1, total: 3 } })),
  performance: { emptyLabel: null, bookingStatus: { active: 2, completed: 12, upcoming: 1 }, sales: { total: 640, service: 550, tip: 90, discount: 0, ticketCount: 12, comparison: null }, salesTrend: ['09:00', '10:00', '11:00', '12:00', '13:00'].map((label, index) => ({ label, service: [40, 100, 160, 140, 110][index], tip: [5, 15, 25, 25, 20][index], total: [45, 115, 185, 165, 130][index], ticketCount: [1, 2, 4, 3, 2][index], latest: index === 4, afterHours: false })), staffBars: [{ staffId: 'staff-1', label: 'Lan Anh', value: 250 }, { staffId: 'staff-2', label: 'Minh', value: 190 }, { staffId: 'staff-3', label: 'Thảo', value: 200 }] },
  quickAccesses: { selected: [], available: [], maxSelected: 6, canCustomize: false, loadError: null },
};
const result = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import{WorkspaceLanguageProvider}from'./components/workspace-language';import TodayPage from './app/(app)/staff/today/page';(async()=>{const page=await TodayPage({searchParams:Promise.resolve({})});createRoot(document.getElementById('root')).render(<WorkspaceLanguageProvider enabled portableEnabled={false} expiresAt={null}>{page}</WorkspaceLanguageProvider>);})();` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', alias: { '@': process.cwd() }, plugins: [{ name: 'preview-data', setup(b) {
  b.onResolve({ filter: /^(next\/link|next\/navigation|.*\/today-dashboard|.*\/route-context-guards|.*\/current-context|.*\/pos-workspace-realtime-refresh|.*\/quick-access-editor|.*\/owner-market-promo)$/ }, a => ({ path: a.path, namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ loader: 'js', resolveDir: process.cwd(), contents: a.path.includes('today-dashboard') ? `export async function getTodayDashboard(){return ${JSON.stringify(dashboard)}}` : a.path.includes('route-context-guards') ? `export async function requireSalonManagePageContext(){return{currentSalon:{id:'demo'},currentMembership:{}}}` : a.path.includes('current-context') ? 'export const isOwnerMembership=()=>false;' : a.path.includes('next/link') ? `import React from 'react';export default function Link(p){return React.createElement('a',p)}` : a.path.includes('navigation') ? 'export const usePathname=()=>"/staff/today";' : a.path.includes('quick-access') ? 'export function QuickAccessPanel(){return null}' : a.path.includes('owner-market') ? 'export function OwnerMarketPromo(){return null}' : 'export function PosWorkspaceRealtimeRefresh(){return null}' }));
} }] });
const globals = await postcss([tailwind()]).process(fs.readFileSync('app/globals.css', 'utf8'), { from: 'app/globals.css' });
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<html lang="vi"><head><style>${globals.css}body{margin:0}#root{width:1400px;margin:auto}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text}</script></body></html>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.clock.install({ time: new Date('2026-10-08T18:30:00Z') });
  const errors = [];page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('[data-today-dashboard]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) throw new Error(errors.join('\n'));
  await page.locator('#root').screenshot({ path: 'public/market/features/vietnamese-language/today-v1.png' });
  console.log('Today screenshot captured', await page.locator('#root').boundingBox());
} finally { await browser.close(); await new Promise(r => server.close(r)); }
