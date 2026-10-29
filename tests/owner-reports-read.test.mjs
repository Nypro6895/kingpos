import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function loadFunction(file, name, deps) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, name);
  const code = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(deps), code + ';return ' + name)(...Object.values(deps));
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  const calls = [], overview = deferred(), closing = deferred();
  const context = { user: { id: 'viewer' }, currentSalon: { id: 'salon', name: 'Test salon' } };
  const deps = {
    prepareOperationalReport: async (params, ctx) => {
      calls.push(['prepare', params, ctx]);
      if (options.denied) throw Object.assign(Error('denied'), { status: 403 });
      return { range: { endDate: '2026-10-28' }, load: () => { calls.push(['overview']); return overview.promise; } };
    },
    isDateInputValue: value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? ''),
    normalizeReportDate: async (date, ctx) => { calls.push(['normalize', date, ctx]); return date; },
    getDailyPosReport: (date, ctx) => { calls.push(['closing', date, ctx]); return closing.promise; },
    getDefaultReportDate: async ctx => { calls.push(['today', ctx]); return '2026-10-28'; },
    canEditDailyPosClosing: async ctx => { calls.push(['edit', ctx]); return true; },
    DAILY_POS_REPORT_PERMISSIONS: { requestCorrection: 'request-correction' },
    hasPermission: async (permission, ctx) => { calls.push(['permission', permission, ctx]); return false; },
    canApplyFinancialCorrections: async ctx => {
      calls.push(['apply', ctx]);
      if (options.permissionError) throw Error('permission unavailable');
      return false;
    },
  };
  return { calls, context, overview, closing, read: loadFunction('lib/owner-reports-read.ts', 'loadOwnerReportsRead', deps) };
}

test('Closing data starts while Overview is pending, with no earlier permission hints or partial DTO', async () => {
  const x = fixture(), params = { preset: 'month' };
  let released = false;
  const reading = x.read(params, x.context).then(value => { released = true; return value; });
  await tick();
  assert.deepEqual(x.calls.map(call => call[0]), ['prepare', 'overview', 'normalize', 'closing']);
  const report = { lock: { isLocked: false }, financials: { expectedTotal: 290 } };
  x.closing.resolve(report);
  await tick();
  assert.equal(released, false);
  const reportOverview = { range: { endDate: '2026-10-28' }, totals: { gross: 2060, net: 2045 } };
  x.overview.resolve(reportOverview);
  assert.deepEqual(await reading, {
    today: '2026-10-28', report, reportOverview, canEdit: true, canApplyCorrection: false, canRequestCorrection: false,
  });
  assert.equal(x.calls.filter(call => call[0] === 'closing').length, 1);
  assert.equal(x.calls.filter(call => call[0] === 'overview').length, 1);
  for (const call of x.calls.filter(call => ['prepare', 'normalize', 'closing', 'today', 'edit', 'permission', 'apply'].includes(call[0]))) {
    assert.equal(call.at(-1), x.context);
  }
});

for (const [input, expected] of [
  [{ date: '2026-10-27' }, '2026-10-27'],
  [{ date: ['2026-10-26', '2026-10-25'] }, '2026-10-26'],
  [{ date: 'invalid' }, '2026-10-28'],
]) test('Closing retains canonical date selection: ' + JSON.stringify(input), async () => {
  const x = fixture(), reading = x.read(input, x.context);
  await tick();
  assert.equal(x.calls.find(call => call[0] === 'closing')[1], expected);
  x.overview.resolve({}); x.closing.resolve({ lock: { isLocked: true } });
  assert.equal((await reading).canEdit, false);
});

test('Denied preparation never starts either data reader', async () => {
  const x = fixture({ denied: true });
  await assert.rejects(x.read({}, x.context), error => error.status === 403);
  assert.deepEqual(x.calls.map(call => call[0]), ['prepare']);
});

for (const failure of ['overview', 'closing']) test(failure + ' failure releases no DTO and safely observes the companion', async () => {
  const x = fixture(), reading = x.read({}, x.context);
  await tick();
  const rejected = assert.rejects(reading, /read failed/);
  x[failure].reject(Error('read failed'));
  await rejected;
  x[failure === 'overview' ? 'closing' : 'overview'].reject(Error('companion failed'));
  await tick();
});

test('Closing permission failure still fails the complete response', async () => {
  const x = fixture({ permissionError: true }), reading = x.read({}, x.context);
  x.overview.resolve({}); x.closing.resolve({ lock: { isLocked: false } });
  await assert.rejects(reading, /permission unavailable/);
});

test('Prepared Overview validates once and loads canonical facts once without exposing a mutable range', async () => {
  const calls = [], auth = { context: {} }, range = { endDate: '2026-10-28' }, facts = deferred();
  const prepare = loadFunction('lib/operational-report.ts', 'prepareOperationalReport', {
    requireOperationalReportContext: async context => { calls.push('auth'); assert.equal(context, auth.context); return auth; },
    getReportPermissions: async () => { calls.push('permissions'); return { canViewCustomers: false }; },
    loadBusinessClock: async () => { calls.push('clock'); return {}; },
    resolveReportRange: () => ({ range, dataGaps: [] }),
    loadOperationalReportFacts: (actualAuth, permissions, actualRange) => {
      calls.push('facts'); assert.equal(actualAuth, auth); assert.equal(actualRange, range);
      assert.equal(permissions.canViewCustomers, false); return facts.promise;
    },
  });
  const prepared = await prepare({}, auth.context);
  assert.deepEqual(calls, ['auth', 'permissions', 'clock']);
  assert.throws(() => { prepared.range.endDate = 'other'; }, TypeError);
  assert.equal(prepared.load(), prepared.load());
  const result = { canonical: true }; facts.resolve(result);
  assert.equal(await prepared.load(), result);
  assert.equal(calls.filter(call => call === 'facts').length, 1);
});

function transportFixture(options = {}) {
  const abort = new AbortController(), calls = [];
  const context = { user: { id: 'viewer' }, currentSalon: { id: 'salon', name: 'Test salon' }, currentAccount: {}, currentBusiness: {} };
  const reports = { reportOverview: { totals: { gross: 2060 } }, report: { lock: { isLocked: true } }, today: '2026-10-28', canEdit: false, canApplyCorrection: false, canRequestCorrection: false };
  const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
  const read = loadFunction('lib/app-local-owner-resources-server.ts', 'readAppLocalOwnerResource', {
    names: new Set(['owner.reports']), headers: async () => new Headers(), fail,
    getRequestBusinessContext: async () => options.anonymous ? { ...context, user: null } : context,
    isSalonManageContext: () => !options.notOwner,
    getExperienceContext: () => ({ scope: 'verified-scope' }), filters: () => ({ date: '2026-10-28' }),
    hasPermission: async () => !options.noPermission, DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' },
    loadOwnerReportsRead: async (query, actualContext) => {
      calls.push('load'); assert.equal(actualContext, context); assert.equal(query.date, '2026-10-28');
      if (options.abortAfterRead) abort.abort(Error('read cancelled'));
      return reports;
    },
    ownerReadEtag: () => 'etag', ownerStaffIds: () => undefined,
  });
  return { calls, read, reports, abort };
}

for (const [options, scope, status] of [
  [{ anonymous: true }, 'verified-scope', 401], [{ notOwner: true }, 'verified-scope', 403], [{}, 'wrong-scope', 409],
]) test('Owner reports transport denies before data read: ' + status, async () => {
  const x = transportFixture(options);
  await assert.rejects(x.read('owner.reports', {}, { scope }), error => error.status === status);
  assert.equal(x.calls.length, 0);
});

test('Report permission denial keeps the existing denied DTO and does not read reports', async () => {
  const x = transportFixture({ noPermission: true });
  const result = await x.read('owner.reports', {}, { scope: 'verified-scope' });
  assert.equal(result.data.view, 'denied'); assert.equal(x.calls.length, 0);
});

test('Successful transport retains complete scope-bound props and conditional read contract', async () => {
  const x = transportFixture();
  const result = await x.read('owner.reports', {}, { scope: 'verified-scope' });
  assert.equal(result.scope, 'verified-scope'); assert.equal(result.status, 200);
  assert.deepEqual(result.data, { view: 'reports', props: { viewerId: 'viewer', salonId: 'salon', salonName: 'Test salon', ...x.reports } });
  const unchanged = await x.read('owner.reports', {}, { scope: 'verified-scope', etag: 'etag' });
  assert.equal(unchanged.status, 304); assert.equal(unchanged.data, undefined);
});

test('Late abort still prevents the reordered report data from being released', async () => {
  const x = transportFixture({ abortAfterRead: true });
  await assert.rejects(x.read('owner.reports', {}, { scope: 'verified-scope', signal: x.abort.signal }), /read cancelled/);
});
