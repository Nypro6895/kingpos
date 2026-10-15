import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'process', 'window', source)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports, globals.process ?? { env: {} }, globals.window);
  return exports;
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const home = () => ({ error: null, recommendedSalons: [], newSalons: [], popularServices: [], inspiration: { items: [], error: null, hasMore: false, nextCursor: null } });
const feed = { items: [], error: null, hasMore: false, nextCursor: null };

test('Explore returns an interactive toolbar shell before search and renders its core without awaiting full home', async () => {
  const fullHome = deferred(), search = deferred(), calls = [];
  const response = { query: '', displayQuery: '', category: '', location: '', results: [], sections: { bestMatches: [], nearby: [], recommended: [] }, groupCounts: { bestMatches: 0, nearby: 0, recommended: 0 }, page: 1, pageSize: 4, error: null };
  const api = load('app/(app)/explore/page.tsx', {
    'react': { Suspense: 'Suspense' }, 'react/jsx-runtime': { Fragment: 'Fragment', jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    '@/components/experience-page': { withExperiencePage: Page => Page }, '@/app/explore/explore-startup-shell': { ExploreStartupShell: 'ToolbarShell' },
    '@/lib/bounded-get': { runReadWithDeadline: promise => promise },
    '@/app/explore/explore-progressive-client': { ExploreProgressiveClient: 'ProgressiveClient' }, '@/lib/explore-startup-feed-server': { prepareExploreStartupFeed: async () => null },
    '@/lib/explore-comment-identity': { exploreCommentIdentity: () => ({ name: 'Guest', role: 'personal', salonId: null }) },
  '@/lib/request-business-context': { getRequestBusinessContext: async () => ({ user: null }) },
    '@/lib/explore-search': { EXPLORE_PAGE_SIZE: 12, getExploreWorkspaceLocation: async () => ({ label: '', source: 'none' }), searchExploreSalons: () => { calls.push('search'); return search.promise; } },
    '@/lib/explore-query-routing': { resolveExploreQueryRouting: async () => ({ query: '', category: '', location: '', locationSource: 'none', locationOrigin: 'none', scopePolicy: 'expandable', target: 'salons' }) },
    '@/lib/explore-feed': { emptyFeedPage: () => feed }, '@/lib/explore-home': { emptyHomeContent: home, getExploreHomeContent: options => { calls.push(options?.initial ? 'first-home' : 'full-home'); return options?.initial ? Promise.resolve(home()) : fullHome.promise; } },
    '@/lib/explore-showcase-content': { enrichExploreShowcaseContent: value => value }, '@/lib/reylumi-trust': {}, '@/lib/routes': {}, '@/lib/search-normalization': {}, '@/lib/customer-bookings': {}, '@/lib/app-notifications': {}, '@/lib/permissions': {}, 'next/navigation': {},
  });
  const shell = await api.default({ searchParams: Promise.resolve({}) });
  assert.equal(shell.type, 'Suspense');
  assert.equal(shell.props.fallback.type, 'ToolbarShell');
  const corePromise = shell.props.children.type(shell.props.children.props);
  await Promise.resolve(); await Promise.resolve();
  assert.ok(calls.includes('full-home') && calls.includes('first-home'));
  search.resolve(response);
  const core = (await corePromise).props.children;
  assert.equal(core.type, 'ProgressiveClient');
  assert.equal(core.props.initial.initialResponse, response);
  let extrasReady = false;
  void core.props.extras.then(() => { extrasReady = true; });
  await Promise.resolve();
  assert.equal(extrasReady, false, 'optional data does not delay the first core');
  fullHome.resolve(home());
  await core.props.extras;
});

test('initial home keeps the same authorized prefix and canonical enrichment while skipping secondary collections', async () => {
  const calls = [], ids = ['one', 'two', 'three'];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    return { error: null, data: name === 'get_public_explore_home_salons' ? ids.map((id, index) => ({ salon_id: id, salon_name: id, section: 'recommended', home_rank: index, service_categories: [], service_names: [] })) : [] };
  };
  const api = load('lib/explore-home.ts', {
    'server-only': {}, '@/lib/default-nail-images': { resolveNailCoverImage: () => null },
    '@/lib/explore-decision-signals': { EMPTY_EXPLORE_DECISION_SIGNALS: {}, getExploreDecisionSignalsBySalonId: async (_rpc, ids) => { calls.push({ name: 'signals', ids }); return new Map(); } },
    '@/lib/explore-salon-logos': { loadPublicSalonLogoPaths: async ({ salonIds }) => { calls.push({ name: 'logos', ids: salonIds }); return new Map(); } },
    '@/lib/explore-inspiration': { getExploreInspirationPage: async () => { calls.push({ name: 'inspiration' }); return home().inspiration; } }, '@/lib/explore-search': {},
    '@/lib/salon-operating-status': { getPublicSalonOperatingStatusesBySalonId: async ids => { calls.push({ name: 'status', ids }); return new Map(); }, operatingStatusFromMap: () => null },
    '@/lib/salon-profile': { getSalonProfileMediaUrl: () => null }, '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => ({ rpc }), createSupabaseServerClient: () => null },
  });
  const first = await api.getExploreHomeContent({ initial: true });
  assert.deepEqual(first.recommendedSalons.map(salon => salon.id), ids);
  assert.deepEqual(calls[0].args, { p_new_limit: 0, p_recommended_limit: 3 });
  assert.deepEqual(calls.filter(call => ['signals', 'logos', 'status'].includes(call.name)).map(call => call.ids), [ids, ids, ids]);
  assert.equal(calls.some(call => call.name === 'inspiration' || call.name === 'get_public_explore_popular_services'), false);
});

test('startup feed only uses the verified viewer or existing guest cookie and never creates a guest identity during render', async () => {
  const calls = [], cookie = { value: '' };
  const api = load('lib/explore-startup-feed-server.ts', {
    'server-only': {}, 'node:crypto': { createHmac }, 'next/headers': { cookies: async () => ({ get: () => cookie }) },
    '@/lib/explore-social-feed': { getExploreSocialFeedPage: async args => { calls.push(args); return feed; } }, '@/lib/explore-visitor': { EXPLORE_VISITOR_COOKIE: 'guest' },
  }, { process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'test-only-secret' } } });
  assert.equal(await api.prepareExploreStartupFeed({ user: null }, {}), null);
  assert.equal(calls.length, 0);
  await api.prepareExploreStartupFeed({ user: { id: 'verified-user' } }, { location: 'WI' });
  assert.equal(calls[0].visitorKey, 'user:verified-user');
  assert.equal(calls[0].limit, 4);
  assert.deepEqual(calls[0].discovery, { location: 'WI' });
  cookie.value = '00000000-0000-4000-8000-000000000001';
  await api.prepareExploreStartupFeed({ user: null }, {});
  assert.equal(calls[1].visitorKey, `guest:${createHmac('sha256', 'test-only-secret').update(cookie.value).digest('hex')}`);
});

test('observed slow requests reduce prefetch without requiring the Network Information API', () => {
  const api = load('lib/explore-viewport-priority.ts', { react: {} });
  assert.deepEqual(api.explorePrefetchPolicy({ width: 390, loadMs: 2000 }), { distance: 140, limit: 4 });
  assert.deepEqual(api.explorePrefetchPolicy({ width: 390, loadMs: 2000, effectiveType: '4g' }), { distance: 140, limit: 4 });
  assert.deepEqual(api.explorePrefetchPolicy({ width: 390, loadMs: 250 }), { distance: 900, limit: 12 });
  assert.deepEqual(api.explorePrefetchPolicy({ width: 390, loadMs: 250, saveData: true }), { distance: 140, limit: 4 });
});
