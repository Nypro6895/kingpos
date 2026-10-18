import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === './read-request-metrics') return load('lib/read-request-metrics.ts');
    if (name === '@/lib/read-request-timing') return load('lib/read-request-timing.ts');
    assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name];
  }, exports);
  return exports;
}

test('calendar/configuration hints coalesce, IDs union and updates arriving during a read run afterwards', async () => {
  const { createWorkspaceRefreshQueue } = load('lib/workspace-refresh-queue.ts');
  const calls = []; let finish;
  const enqueue = createWorkspaceRefreshQueue(async (ids, configuration) => {
    calls.push({ ids, configuration });
    if (calls.length === 1) await new Promise(resolve => { finish = resolve; });
  }, 1);
  const first = enqueue(['a']); const joined = enqueue(['b']); const config = enqueue(undefined, true);
  assert.equal(first, joined); assert.equal(first, config);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 2));
  const second = enqueue(['c']); const duplicate = enqueue(['c', 'd']);
  finish(); await Promise.all([first, second, duplicate]);
  assert.deepEqual(calls, [{ ids: undefined, configuration: true }, { ids: ['c', 'd'], configuration: false }]);
});

test('temporary failures have a shared retry window, explicit retry bypasses it and account reset removes it', async () => {
  const { createExperienceResourceCache } = load('lib/experience-resource-cache.ts');
  let now = 1000, requests = 0;
  const cache = createExperienceResourceCache({ now: () => now });
  const context = { scope: 'salon-a', key: 'calendar?date=2026-10-18' };
  cache.seed(context, { count: 1 }, { freshForMs: 10 }); now += 11;
  const fail = async () => { requests++; throw new Error('offline'); };
  await assert.rejects(cache.load(context, fail));
  await assert.rejects(cache.load(context, fail));
  assert.equal(requests, 1);
  assert.deepEqual(cache.get(context).data, { count: 1 }, 'failed refresh retains last authorized snapshot');
  await assert.rejects(cache.load(context, fail, { force: true })); assert.equal(requests, 2);
  cache.reset('salon-a');
  await cache.load(context, async () => ({ data: { count: 2 } }));
  assert.equal(cache.get(context).data.count, 2);
});

test('conditional workspace reads preserve private HTTP policy and send no payload when unchanged', async () => {
  const { workspaceResourceResponse } = load('lib/workspace-resource-response.ts', { 'server-only': {}, 'node:crypto': await import('node:crypto') });
  const data = { salonId: 'one', workspace: { bookings: [{ id: 'booking', total: 25 }] } };
  const initial = workspaceResourceResponse(new Request('https://fixture.test/api'), data);
  const conditional = new Request('https://fixture.test/api', { headers: { 'If-None-Match': initial.headers.get('etag') } });
  const unchanged = workspaceResourceResponse(conditional, data);
  assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
  assert.match(unchanged.headers.get('cache-control'), /private, no-store/);
  assert.equal(workspaceResourceResponse(conditional, { ...data, salonId: 'other' }).status, 200);
});

test('oversize snapshots cannot start a subscriber/render loop', () => {
  const { createExperienceResourceCache } = load('lib/experience-resource-cache.ts');
  let now = 1000;
  const cache = createExperienceResourceCache({ maxBytes: 512, now: () => now });
  const context = { scope: 'one', key: 'large-report' };
  let updates = 0;
  cache.subscribe(context, () => updates++);
  for (let i = 0; i < 3; i++) assert.equal(cache.seed(context, { rows: 'x'.repeat(1000) }), false);
  assert.equal(updates, 0, 'a rejected seed is not a data update');
  cache.seed(context, { rows: [] }); assert.equal(updates, 1);
  now++;
  cache.seed(context, { rows: 'x'.repeat(1000) }); assert.equal(updates, 2, 'removing an older retained entry still notifies its subscriber once');
  cache.seed(context, { rows: 'x'.repeat(1000) }); assert.equal(updates, 2);
});

test('workspace endpoints reject old scope before querying records, including conditional requests', async () => {
  const current = { user: { id: 'one' }, currentSalon: { id: 'salon' } };
  let recordReads = 0;
  for (const file of ['app/api/pos/owner/bookings/route.ts', 'app/api/pos/owner/reports/route.ts']) {
    const { GET } = load(file, {
      'next/server': { NextResponse: Response }, 'next/headers': { headers: async () => new Headers() },
      '@/lib/current-context': { getCurrentBusinessContext: async () => current, isSalonManageContext: () => true },
      '@/lib/experience-context': { getExperienceContext: () => ({ scope: 'new-scope' }) },
      '@/lib/permissions': { hasPermission: async () => true },
      '@/lib/bookings': { BOOKING_PERMISSIONS: { view: 'bookings.view' }, getCurrentSalonBookingWorkspace: async () => { recordReads++; } },
      '@/lib/daily-pos-report': { getDailyPosReport: async () => { recordReads++; } },
      '@/lib/operational-report': {}, '@/lib/workspace-resource-response': {},
    });
    const response = await GET(new Request('https://fixture.test/api?scope=old-scope', { headers: { 'If-None-Match': 'old' } }));
    assert.equal(response.status, 409); assert.equal(recordReads, 0);
  }
});

test('progressive Salon Profile preserves publication requirements even when published photos are outside the loaded page', () => {
  const { getSalonProfileReadiness } = load('lib/salon-publication-readiness.ts');
  const common = { services: [{ is_active: true }], staff: [{ is_active: true }], setting: {
    business_name: 'Salon', phone: '4145550100', address_line1: '1 Main St', city: 'Milwaukee', state: 'WI', postal_code: '53202',
  } };
  const completeHistory = getSalonProfileReadiness({ ...common, looks: Array.from({ length: 3 }, () => ({ status: 'published' })) });
  const firstPageOnly = getSalonProfileReadiness({ ...common, looks: [], publishedLookCount: 3 });
  assert.deepEqual(firstPageOnly, completeHistory, 'publish and recommended photo conditions use the authorized total, not just the loaded page');
});

test('Salon Profile metadata and page request the same bounded resource so request memoization can share it', async () => {
  const calls = [];
  const data = { profile: { name: 'Salon', operatingStatus: { kind: 'open' } } };
  const page = load('app/(app)/explore/salons/[salonId]/page.tsx', {
    'react/jsx-runtime': await import('react/jsx-runtime'),
    '@/components/experience-page': { withExperiencePage: fn => fn },
    '@/app/salon-profile/salon-profile-view': { SalonProfileView: () => null },
    '@/lib/current-context': { getCurrentBusinessContext: async () => ({ user: null }), isSalonManageContext: () => false },
    '@/lib/salon-profile': { getPublicSalonProfileData: async (...key) => { calls.push(key); return data; } },
    'next/navigation': { notFound: () => { throw new Error('unexpected not found'); } },
  });
  const props = { params: Promise.resolve({ salonId: 'salon' }) };
  await page.generateMetadata(props); await page.default(props);
  assert.deepEqual(calls, [['salon', 0], ['salon', 0]]);
});

test('Salon Profile continuation rejects unavailable auth, old scopes and another salon before reading private posts', async () => {
  let unavailable = true, reads = 0, contextReads = 0;
  const context = { user: { id: 'owner' }, currentSalon: { id: '11111111-1111-4111-8111-111111111111' } };
  const { GET } = load('app/api/salon-profile/content/route.ts', {
    'next/server': { connection: async () => {} },
    'next/headers': { headers: async () => new Headers(unavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => { contextReads++; return context; } },
    '@/lib/experience-context': { getExperienceContext: () => ({ scope: 'current' }) },
    '@/lib/salon-profile': { isValidSalonProfileId: value => /^[a-f0-9-]{36}$/.test(value), getCurrentSalonProfileManageData: async () => { reads++; throw new Error('must not read'); } },
    '@/lib/salon-profile-preview': {}, '@/lib/salon-post-attribution': {}, '@/lib/salon-operating-status-core': {}, '@/lib/workspace-resource-response': {},
  });
  const request = (scope, salon = context.currentSalon.id) => new Request(`https://fixture.test/api/salon-profile/content?salonId=${salon}&page=1&managed=1&scope=${scope}`);
  assert.equal((await GET(request('current'))).status, 503); assert.equal(contextReads, 0);
  unavailable = false;
  assert.equal((await GET(request('old'))).status, 409);
  assert.equal((await GET(request('current', '22222222-2222-4222-8222-222222222222'))).status, 403);
  assert.equal(reads, 0);
});
