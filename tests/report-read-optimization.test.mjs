import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, deps = {}, transform = source => source) {
  const exports = {};
  const source = transform(readFileSync(file, 'utf8'));
  const code = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in deps, `Unexpected dependency ${name}`);
    return deps[name];
  }, exports);
  return exports;
}

// Project nested PostgREST selections as well as filtering/ordering/limits. This
// ensures omitted joins cannot silently be supplied by an overpermissive mock.
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

function database(tables, { timeZone = 'UTC', businessDate = '2026-10-10', fail } = {}) {
  const reads = [];
  return {
    reads,
    async rpc(name) {
      return { data: name.includes('timezone') ? timeZone : businessDate, error: null };
    },
    from(table) {
      const query = { table, filters: [], selection: '', limit: Infinity };
      const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
      const builder = {
        select(selection) { query.selection = selection; return this; },
        eq(key, value) { query.filters.push(row => valueAt(row, key) === value); return this; },
        gte(key, value) { query.filters.push(row => valueAt(row, key) >= value); return this; },
        lte(key, value) { query.filters.push(row => valueAt(row, key) <= value); return this; },
        in(key, values) { query.filters.push(row => values.includes(valueAt(row, key))); return this; },
        order(key, options) { query.order = { key, ...options }; return this; },
        limit(count) { query.limit = count; return this; },
        returns() { return this; },
        maybeSingle() { query.single = true; return this; },
        then(resolve, reject) {
          reads.push(query);
          if (fail?.(query)) return Promise.resolve({ data: null, error: { message: 'fixture read failed' } }).then(resolve, reject);
          let rows = (tables[table] ?? []).filter(row => query.filters.every(filter => filter(row)));
          if (query.order) {
            const { key, ascending } = query.order;
            rows = [...rows].sort((left, right) => String(left[key]).localeCompare(String(right[key])) * (ascending ? 1 : -1));
          }
          rows = rows.slice(0, query.limit).map(row => selectFields(row, query.selection));
          query.bytes = JSON.stringify(rows).length;
          query.rowCount = rows.length;
          return Promise.resolve({ data: query.single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function reportModules(db, { legacy = false, denied = [], timeZone = 'UTC' } = {}) {
  const context = { user: { id: 'user' }, currentAccount: { id: 'account' }, currentSalon: { id: 'salon' } };
  const permissions = {
    hasPermission: async name => !denied.includes(name),
    requirePermission: async name => { if (denied.includes(name)) throw new Error(`Missing ${name}`); },
  };
  const common = {
    'server-only': {},
    '@/lib/current-context': { getCurrentBusinessContext: async () => context, isSalonManageContext: () => true },
    '@/lib/permissions': permissions,
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => db },
    '@/lib/pos-ticket-calculations': load('lib/pos-ticket-calculations.ts'),
    '@/lib/salon-business-clock': {
      getSalonBusinessTimezone: async () => timeZone,
      getContextBusinessTimezone: async () => timeZone,
      getContextBusinessDate: async () => '2026-10-10',
    },
  };
  const sales = load('lib/daily-pos-sales-comparison.ts');
  const hours = load('lib/salon-business-hours.ts', {
    'server-only': {},
    '@/lib/supabase/server': common['@/lib/supabase/server'],
    '@/lib/salon-operating-status-core': load('lib/salon-operating-status-core.ts'),
  });
  const daily = load('lib/daily-pos-report.ts', {
    ...common,
    '@/lib/bookings': { zonedDateTimeToUtcIso: ({ date, time }) => `${date}T${time}:00.000Z` },
    '@/lib/today-metric-assessment': load('lib/today-metric-assessment.ts', { './daily-pos-sales-comparison': sales }),
    '@/lib/daily-pos-sales-comparison': sales,
    '@/lib/salon-business-hours': hours,
    '@/lib/staff-workdays': { getTodayDate: () => '2026-10-10' },
  }, source => legacy ? source.replace('includeClosing: false,', 'includeClosing: true,') : source);
  const operational = load('lib/operational-report.ts', {
    ...common,
    '@/lib/daily-pos-report': daily,
    '@/types/booking': load('types/booking.ts'),
  }, source => {
    if (!legacy) return source;
    // The original full-facts loader remains the differential oracle. No copied
    // financial calculations are maintained in the test.
    const call = /loadComparisonFacts\(\{\r?\n\s+auth,/;
    assert.match(source, call);
    return source.replace(call, 'loadReportFacts({\n      includeDetails: false,\n      auth,');
  });
  return { ...operational, ...daily, context };
}

function ticket(id, openedAt, overrides = {}) {
  return {
    id, salon_id: 'salon', ticket_number: id, customer_id: 'customer-a',
    opened_at: openedAt, closed_at: openedAt, status: 'closed', discount_type: 'percentage',
    discount_value: 10, tax_rate: 5.5, tip_type: 'percentage', tip_value: 20,
    customer: { id: 'customer-a', name: 'Customer A', created_at: '2025-01-01T00:00:00.000Z' },
    payments: [{ amount: 20, payment_method: 'cash' }, { amount: -2, payment_method: 'gift_card' }],
    ticket_items: [
      { id: `${id}-a`, line_total: 99, quantity: 1, is_removed: false, service_id: 'service',
        service_name_snapshot: 'Nails', service_category_snapshot: 'Nails',
        assigned_staff_id: 'staff', assigned_staff: { id: 'staff', display_name: 'Staff' },
        service: { id: 'service', name: 'Nails', category: 'Nails' },
        turn_parts: [{ amount: 14.33, staff_id: 'staff', turn_index: 1, turn_type: 'small' },
          { amount: 20.12, staff_id: 'staff', turn_index: 2, turn_type: 'large' }] },
      { id: `${id}-removed`, line_total: 1000, quantity: 1, is_removed: true, turn_parts: [] },
      { id: `${id}-refund`, line_total: -1.25, quantity: 1, is_removed: false, turn_parts: [], assigned_staff_id: null },
    ],
    ...overrides,
  };
}

function fixtures() {
  return {
    pos_tickets: [
      ticket('current', '2026-10-10T12:00:00.000Z'),
      ticket('previous', '2026-10-09T12:00:00.000Z', { customer_id: 'customer-b', discount_type: 'fixed_amount', discount_value: 3, tip_type: 'fixed_amount', tip_value: 4 }),
      ticket('voided', '2026-10-09T13:00:00.000Z', { status: 'voided', customer_id: 'void-customer' }),
      ticket('open', '2026-10-09T14:00:00.000Z', { status: 'open' }),
      ticket('other-salon', '2026-10-10T12:00:00.000Z', { salon_id: 'other' }),
    ],
    bookings: [
      { id: 'one', salon_id: 'salon', customer_id: 'customer-a', start_at: '2026-10-10T10:00:00.000Z', status: 'completed' },
      { id: 'two', salon_id: 'salon', customer_id: 'customer-b', start_at: '2026-10-09T10:00:00.000Z', status: 'scheduled' },
      { id: 'three', salon_id: 'salon', customer_id: 'customer-c', start_at: '2026-10-09T11:00:00.000Z', status: 'cancelled' },
    ],
    customers: [
      { id: 'customer-a', location_id: 'salon', customer_user_id: 'linked', created_at: '2025-01-01T00:00:00.000Z' },
      { id: 'customer-b', location_id: 'salon', customer_user_id: null, created_at: '2026-10-09T10:00:00.000Z' },
      { id: 'customer-c', location_id: 'salon', customer_user_id: null, created_at: '2026-10-09T11:00:00.000Z' },
    ],
    pos_ticket_staff_earnings: [
      { salon_id: 'salon', staff_id: 'staff', ticket_id: 'current', work_date: '2026-10-10', service_total: 33.2, tip_amount: 4, total_earning: 37.2,
        big_turn_count: 1, small_turn_count: 1, staff: { id: 'staff', display_name: 'Staff' }, ticket: { id: 'current', status: 'closed' } },
      { salon_id: 'salon', staff_id: 'staff', ticket_id: 'previous', work_date: '2026-10-09', service_total: 33.2, tip_amount: 4, total_earning: 37.2,
        big_turn_count: 1, small_turn_count: 1, staff: { id: 'staff', display_name: 'Staff' }, ticket: { id: 'previous', status: 'closed' } },
    ],
    pos_daily_closings: [],
  };
}

async function compareOperational(tables, options = {}) {
  const oldDb = database(tables, options), newDb = database(tables, options);
  const previous = reportModules(oldDb, { ...options, legacy: true });
  const optimized = reportModules(newDb, options);
  const params = options.params ?? { date: '2026-10-10' };
  const before = await previous.getOperationalReport(params, previous.context);
  const after = await optimized.getOperationalReport(params, optimized.context);
  assert.deepEqual(after, before);
  return { before, after, oldDb, newDb };
}

test('operational report is identical while previous comparison omits unused staff/customer queries and joins', async () => {
  const { after, oldDb, newDb } = await compareOperational(fixtures());
  assert.equal(oldDb.reads.length - newDb.reads.length, 3);
  assert.equal(after.comparison.customerCount.previous, 2, 'bookings and finalized tickets share distinct customer IDs');
  assert.equal(after.comparison.ticketCount.previous, 1, 'open/voided rows do not contribute');
  const minimal = newDb.reads.find(row => row.table === 'pos_tickets' && !row.selection.includes('customer:'));
  const legacy = oldDb.reads.filter(row => row.table === 'pos_tickets')[1];
  assert.ok(minimal);
  assert.ok(minimal.bytes < legacy.bytes / 2, 'comparison response carries fewer nested records/fields');
  assert.equal(minimal.limit, 5000);
  assert.deepEqual(minimal.order, legacy.order);
});

test('empty periods, denied optional permissions, and timezone boundaries preserve the entire operational response', async () => {
  await compareOperational({});
  await compareOperational(fixtures(), { denied: ['customers.view', 'booking.view'] });
  const data = fixtures();
  data.pos_tickets.push(ticket('previous-local', '2026-10-10T03:59:59.999Z'));
  data.pos_tickets.push(ticket('current-local', '2026-10-10T04:00:00.000Z'));
  const { after } = await compareOperational(data, { timeZone: 'America/New_York' });
  assert.equal(after.comparison.ticketCount.previous, 2);
  assert.equal(after.totals.ticketCount, 2);
});

test('independent 5,000 source caps remain before closed-ticket filtering and keep truncation warnings', async () => {
  const data = fixtures();
  data.pos_tickets = [];
  data.bookings = [];
  for (const day of ['09', '10']) {
    for (let index = 0; index < 5002; index++) {
      const time = new Date(Date.UTC(2026, 9, Number(day), 0, 0, index)).toISOString();
      data.pos_tickets.push(ticket(`${day}-${index}`, time, { status: index === 0 ? 'open' : 'closed', customer_id: `customer-${index}` }));
      data.bookings.push({ id: `${day}-booking-${index}`, salon_id: 'salon', customer_id: `booking-${index}`, start_at: time, status: 'confirmed' });
    }
  }
  const { after, newDb } = await compareOperational(data);
  assert.equal(after.totals.ticketCount, 4999);
  assert.equal(after.comparison.ticketCount.previous, 4999);
  assert.equal(after.comparison.bookings.previous, 5000);
  assert.equal(after.comparison.customerCount.previous, 9999);
  assert.ok(after.dataGaps.some(gap => gap.includes('may not include every record')));
  assert.ok(newDb.reads.filter(row => ['pos_tickets', 'bookings'].includes(row.table)).every(row => row.limit === 5000 && row.rowCount === 5000));
});

test('report permissions still reject before any record query', async () => {
  const db = database(fixtures());
  const modules = reportModules(db, { denied: ['reports.view'] });
  await assert.rejects(modules.getOperationalReport({}, modules.context), /Missing reports.view/);
  assert.equal(db.reads.length, 0);
});

test('Today sales comparison keeps tickets/earnings calculations and removes exactly seven unused closing reads', async () => {
  const data = fixtures();
  for (let day = 3; day < 9; day++) {
    data.pos_tickets.push(ticket(`history-${day}`, `2026-10-0${day}T12:00:00.000Z`));
  }
  const oldDb = database(data), newDb = database(data);
  const before = reportModules(oldDb, { legacy: true }), after = reportModules(newDb);
  const input = { reportDate: '2026-10-10', timeZone: 'UTC' };
  const oldResult = await before.getDailyPosTodayFinancialData({ ...input, context: before.context });
  const newResult = await after.getDailyPosTodayFinancialData({ ...input, context: after.context });
  assert.deepEqual(newResult, oldResult);
  assert.ok(newResult.salesComparison);
  assert.equal(oldDb.reads.filter(row => row.table === 'pos_daily_closings').length, 8);
  assert.equal(newDb.reads.filter(row => row.table === 'pos_daily_closings').length, 1);
  assert.equal(oldDb.reads.filter(row => row.table === 'pos_ticket_staff_earnings').length, newDb.reads.filter(row => row.table === 'pos_ticket_staff_earnings').length);
});

test('same-time comparison retains the missing-close-time safeguard and full current closing read', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const data = { pos_tickets: [ticket('selected', `${date}T00:00:00.000Z`)], pos_daily_closings: [] };
  for (let day = 1; day <= 7; day++) {
    const previous = new Date(`${date}T00:00:00.000Z`);
    previous.setUTCDate(previous.getUTCDate() - day);
    data.pos_tickets.push(ticket(`history-${day}`, previous.toISOString(), { closed_at: day === 1 ? null : previous.toISOString() }));
  }
  const oldDb = database(data), newDb = database(data);
  const before = reportModules(oldDb, { legacy: true }), after = reportModules(newDb);
  const input = { reportDate: date, timeZone: 'UTC' };
  const oldResult = await before.getDailyPosTodayFinancialData({ ...input, context: before.context });
  const newResult = await after.getDailyPosTodayFinancialData({ ...input, context: after.context });
  assert.deepEqual(newResult, oldResult);
  assert.equal(newResult.salesComparison.status, 'insufficient_history');
  assert.equal(newDb.reads.filter(row => row.table === 'pos_daily_closings').length, 1);

  const failedDb = database(data, { fail: query => query.table === 'pos_daily_closings' });
  const failed = reportModules(failedDb);
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(failed.getDailyPosTodayFinancialData({ ...input, context: failed.context }), /fixture read failed/);
  } finally {
    console.error = originalError;
  }
});

test('successive report requests still read current authorized data without persistent private result reuse', async () => {
  const data = fixtures(), db = database(data), modules = reportModules(db);
  const first = await modules.getOperationalReport({ date: '2026-10-10' }, modules.context);
  data.pos_tickets[0].tip_value = 50;
  const second = await modules.getOperationalReport({ date: '2026-10-10' }, modules.context);
  assert.notEqual(first.totals.totalRevenue, second.totals.totalRevenue);
  assert.equal(db.reads.filter(row => row.table === 'pos_tickets').length, 4);
});
