import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';
import ts from 'typescript';

// Real SDK + real passive RPC callsites + existing request/owned-deadline code.
// Identity/membership is supplied at its already-verified client boundary.
// The injected backend implements fetch cancellation; no live network or data.
const codeCache = new Map();
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(a => { resolve = a; }); return { promise, resolve }; }
async function until(predicate, name) {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await tick(); }
  assert.fail('Fixture did not reach ' + name);
}
function load(file, dependencies = {}, globals = {}) {
  if (!codeCache.has(file)) codeCache.set(file, ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText);
  const bindings = { console: { warn() {}, error() {}, log() {} }, fetch() { throw Error('Uninjected HTTP forbidden'); }, ...globals };
  const exports = {};
  new Function('require', 'exports', ...Object.keys(bindings), codeCache.get(file))(name => {
    assert.ok(Object.hasOwn(dependencies, name), 'Unexpected dependency ' + name);
    return dependencies[name];
  }, exports, ...Object.values(bindings));
  return exports;
}
function fixture() {
  const labels = new AsyncLocalStorage();
  const reads = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const timers = new Map(), events = [], pending = new Map();
  let timerId = 0, mutationCompletions = 0, alreadyAbortedFetchCalls = 0;
  const bounded = load('lib/bounded-get.ts', {}, {
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms, label: labels.getStore() }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const auth = load('lib/supabase/auth-rest.ts', {
    '@/lib/bounded-get': bounded, '@/lib/read-context-scope': reads,
    '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, read) => read(), observeAppLocalCommandBackendStatus() {} },
    './auth-rejection': load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } }),
  }, { fetch: backend });
  const client = createClient('https://owned-rpc.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: auth.supabaseDeadlineFetch, headers: { Authorization: 'Bearer synthetic-already-verified-token' } },
  });
  const server = { createAuthenticatedSupabaseServerClient: async () => client };
  const clock = load('lib/salon-business-clock.ts', { 'server-only': {}, react: { cache: read => read }, '@/lib/supabase/server': server, '@/lib/read-context-scope': reads });
  const queue = load('lib/customer-visits.ts', { 'server-only': {}, '@/lib/supabase/postgrest-errors': { isMissingSupabaseColumnError: () => false }, '@/lib/read-context-scope': reads });
  const hours = load('lib/salon-business-hours.ts', {
    'server-only': {}, '@/lib/supabase/server': server,
    '@/lib/salon-operating-status-core': load('lib/salon-operating-status-core.ts'),
  });
  const sections = load('lib/today-dashboard-sections.ts');
  const today = load('lib/today-dashboard.ts', {
    'server-only': {}, '@/lib/read-context-scope': reads, '@/lib/salon-business-clock': clock,
    '@/lib/today-metric-assessment': load('lib/today-metric-assessment.ts', { './daily-pos-sales-comparison': load('lib/daily-pos-sales-comparison.ts') }),
    '@/lib/today-dashboard-sections': sections, '@/lib/app-notifications': {}, '@/lib/bookings': {},
    '@/lib/daily-pos-report': { DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' } },
    '@/lib/current-context': { isOwnerMembership: () => true }, '@/lib/salon-business-hours': hours,
    '@/lib/staff-workdays': {}, '@/lib/supabase/server': server, '@/lib/customer-visits': queue,
    '@/lib/today-quick-accesses': {}, '@/types/booking': {},
  });
  const context = { user: { id: 'synthetic-viewer' }, currentSalon: { id: 'synthetic-salon', name: 'Synthetic' }, currentMembership: {}, permissionCodes: ['*'] };
  async function backend(input, init = {}) {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://owned-rpc.invalid');
    assert.equal(init.method, 'POST');
    const name = url.pathname.replace('/rest/v1/rpc/', '');
    assert.ok(['get_salon_business_timezone', 'get_salon_business_date', 'get_customer_visit_queue', 'cancel_customer_visit'].includes(name));
    if (init.signal?.aborted) { alreadyAbortedFetchCalls++; throw init.signal.reason ?? new DOMException('Cancelled', 'AbortError'); }
    const label = labels.getStore(), gate = pending.get(label + ':' + name);
    const event = { label, name, signal: init.signal, aborted: false, completed: false };
    events.push(event);
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const cancel = () => { event.aborted = true; rejectAbort(init.signal.reason ?? new DOMException('Cancelled', 'AbortError')); };
    init.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (gate) await Promise.race([gate.promise, aborted]);
      if (init.signal?.aborted) throw init.signal.reason;
      event.completed = true;
      let value = [];
      if (name === 'get_salon_business_timezone') value = 'UTC';
      if (name === 'get_salon_business_date') value = '2026-10-21';
      if (name === 'cancel_customer_visit') { mutationCompletions++; value = { ok: true, status: 'cancelled', visitId: 'synthetic-visit' }; }
      return Response.json(value);
    } finally { init.signal?.removeEventListener('abort', cancel); }
  }
  function hold(label, name) { const gate = deferred(); pending.set(label + ':' + name, gate); return gate; }
  function run(label, read) {
    return labels.run(label, () => reads.runWithReadContext(() => bounded.runReadWithDeadline(signal => reads.runWithReadAbortSignal(signal, read), 12000)));
  }
  function expire(label) {
    const found = [...timers].find(([, value]) => value.label === label && value.ms === 12000);
    assert.ok(found, 'Existing owned12s timer must be active'); timers.delete(found[0]); found[1].callback();
  }
  return { reads, client, clock, queue, today, context, events, hold, run, expire, mutationCompletions: () => mutationCompletions, alreadyAbortedFetchCalls: () => alreadyAbortedFetchCalls };
}

for (const name of ['get_salon_business_timezone', 'get_salon_business_date', 'get_customer_visit_queue']) {
  test(`owned12s deadline cancels actual passive ${name} POST once and prevents its late completion`, async () => {
    const f = fixture(), gate = f.hold('read', name);
    const operation = name === 'get_salon_business_timezone' ? () => f.clock.getContextBusinessTimezone(f.context)
      : name === 'get_salon_business_date' ? () => f.today.getTodayDashboard(f.context, { phase: 'shell' })
      : () => f.queue.getCustomerVisitQueueForSalon({ salonId: 'synthetic-salon', supabase: f.client });
    const read = f.run('read', operation);
    await until(() => f.events.some(event => event.name === name), name);
    f.expire('read');
    await assert.rejects(read, error => error.status === 503 && error.kind === 'timeout');
    await tick();
    const event = f.events.find(event => event.name === name);
    try {
      assert.equal(event.aborted, true, 'The existing read deadline must reach the actual SDK request signal');
      assert.equal(event.completed, false);
    } finally { gate.resolve(); }
    await tick();
    assert.equal(event.completed, false, 'An ignored late backend release cannot finish the cancelled read');
    assert.equal(f.events.filter(event => event.name === name).length, 1, 'POST must not be retried');
  });
}

test('a cancelled passive queue request cannot cancel a different request scope or reuse its late reply', async () => {
  const f = fixture(), a = f.hold('A', 'get_customer_visit_queue'), b = f.hold('B', 'get_customer_visit_queue');
  const getQueue = () => f.queue.getCustomerVisitQueueForSalon({ salonId: 'synthetic-salon', supabase: f.client });
  const first = f.run('A', getQueue), second = f.run('B', getQueue);
  await until(() => f.events.length === 2, 'independent queue requests');
  f.expire('A');
  await assert.rejects(first, error => error.status === 503);
  await tick();
  const firstWire = f.events.find(event => event.label === 'A'), secondWire = f.events.find(event => event.label === 'B');
  try { assert.equal(firstWire.aborted, true); assert.equal(secondWire.aborted, false); }
  finally { a.resolve(); b.resolve(); }
  assert.deepEqual(await second, []);
  await tick();
  assert.equal(firstWire.completed, false); assert.equal(secondWire.completed, true);
  assert.equal(f.events.length, 2);
});

test('the adjacent actual mutation stays single-send and completes after a read scope abort without inheriting its signal', async () => {
  const f = fixture(), gate = f.hold('mutation', 'cancel_customer_visit');
  let mutation;
  const read = f.run('mutation', async () => {
    mutation = f.queue.cancelCustomerVisit({ visitId: 'synthetic-visit', supabase: f.client });
    return await mutation;
  });
  await until(() => f.events.length === 1, 'injected mutation POST');
  f.expire('mutation');
  await assert.rejects(read, error => error.status === 503);
  const event = f.events[0];
  assert.equal(event.name, 'cancel_customer_visit'); assert.equal(event.signal, undefined); assert.equal(event.aborted, false);
  gate.resolve();
  assert.equal((await mutation).ok, true);
  assert.equal(f.mutationCompletions(), 1); assert.equal(f.events.length, 1);
});
