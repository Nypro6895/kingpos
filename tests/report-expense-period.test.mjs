import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

function functions(file, names, deps = {}) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const source = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast).replace(/^export\s+/, '')).join('\n');
  for (const name of names) assert.match(source, new RegExp('function ' + name + '\\('));
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), code + ';return {' + names.join(',') + '}')(...Object.values(deps));
}
async function bundled(file) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const module = { exports: {} }; new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports); return module.exports;
}
const { staffPeriodAt } = await bundled('lib/staff-payroll-period.ts');
const { payrollRailChoices } = await bundled('lib/payroll-period-rail.ts');
const { reportExpensePeriodHref } = await bundled('lib/report-expense-period.ts');
const { ownerLocalHref, ownerLocalReadArgs } = await bundled('lib/owner-local-workspace.ts');
const { shopMoneyTotals } = await bundled('lib/shop-money.ts');
const { isDateInputValue } = functions('lib/daily-pos-report.ts', ['isDateInputValue']);
const periodFunctions = ['parseDateParts','dateOnlyFromUtcDate','dateFromDateOnly','addDays','firstDayOfMonth','lastDayOfMonth','getCurrentMonthPeriod','monthInputFromDate','parseMonthInput','getMonthPeriod','getSemiMonthlyPeriod','getPreviousMonthPeriod','getBiweeklyPeriods','formatDateForLabel','formatPeriodLabel','normalizePreset','assertDateRange','hasValidDateRange','resolvePayrollPeriod'];
function fixture({ cycle = 'biweekly', anchor = '2026-10-26', instant = '2026-11-03T18:00:00Z', role = 'OWNER', anonymous = false, wrongSalon = false, failure = false, noSetting = false } = {}) {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [instant])); } }
  const { resolvePayrollPeriod } = functions('lib/payroll.ts', periodFunctions, { DAY_MS: 86400000, isDateInputValue, Date: Clock });
  const calls = [], setting = { id: 'setting', salon_id: wrongSalon ? 'other' : 'salon', cycle_type: cycle, biweekly_anchor_date: anchor, created_at: '', updated_at: '' };
  const context = { user: anonymous ? null : { id: 'owner' }, currentSalon: { id: 'salon' }, currentMembership: { role_code: role } };
  const query = { select: value => { calls.push(['select', value]); return query; }, eq: (...args) => { calls.push(['eq', ...args]); return query; }, maybeSingle: async () => ({ data: noSetting ? null : setting, error: failure ? { message: 'unavailable' } : null }) };
  const { loadReportExpensePeriod } = functions('lib/report-expense-period-server.ts', ['loadReportExpensePeriod'], {
    isOwnerMembership: member => member?.role_code === 'OWNER', createAuthenticatedSupabaseServerClient: async () => ({ from: table => { calls.push(['from', table]); return query; } }),
    SALON_PAYROLL_SETTING_SELECT: 'id, salon_id, cycle_type, biweekly_anchor_date, created_at, updated_at', isDateInputValue, staffPeriodAt, resolvePayrollPeriod, payrollRailChoices, Date: Clock,
  });
  return { context, calls, setting, read: selected => loadReportExpensePeriod(context, 'America/Chicago', selected) };
}

for (const [name, options, current, previous] of [
  ['biweekly crossing month', {}, ['2026-10-26','2026-11-08'], ['2026-10-12','2026-10-25']],
  ['before anchor', { anchor: '2026-11-09' }, ['2026-10-26','2026-11-08'], ['2026-10-12','2026-10-25']],
  ['monthly', { cycle: 'monthly' }, ['2026-11-01','2026-11-30'], ['2026-10-01','2026-10-31']],
  ['semi-monthly first', { cycle: 'semi_monthly' }, ['2026-11-01','2026-11-15'], ['2026-10-16','2026-10-31']],
  ['semi-monthly second', { cycle: 'semi_monthly', instant: '2026-11-20T18:00:00Z' }, ['2026-11-16','2026-11-30'], ['2026-11-01','2026-11-15']],
  ['biweekly year boundary', { anchor: '2026-12-28', instant: '2027-01-03T18:00:00Z' }, ['2026-12-28','2027-01-10'], ['2026-12-14','2026-12-27']],
  ['monthly leap year', { cycle: 'monthly', instant: '2028-02-20T18:00:00Z' }, ['2028-02-01','2028-02-29'], ['2028-01-01','2028-01-31']],
  ['semi-monthly leap year', { cycle: 'semi_monthly', instant: '2028-02-20T18:00:00Z' }, ['2028-02-16','2028-02-29'], ['2028-02-01','2028-02-15']],
  ['business timezone midnight', { instant: '2026-11-01T03:00:00Z', cycle: 'monthly' }, ['2026-10-01','2026-10-31'], ['2026-09-01','2026-09-30']],
]) test(name + ': current and previous follow the configured Payroll schedule', async () => {
  const x = fixture(options), currentRead = await x.read();
  assert.deepEqual([currentRead.period.startDate,currentRead.period.endDate], current);
  const choices = currentRead.periods.length ? currentRead.periods : currentRead.months;
  const before = [...choices].reverse().find(c => c.period.endDate < currentRead.period.startDate);
  assert.deepEqual([before.period.startDate,before.period.endDate], previous);
  const previousRead = await x.read(before.period.startDate);
  assert.deepEqual([previousRead.period.startDate,previousRead.period.endDate], previous);
  assert.equal(currentRead.needsAnchor, false);
  assert.deepEqual((await x.read()).period, currentRead.period, 'Returning to default uses the canonical current period');
  if (options.cycle !== 'monthly') assert.deepEqual(currentRead.months, [], 'No calendar-month escape for configured short periods');
  assert.ok(x.calls.every(c => c[0] !== 'from' || c[1] === 'salon_payroll_settings'), 'No financial/payroll/history reads');
  assert.ok(x.calls.filter(c => c[0] === 'eq').every(c => c[1] === 'salon_id' && c[2] === 'salon'));
});

test('period selection normalizes to configured boundaries and invalid dates use current', async () => {
  const x = fixture();
  assert.equal((await x.read('2026-10-20')).period.startDate, '2026-10-12');
  assert.equal((await x.read(['2026-10-12','2026-11-09'])).period.startDate, '2026-10-12');
  for (const value of ['2026-02-31','2026-13-05','invalid']) assert.equal((await x.read(value)).period.startDate, '2026-10-26');
});
test('missing anchor cannot produce selectable monthly Expenses; missing schedule retains Payroll monthly default', async () => {
  const missing = await fixture({ anchor: null }).read();
  assert.equal(missing.needsAnchor, true); assert.deepEqual(missing.months, []); assert.deepEqual(missing.periods, []);
  assert.equal((await fixture({ noSetting: true }).read()).period.cycleType, 'monthly');
});
test('schedule metadata is owner-only and refuses mismatched salons or read failures', async () => {
  for (const options of [{ role: 'STAFF' }, { role: 'MANAGER' }, { anonymous: true }]) {
    const x = fixture(options); assert.equal(await x.read(), null); assert.deepEqual(x.calls, []);
  }
  await assert.rejects(fixture({ wrongSalon: true }).read(), /salon changed/);
  await assert.rejects(fixture({ failure: true }).read(), /unavailable/);
});
test('both report routes retain Closing filters and Expenses hash; native resource keys include period and exclude hash', async () => {
  const current = (await fixture().read()).period, previous = (await fixture().read('2026-10-12')).period;
  for (const pathname of ['/reports','/pos/report']) {
    const href = reportExpensePeriodHref(previous, pathname, 'date=2026-11-03&preset=custom&start=2026-11-03&end=2026-11-03');
    const url = new URL(href, 'https://reylumi.com');
    assert.equal(url.pathname, pathname); assert.equal(url.hash, '#expenses'); assert.equal(url.searchParams.get('date'), '2026-11-03');
    assert.equal(url.searchParams.get('start'), '2026-11-03'); assert.equal(url.searchParams.get('expensePeriodStart'), previous.startDate);
    const nativeHref = '/pos/report' + url.search;
    assert.ok(ownerLocalHref(nativeHref));
    assert.notDeepEqual(ownerLocalReadArgs(nativeHref), ownerLocalReadArgs(reportExpensePeriodHref(current, '/pos/report', url.search).split('#')[0]));
  }
  assert.equal(ownerLocalHref('/pos/report?expensePeriodStart=2026-10-12&unknown=1'), null);
});

test('native regular Reports admits only its existing view hashes and keeps route identity', () => {
  const Component = () => null;
  const { getAppLocalSecondaryPage } = functions('lib/app-local-secondary-registry.tsx', ['getAppLocalSecondaryPage'], {
    regularReadPaths: { '/reports':'/pos/report', '/bookings':'/pos/book', '/pos-tickets':'/pos/ticket' }, ownerLocalHref, RegularBusinessPage:Component,
    appLocalRouteAlias:()=>null, moreContent:{}, uuid:/^[a-f0-9-]{36}$/i,
  });
  for (const hash of ['#expenses','#overview','#daily-closing']) {
    const result=getAppLocalSecondaryPage('/reports?expensePeriodStart=2026-10-12'+hash);
    assert.equal(result.id,'business.regular:/reports'); assert.equal(result.Component,Component); assert.equal(result.requiresContext,true);
  }
  for (const path of ['/reports#unknown','/bookings#expenses','/payroll#expenses','/reports?secret=x#expenses']) assert.equal(getAppLocalSecondaryPage(path),null);
});

// Exercise the original read endpoint and original total calculation, with a synthetic read-only DB.
const api = await build({ entryPoints: ['app/api/shop-money/route.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['next/server'], plugins: [{ name: 'money-read-fixture', setup(b) {
  b.onResolve({ filter: /^@\// }, ({ path }) => ({ path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('current-context') ? 'export const getCurrentBusinessContext=async()=>globalThis.expenseFixture.context;export const isOwnerMembership=m=>m?.role_code==="OWNER";' : 'export const createAuthenticatedSupabaseServerClient=async()=>({rpc:async(name,args)=>globalThis.expenseFixture.read(name,args)});' }));
} }] });
const require = createRequire(import.meta.url), module = { exports: {} };
new Function('module','exports','require',api.outputFiles[0].text)(module,module.exports,require);
const { NextRequest } = require('next/server');
test('current/previous pass exact dates to existing Shop Money reader; list and total use that same range', async () => {
  const x = fixture(), calls = [], expenses = [{ id: 'before',business_date:'2026-10-20',category:'supplies',amount:40 },{ id:'current',business_date:'2026-11-01',category:'supplies',amount:100 }];
  globalThis.expenseFixture = { context: x.context, read: async (name,args) => {
    calls.push([name,args]); return { error:null,data:{ days:[],collections:[],gifts:[],redemptions:[],rewards:[],discounts:[],expenses:expenses.filter(e=>e.business_date>=args.p_start&&e.business_date<=args.p_end) } };
  } };
  for (const [selected,total,id] of [[undefined,100,'current'],['2026-10-12',40,'before']]) {
    const {period}=await x.read(selected), response=await module.exports.GET(new NextRequest('https://reylumi.com/api/shop-money?'+new URLSearchParams({salonId:'salon',start:period.startDate,end:period.endDate})));
    assert.equal(response.status,200); const data=await response.json();
    assert.deepEqual(data.expenses.map(e=>e.id),[id]); assert.equal(shopMoneyTotals(data,{cash:0,check:0,tax:0}).operating,total);
    assert.deepEqual(calls.at(-1),['shop_money_read',{p_salon:'salon',p_start:period.startDate,p_end:period.endDate}]);
  }
});
