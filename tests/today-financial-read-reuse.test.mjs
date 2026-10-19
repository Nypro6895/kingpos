import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import ts from 'typescript';

// Compare actual baseline financial code, rather than a reimplementation of
// accounting formulas. Every transport and identity below is synthetic.
const baselineCommit = '5b8b2b82d171f446385d9b2497a52137082d4dba';
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:lib/daily-pos-report.ts`], { encoding: 'utf8' });
const now = '2026-10-10T16:15:30.125Z';
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}
function load(file, deps = {}, source = readFileSync(file, 'utf8')) {
  const exports = {};
  const code = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'console', 'Date', code)(name => {
    assert.ok(name in deps, `Unexpected dependency ${name}`);
    return deps[name];
  }, exports, { error(...args) { if (process.env.FINANCIAL_FIXTURE_DEBUG) console.error(...args); }, warn() {}, log() {} }, FixtureDate);
  return exports;
}

const configNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const previousConfig = configNames.map(name => process.env[name]);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://read-reuse-fixture.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-fixture-key';
after(() => configNames.forEach((name, index) => {
  if (previousConfig[index] === undefined) delete process.env[name];
  else process.env[name] = previousConfig[index];
}));

function selectFields(value, selection) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(row => selectFields(row, selection));
  const fields = [];
  let depth = 0, start = 0;
  for (let i = 0; i <= selection.length; i++) {
    if (selection[i] === '(') depth++;
    if (selection[i] === ')') depth--;
    if (i === selection.length || (selection[i] === ',' && depth === 0)) {
      fields.push(selection.slice(start, i).trim()); start = i + 1;
    }
  }
  const result = {};
  for (const field of fields) {
    const paren = field.indexOf('(');
    if (paren < 0) result[field] = value[field];
    else {
      const key = field.slice(0, paren).split(':')[0];
      result[key] = selectFields(value[key], field.slice(paren + 1, -1));
    }
  }
  return result;
}

function database(tables, fail) {
  const reads = [], writes = [];
  return {
    reads, writes, tables,
    from(table) {
      const query = { table, filters: [], selection: '', limit: Infinity, operation: 'select' };
      const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
      const builder = {
        select(selection) { query.selection = selection; return this; },
        eq(key, value) { query.filters.push(['eq', key, value]); return this; },
        is(key, value) { query.filters.push(['eq', key, value]); return this; },
        gte(key, value) { query.filters.push(['gte', key, value]); return this; },
        lte(key, value) { query.filters.push(['lte', key, value]); return this; },
        in(key, value) { query.filters.push(['in', key, value]); return this; },
        not(key, operator, value) { assert.equal(operator, 'is'); query.filters.push(['not', key, value]); return this; },
        order(key, options) { query.order = { key, ...options }; return this; },
        limit(count) { query.limit = count; return this; },
        returns() { return this; },
        maybeSingle() { query.single = true; return this; },
        single() { query.single = true; return this; },
        insert(value) { query.operation = 'insert'; query.value = value; return this; },
        upsert(value, options) { query.operation = 'upsert'; query.value = value; query.options = options; return this; },
        update(value) { query.operation = 'update'; query.value = value; return this; },
        delete() { query.operation = 'delete'; return this; },
        then(resolve, reject) {
          (query.operation === 'select' ? reads : writes).push(query);
          return new Promise(done => setImmediate(done)).then(() => {
            if (fail?.(query)) return { data: null, error: { code: 'fixture', message: 'fixture read failed' } };
            const matches = row => query.filters.every(([op, key, value]) => {
              const actual = valueAt(row, key);
              return op === 'eq' ? actual === value : op === 'gte' ? actual >= value : op === 'lte' ? actual <= value : op === 'not' ? actual !== value : value.includes(actual);
            });
            let rows = (tables[table] ?? []).filter(matches);
            if (query.operation === 'insert' || query.operation === 'upsert') {
              rows = (Array.isArray(query.value) ? query.value : [query.value]).map((row, index) => ({ id: `${table}-insert-${index}`, ...row }));
              (tables[table] ??= []).push(...rows);
            } else if (query.operation === 'update') rows.forEach(row => Object.assign(row, query.value));
            else if (query.operation === 'delete') tables[table] = (tables[table] ?? []).filter(row => !matches(row));
            if (query.order) {
              const { key, ascending } = query.order;
              rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (ascending ? 1 : -1));
            }
            rows = rows.slice(0, query.limit).map(row => selectFields(row, query.selection));
            query.bytes = Buffer.byteLength(JSON.stringify(rows));
            query.rowCount = rows.length;
            return { data: query.single ? rows[0] ?? null : rows, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function fixture(tables = data(), options = {}) {
  const request = new AsyncLocalStorage();
  const db = database(structuredClone(tables), options.fail);
  const authCounts = { identity: 0, status: 0, session: 0, gates: 0 };
  const clients = [];
  const context = {
    user: { id: 'user' }, currentAccount: { id: 'account' }, currentSalon: { id: 'salon' },
    currentMembership: { id: 'membership', role_id: 'owner' }, currentWorkspace: { id: 'workspace' },
    permissionCodes: ['reports.view'], permissions: ['reports.view'], salonMode: 'manage',
  };
  const server = load('lib/supabase/server.ts', {
    'node:crypto': options.metadataFailure ? { createHash() { throw new Error('fixture hash unavailable'); } } : crypto,
    '@/lib/abuse-context': { safetyRequestHeaders: async () => request.getStore()?.safety ?? { 'x-safety-fixture': 'one' } },
    '@supabase/supabase-js': {
      createClient(_url, _key, clientOptions) {
        const client = {
          options: clientOptions,
          auth: { async getUser() { authCounts.identity++; return { data: { user: { id: 'auth-user' } }, error: null }; } },
          from(table) {
            if (table !== 'users' && table !== 'account_login_sessions') return db.from(table);
            let selection;
            const query = {
              select(value) { selection = value; return this; }, eq() { return this; },
              in(key, values) { return db.from(table).select(selection).in(key, values); },
              async maybeSingle() {
                const stage = table === 'users' ? 'status' : 'session'; authCounts[stage]++;
                const denied = options.revoked && stage === 'session';
                return { data: stage === 'status' ? { status: 'active' } : { revoked_at: denied ? now : null }, error: null };
              },
            };
            return query;
          },
        };
        clients.push(client); return client;
      },
    },
    '@/lib/account-security-shared': { ACCOUNT_LOGIN_SESSION_COOKIE: 'app-login-session', isAccountLoginSessionId: value => value?.startsWith('login-') },
    '@/lib/users/account-status': { isDeniedKingUserStatus: () => false },
    'next/headers': {
      headers: async () => new Headers(),
      cookies: async () => ({ get(name) {
        const state = request.getStore();
        const value = name === 'sb-access-token' ? state?.token : name === 'app-login-session' ? state?.session : undefined;
        return value ? { value } : undefined;
      } }),
    },
    './session-policy': { ADMIN_SESSION_COOKIE: 'admin', REMEMBER_LOGIN_COOKIE: 'remember', sessionCookieOptions() {} },
    './auth-rest': { supabaseDeadlineFetch() { throw new Error('Real transport forbidden'); }, assertAuthAvailable() {}, AuthAvailabilityError: class extends Error {} },
    '@/lib/read-context-scope': { coalesceReadInFlight: (_key, _authority, read) => read() },
  });
  const authServer = options.unknownClient ? {
    ...server,
    createAuthenticatedSupabaseServerClient: async () => ({ from: db.from }),
  } : server;
  const permissions = {
    hasPermission: async () => !options.denied,
    requirePermission: async () => { authCounts.gates++; if (options.denied) throw new Error('fixture denied'); },
  };
  const timeZone = options.timeZone ?? 'UTC';
  const sales = load('lib/daily-pos-sales-comparison.ts');
  const hours = load('lib/salon-business-hours.ts', {
    'server-only': {}, '@/lib/supabase/server': authServer,
    '@/lib/salon-operating-status-core': load('lib/salon-operating-status-core.ts'),
  });
  // Use the production timezone conversion for both historical and new code.
  // Import only this independent function from the actual bookings module.
  const bookingsSource = readFileSync('lib/bookings.ts', 'utf8');
  const parts = ['function isIsoDate', 'function timeZoneParts', 'function timeZoneOffsetMs', 'export function zonedDateTimeToUtcIso'].map(start => {
    const offset = bookingsSource.indexOf(`${start}(`);
    assert.ok(offset >= 0, `actual timezone helper ${start} must remain extractable`);
    const body = bookingsSource.slice(offset).match(/^[\s\S]*?\r?\n}\r?\n/);
    assert.ok(body, `actual timezone helper ${start} body must remain extractable`);
    return body[0];
  });
  const bookings = load('lib/bookings.ts', {}, parts.join('\n'));
  const daily = load('lib/daily-pos-report.ts', {
    'server-only': {},
    '@/lib/current-context': { getCurrentBusinessContext: async () => context, isSalonManageContext: () => true },
    '@/lib/permissions': permissions,
    '@/lib/supabase/server': authServer,
    '@/lib/pos-ticket-calculations': load('lib/pos-ticket-calculations.ts'),
    '@/lib/salon-business-clock': { getContextBusinessTimezone: async () => timeZone, getContextBusinessDate: async () => options.businessDate ?? '2026-10-10' },
    '@/lib/bookings': bookings,
    '@/lib/today-metric-assessment': load('lib/today-metric-assessment.ts', { './daily-pos-sales-comparison': sales }),
    '@/lib/daily-pos-sales-comparison': sales,
    '@/lib/salon-business-hours': hours,
    '@/lib/staff-workdays': { getTodayDate: () => '2026-10-10' },
  }, options.baseline ? baselineSource : undefined);
  const withRequest = (read, state = {}) => request.run({ token: 'fixture-token-one', session: 'login-one', ...state }, read);
  const readBoth = (readContext, overrideContext = context, date = options.date ?? '2026-10-10', states = [{}, {}]) => Promise.all([
    withRequest(() => daily.getDailyPosReport(date, overrideContext, readContext), states[0]),
    withRequest(() => daily.getDailyPosTodayFinancialData({ context: overrideContext, reportDate: date, timeZone, businessHours: options.businessHours, readContext }), states[1]),
  ]);
  return { ...daily, context, db, authCounts, clients, server, withRequest, readBoth };
}

function ticket(id, day = '2026-10-10', extra = {}) {
  return {
    id, salon_id: 'salon', opened_at: `${day}T12:00:00.000Z`, closed_at: `${day}T12:30:00.000Z`, status: 'closed',
    discount_type: 'percentage', discount_value: 7.25, tax_rate: 8.5, tip_type: 'percentage', tip_value: 18,
    payments: [{ payment_method: 'gift_card', amount: -3.15 }, { payment_method: 'credit_card', amount: 51.77 }],
    ticket_items: [
      { id: `${id}-one`, assigned_staff_id: 'staff', assigned_staff: { id: 'staff', display_name: 'Z Fixture' }, quantity: 2, line_total: 90, is_removed: false,
        turn_parts: [{ amount: 14.335, staff_id: 'staff', turn_index: 1, turn_type: 'small' }, { amount: 20.125, staff_id: 'staff', turn_index: 2, turn_type: 'large' }] },
      { id: `${id}-refund`, assigned_staff_id: 'staff', assigned_staff: { id: 'staff', display_name: 'Z Fixture' }, quantity: 1, line_total: -1.25, is_removed: false, turn_parts: [] },
      { id: `${id}-removed`, assigned_staff_id: 'staff', quantity: 1, line_total: 999, is_removed: true },
    ], ...extra,
  };
}
function data() {
  const tickets = Array.from({ length: 8 }, (_, index) => ticket(`ticket-${index}`, `2026-10-${String(10 - index).padStart(2, '0')}`));
  return {
    pos_tickets: [...tickets, ticket('open', undefined, { status: 'open' }), ticket('void', undefined, { status: 'voided' }), ticket('foreign', undefined, { salon_id: 'foreign' })],
    pos_ticket_staff_earnings: tickets.map(row => ({ salon_id: 'salon', ticket_id: row.id, work_date: row.opened_at.slice(0, 10), staff_id: 'staff', service_total: 33.2, tip_amount: 4.51,
      big_turn_count: 1, small_turn_count: 1, staff: { id: 'staff', display_name: 'Z Fixture' } })),
    pos_daily_closings: [{ id: 'closing', salon_id: 'salon', report_date: '2026-10-10', cash_amount: 20, credit_card_amount: 22, other_amount: 1, note: 'Fixture', status: 'draft' }],
  };
}
const count = (f, table) => f.db.reads.filter(row => row.table === table).length;
const signature = query => ({ table: query.table, filters: query.filters, order: query.order, limit: query.limit });
async function parity(tables = data(), options = {}) {
  const before = fixture(tables, { ...options, baseline: true }), after = fixture(tables, options);
  const expected = await before.readBoth();
  const actual = await after.readBoth(after.createDailyPosReadContext(after.context));
  assert.deepEqual(actual, expected);
  assert.deepEqual(after.db.writes, before.db.writes, 'snapshot/lock writes remain identical');
  return { before, after, actual };
}

test('actual baseline DTOs match while distinct authenticated clients join exactly three pending current-day SELECTs', async t => {
  const { before, after, actual } = await parity();
  assert.equal(before.db.reads.length - after.db.reads.length, 3);
  assert.equal(count(before, 'pos_daily_closings'), 2); assert.equal(count(after, 'pos_daily_closings'), 1);
  assert.equal(count(before, 'pos_tickets'), 9); assert.equal(count(after, 'pos_tickets'), 8);
  assert.equal(count(before, 'pos_ticket_staff_earnings'), 9); assert.equal(count(after, 'pos_ticket_staff_earnings'), 8);
  assert.deepEqual(after.authCounts, before.authCounts, 'each public caller still independently checks admission');
  const gated = after.clients.filter(client => after.server.getAuthenticatedReadAuthority(client));
  assert.equal(gated.length, 2); assert.notEqual(gated[0], gated[1]);
  assert.equal(after.server.getAuthenticatedReadAuthority(gated[0]), after.server.getAuthenticatedReadAuthority(gated[1]));
  assert.ok(actual[1].salesComparison);
  const historical = after.db.reads.filter(row => row.table === 'pos_tickets' && !row.selection.includes('payments:'));
  assert.equal(historical.length, 7);
  const beforeHistorical = before.db.reads.filter(row => row.table === 'pos_tickets').slice(2);
  assert.deepEqual(historical.map(signature), beforeHistorical.map(signature));
  assert.ok(historical.reduce((sum, q) => sum + q.bytes, 0) < beforeHistorical.reduce((sum, q) => sum + q.bytes, 0));
  assert.ok(historical.every(q => !q.selection.includes('assigned_staff:') && q.selection.includes('tax_rate')));
  t.diagnostic(JSON.stringify({ synthetic: true, baselineCommit, beforeReads: before.db.reads.length, afterReads: after.db.reads.length,
    historicalTicketBytesBefore: beforeHistorical.reduce((sum, q) => sum + q.bytes, 0),
    historicalTicketBytesAfter: historical.reduce((sum, q) => sum + q.bytes, 0),
    independentAuthIdentityBefore: before.authCounts.identity, independentAuthIdentityAfter: after.authCounts.identity }));
});

test('fallback item turns, percentage tips after tax, refunds, removed/open/void rows, and empty periods preserve results', async () => {
  const tables = data(); tables.pos_ticket_staff_earnings = [];
  const { actual } = await parity(tables);
  assert.equal(actual[1].staffAttributionSource, 'pos_ticket_items');
  assert.ok(actual[0].totals.totalTax > 0); assert.ok(actual[0].totals.totalTip > 0);
  const empty = await parity({});
  assert.equal(empty.actual[0].totals.expectedTotal, 0);
  assert.equal(empty.before.db.reads.length - empty.after.db.reads.length, 2);
});

test('timezone/DST midnight bounds and independent business-hour activity windows remain identical', async () => {
  const tables = data(); tables.pos_tickets = [
    ticket('outside', '2026-03-08', { opened_at: '2026-03-08T05:59:59.999Z' }),
    ticket('start', '2026-03-08', { opened_at: '2026-03-08T06:00:00.000Z', closed_at: '2026-03-08T07:20:00.000Z' }),
    ticket('last', '2026-03-09', { opened_at: '2026-03-09T04:59:59.999Z', closed_at: '2026-03-09T04:59:59.999Z' }),
    ticket('next', '2026-03-09', { opened_at: '2026-03-09T05:00:00.000Z' }),
  ]; tables.pos_ticket_staff_earnings = []; tables.pos_daily_closings = [];
  const { after, actual } = await parity(tables, { date: '2026-03-08', businessDate: '2026-03-08', timeZone: 'America/Chicago', businessHours: {
    buckets: [{ hour: 8, index: 0, label: '8 AM' }, { hour: 9, index: 1, label: '9 AM' }], opensAtLocal: '08:00', closesAtLocal: '09:00',
    date: '2026-03-08', timeZone: 'America/Chicago', isClosed: false, isFallback: false, spansOvernight: false, source: 'staff_availability_rules', fallbackReason: null,
  } });
  assert.equal(actual[0].metadata.finalizedTicketCount, 2);
  const current = after.db.reads.find(row => row.table === 'pos_tickets');
  assert.deepEqual(current.filters.slice(1), [['gte', 'opened_at', '2026-03-08T06:00:00.000Z'], ['lte', 'opened_at', '2026-03-09T04:59:59.999Z']]);
});

test('same-time missing closed_at guard and historical comparison failure fallback remain unchanged', async () => {
  const tables = data(); tables.pos_tickets[1].closed_at = null;
  const { actual } = await parity(tables);
  assert.equal(actual[1].salesComparison.status, 'insufficient_history');
  const failed = await parity(data(), { fail: q => q.table === 'pos_tickets' && q.filters.some(([op, key, value]) => op === 'gte' && key === 'opened_at' && value.startsWith('2026-10-09')) });
  assert.equal(failed.actual[1].salesComparison, null);
});

test('locked snapshots/corrections stay authoritative and a missing historical snapshot preserves exact writes', async () => {
  const tables = data();
  Object.assign(tables.pos_daily_closings[0], { status: 'locked', locked_at: now, snapshot_created_at: now,
    actual_total_snapshot: 101, expected_total_snapshot: 100, difference_snapshot: 1, staff_earned_snapshot: 90, tip_snapshot: 10,
    discount_snapshot: 0, gift_card_snapshot: 0, cash_amount_snapshot: 20, credit_card_amount_snapshot: 80, other_amount_snapshot: 1,
    ticket_count_snapshot: 4, finalized_ticket_count_snapshot: 3, note_snapshot: 'Locked fixture' });
  tables.pos_daily_closing_staff_snapshots = [{ id: 'snapshot', salon_id: 'salon', closing_id: 'closing', staff_id: 'staff', staff_name_snapshot: 'Historical name', total_earned_snapshot: 90,
    tip_snapshot: 10, big_turn_count_snapshot: 2, small_turn_count_snapshot: 1, total_turns_snapshot: 3 }];
  tables.pos_financial_adjustments = [{ id: 'adjustment', salon_id: 'salon', business_date: '2026-10-10', staff_id: 'staff', actual_total_delta: 2, expected_total_delta: 3,
    cash_delta: 2, credit_card_delta: 0, other_delta: 0, service_delta: 3, tip_delta: 1, discount_delta: 0, gift_card_delta: 0, turn_delta: .5, created_at: now, created_by: 'actor', note: 'Fixture correction' }];
  tables.users = [{ id: 'actor', display_name: 'Fixture actor', email: 'fixture@example.invalid' }];
  const locked = await parity(tables);
  assert.equal(locked.actual[0].staffRows[0].staffName, 'Historical name');
  const missing = await parity(data(), { businessDate: '2026-10-11' });
  assert.ok(missing.after.db.writes.length > 0, 'existing historical lock/snapshot behavior remains exercised');
});

test('different tokens, session cookies, safety headers, or unknown clients never join raw reads', async () => {
  for (const [options, states] of [
    [{}, [{ token: 'one' }, { token: 'two' }]],
    [{}, [{ session: 'login-one' }, { session: 'login-two' }]],
    [{}, [{ safety: { 'x-safety-fixture': 'one' } }, { safety: { 'x-safety-fixture': 'two' } }]],
    [{ unknownClient: true }, [{}, {}]],
    [{ metadataFailure: true }, [{}, {}]],
  ]) {
    const f = fixture(data(), options);
    await f.readBoth(f.createDailyPosReadContext(f.context), f.context, '2026-10-10', states);
    assert.equal(count(f, 'pos_daily_closings'), 2);
    assert.equal(count(f, 'pos_tickets'), 9);
  }
});

test('foreign or changed context cannot reuse the collector; denials and revoked sessions fail before record reads', async () => {
  for (const foreign of [false, true]) {
    const f = fixture(), collector = f.createDailyPosReadContext(f.context);
    const context = foreign ? structuredClone(f.context) : f.context;
    if (!foreign) context.permissions.push('changed');
    await f.readBoth(collector, context);
    assert.equal(count(f, 'pos_daily_closings'), 2);
  }
  for (const options of [{ denied: true }, { revoked: true }]) {
    const f = fixture(data(), options);
    const result = await Promise.allSettled([f.readBoth(f.createDailyPosReadContext(f.context))]);
    assert.equal(result[0].status, 'rejected'); assert.equal(f.db.reads.length, 0);
  }
});

test('settled or failed SELECTs are discarded, so later authorized reads observe mutations and retry the actual read', async () => {
  const f = fixture(), collector = f.createDailyPosReadContext(f.context);
  const first = await f.readBoth(collector);
  f.db.tables.pos_tickets[0].tip_value = 71;
  const second = await f.readBoth(collector);
  assert.notEqual(second[0].totals.expectedTotal, first[0].totals.expectedTotal);
  assert.equal(count(f, 'pos_daily_closings'), 2);
  assert.equal(count(f, 'pos_tickets'), 16);
  for (const table of ['pos_daily_closings', 'pos_tickets', 'pos_ticket_staff_earnings']) {
    const before = fixture(data(), { baseline: true, fail: q => q.table === table });
    const after = fixture(data(), { fail: q => q.table === table });
    const oldResult = await Promise.allSettled([before.readBoth()]);
    const newResult = await Promise.allSettled([after.readBoth(after.createDailyPosReadContext(after.context))]);
    assert.equal(oldResult[0].status, 'rejected'); assert.equal(newResult[0].status, 'rejected');
    assert.equal(newResult[0].reason.message, oldResult[0].reason.message);
  }
});

test('authority metadata exists only for gated clients, contains no credential text, and remains stable for header insertion order', async () => {
  const f = fixture();
  assert.equal(f.server.getAuthenticatedReadAuthority(f.server.createSupabaseServerClient()), undefined);
  assert.equal(f.server.getAuthenticatedReadAuthority(f.server.createUserScopedSupabaseServerClient('fixture-token-one')), undefined);
  const first = await f.withRequest(() => f.server.createAuthenticatedSupabaseServerClient(), { safety: { 'x-one': '1', 'x-two': '2' } });
  const second = await f.withRequest(() => f.server.createAuthenticatedSupabaseServerClient(), { safety: { 'x-two': '2', 'x-one': '1' } });
  const authority = f.server.getAuthenticatedReadAuthority(first);
  assert.match(authority, /^[a-f0-9]{64}$/);
  assert.equal(f.server.getAuthenticatedReadAuthority(second), authority);
  assert.ok(!authority.includes('fixture-token-one'));
  assert.equal(f.authCounts.identity, 2, 'metadata does not skip subsequent admission');
});

test('a failed pending raw SELECT clears before a later successful read in the same explicit collector', async () => {
  let failing = true;
  const f = fixture(data(), { fail: q => failing && q.table === 'pos_daily_closings' });
  const collector = f.createDailyPosReadContext(f.context);
  const read = () => Promise.allSettled([
    f.withRequest(() => f.getDailyPosReport('2026-10-10', f.context, collector)),
    f.withRequest(() => f.getDailyPosTodayFinancialData({ context: f.context, reportDate: '2026-10-10', timeZone: 'UTC', readContext: collector })),
  ]);
  const failed = await read();
  assert.ok(failed.every(result => result.status === 'rejected' && result.reason.message === 'fixture read failed'));
  failing = false;
  const recovered = await read();
  assert.ok(recovered.every(result => result.status === 'fulfilled'));
  assert.equal(count(f, 'pos_daily_closings'), 2, 'failure result was discarded and retried once by the two joined consumers');
});
