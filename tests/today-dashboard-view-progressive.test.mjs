import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

// Render the production view itself. Only its app-shell/integration components
// are replaced; all pending, metric, queue, attention, Team and money UI is real.
function loadView() {
  const exports = {};
  const file = 'app/staff/today/today-dashboard-view.tsx';
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const deps = {
    'react/jsx-runtime': jsxRuntime,
    '@/components/workspace-language': {
      WorkspaceText: ({ text }) => React.createElement(React.Fragment, null, text),
      WorkspaceElement: ({ as = 'span', children, ...props }) => React.createElement(as, props, children),
    },
    '@/components/navigation-form': {
      NavigationForm: ({ children, ...props }) => React.createElement('form', props, children),
      NavigationSubmitButton: ({ children, ...props }) => {
        delete props.pendingLabel;
        return React.createElement('button', props, children);
      },
    },
    '@/lib/today-metric-assessment': { backlogTone: count => count > 0 ? 'warning' : 'default' },
    '@/components/owner-market-promo': { OwnerMarketPromo: () => React.createElement('aside', { 'data-external': 'owner-promo' }) },
    'next/link': { __esModule: true, default: ({ children, ...props }) => {
      delete props.prefetch;
      return React.createElement('a', props, children);
    } },
    '@/app/staff/today/quick-access-editor': { QuickAccessPanel: () => React.createElement('section', { 'data-external': 'quick-access' }, 'Quick access') },
  };
  new Function('require', 'exports', code)(name => {
    assert.ok(name in deps, `Unexpected view dependency ${name}`);
    return deps[name];
  }, exports);
  return exports.TodayDashboardView;
}
const TodayDashboardView = loadView();
const date = '2026-10-18';
const allSections = ['staff', 'bookings', 'waiting', 'financials', 'extras'];
function fixture() {
  const metric = label => ({ label, value: '0', detail: 'No activity yet', chart: null, href: null, tone: 'default' });
  return {
    pendingSections: { sections: [...allSections], metrics: ['customers', 'sales', 'staff', 'waiting'], details: true },
    attention: [{ id: 'all-good', label: 'All good', detail: 'Nothing needs your attention right now.', tone: 'good', href: null }],
    businessHours: { buckets: [], closesAtLocal: '18:00', date, fallbackReason: null, isClosed: false, isFallback: false, opensAtLocal: '09:00', source: 'staff_availability_rules', spansOvernight: false, timeZone: 'UTC' },
    date,
    dayView: { currentDate: date, invalidDate: null, isCurrentDate: true, maxDate: date, nextDate: null, previousDate: '2026-10-17', selectedDate: date, todayHref: '/staff/today' },
    generatedAt: `${date}T15:00:00.000Z`, greetingName: 'Owner', loadErrors: [], noAccess: false,
    permissions: { canViewBookings: true, canViewDashboard: true, canViewReports: true, canViewStaffFinancials: true, canViewTickets: true },
    performance: { bookingStatus: { active: 0, completed: 0, upcoming: 0 }, emptyLabel: null, salesTrend: [], sales: null, staffBars: [] },
    quickAccesses: { available: [], canCustomize: false, loadError: null, maxSelected: 8, selected: [] },
    rightNow: { scheduleHref: '/bookings', upcomingBookings: [], waitingClients: [] },
    salonName: 'Test Salon',
    summary: { customers: metric('Appointments'), sales: metric('Sales Today'), staff: metric('Staff Working'), waiting: metric('Waiting') },
    team: [], timezone: 'UTC',
  };
}
function staffAndBookingsReady() {
  const dashboard = fixture();
  dashboard.pendingSections = { sections: ['waiting', 'financials', 'extras'], metrics: ['sales', 'waiting'], details: true };
  dashboard.attention = [];
  dashboard.summary.customers = { ...dashboard.summary.customers, value: '2', detail: '1 completed / 1 upcoming' };
  dashboard.summary.staff = { ...dashboard.summary.staff, value: '1', detail: '1 checked in now' };
  dashboard.team = [{
    id: 'staff-a', displayName: 'Visible Staff A', jobTitle: 'Nail technician', status: 'checked_in', statusLabel: 'Checked in',
    checkInAt: `${date}T09:00:00.000Z`, checkOutAt: null,
    // Deliberately retain money in the DTO to prove the pending view hides it.
    serviceSales: 88.5, tips: 10.25, earnings: 98.75,
    financialAttribution: { services: 'earnings', tips: 'earnings' },
    turns: { large: 3, small: 1, total: 4 },
  }];
  dashboard.rightNow.upcomingBookings = [{ id: 'booking-a', customerName: 'Ready Appointment Client', assignedStaff: { id: 'staff-a', name: 'Visible Staff A' }, serviceLabel: 'Manicure', startAt: `${date}T16:00:00.000Z`, status: 'confirmed', href: '/bookings?booking=fixture' }];
  dashboard.performance.bookingStatus = { active: 1, completed: 1, upcoming: 1 };
  return dashboard;
}
function render(dashboard, props = {}) {
  return renderToStaticMarkup(React.createElement(TodayDashboardView, { dashboard, isOwner: false, ...props }));
}
function summary(html) {
  const match = html.match(/<section\b[^>]*aria-label="Today summary"[^>]*>([\s\S]*?)<\/section>/);
  assert.ok(match, 'real summary region must render');
  return match[1];
}

test('real pending view renders unknown metrics and Checking without false quiet, clear or error states', () => {
  const html = render(fixture());
  assert.equal((summary(html).match(/aria-label="Loading"/g) ?? []).length, 4);
  assert.doesNotMatch(summary(html), />0<|\$0|No activity yet/);
  assert.match(html, /Checking…/);
  assert.doesNotMatch(html, /Quiet right now|All clear|All good|Check unavailable|No clients waiting right now|No upcoming appointments/);
  assert.doesNotMatch(html, /Some Today sections could not load|We couldn’t finish loading|Try again/);
});

test('real staff and booking content renders independently while finance and waiting remain unknown', () => {
  const html = render(staffAndBookingsReady());
  assert.match(html, /Visible Staff A/);
  assert.match(html, /Ready Appointment Client/);
  assert.match(html, /Manicure/);
  assert.match(summary(html), /1 checked in now|1 completed \/ 1 upcoming/);
  assert.equal((summary(html).match(/aria-label="Loading"/g) ?? []).length, 2);
  assert.match(html, /aria-label="Turns unavailable"/);
  assert.doesNotMatch(html, /3 large turns and 1 small turns|\$88\.5|\$10\.25|\$98\.75/);
  assert.doesNotMatch(html, /Quiet right now|No clients waiting right now|All clear|Check unavailable/);
});

test('real waiting content renders while appointments are still pending', () => {
  const dashboard = fixture();
  dashboard.pendingSections.sections = ['staff', 'bookings', 'financials', 'extras'];
  dashboard.pendingSections.metrics = ['customers', 'sales', 'staff'];
  dashboard.summary.waiting.value = '1';
  dashboard.rightNow.waitingClients = [{ id: 'visit-a', checkedInAt: `${date}T14:50:00.000Z`, assignedStaff: null, displayName: 'Ready Waiting Client', href: null, serviceLabel: 'Pedicure', source: 'walk_in', status: 'waiting' }];
  const html = render(dashboard);
  assert.match(html, /Ready Waiting Client/);
  assert.match(html, /Pedicure/);
  assert.match(html, /Waiting<!-- --> 10m|Waiting 10m/);
  assert.doesNotMatch(html, /Quiet right now|No appointments recorded|No upcoming appointments/);
});

test('real completed financial view reveals matching sales, staff money and turns together', () => {
  const dashboard = staffAndBookingsReady();
  const before = render(dashboard);
  dashboard.pendingSections = { sections: [], metrics: [], details: false };
  dashboard.summary.sales = { ...dashboard.summary.sales, value: '$98.75', detail: '2 closed tickets' };
  dashboard.summary.waiting.value = '0';
  dashboard.performance.sales = { total: 98.75, service: 88.5, tip: 10.25, ticketCount: 2, discount: 0, comparison: null };
  dashboard.performance.salesTrend = [{ afterHours: false, label: '9 AM', latest: true, service: 88.5, tip: 10.25, ticketCount: 2, total: 98.75 }];
  dashboard.performance.staffBars = [{ label: 'Visible Staff A', staffId: 'staff-a', value: 88.5 }];
  const after = render(dashboard);
  assert.doesNotMatch(before, /\$98\.75|\$88\.5|\$10\.25|3 large turns and 1 small turns/);
  assert.match(summary(after), /\$98\.75/);
  assert.match(after, /Total sales/);
  assert.match(after, /\$88\.5/);
  assert.match(after, /\$10\.25/);
  assert.match(after, /3 large turns and 1 small turns/);
  assert.doesNotMatch(after, /aria-label="Turns unavailable"|aria-label="Loading"/);
});

test('real view shows retry status only when the caller supplies retry, and reports actual section errors', () => {
  const dashboard = fixture();
  const normal = render(dashboard);
  assert.doesNotMatch(normal, /We couldn’t finish loading|Try again|Some Today sections could not load/);
  const retry = render(dashboard, { retry() {} });
  assert.match(retry, /We couldn’t finish loading/);
  assert.match(retry, /Try again/);
  assert.doesNotMatch(retry, /Some Today sections could not load/);
  dashboard.loadErrors = [{ area: 'bookings', section: 'bookings', message: 'Network unavailable' }];
  const failed = render(dashboard);
  assert.match(failed, /Some Today sections could not load/);
  assert.match(failed, /Network unavailable/);
  assert.doesNotMatch(failed, /We couldn’t finish loading|Try again/);
});
