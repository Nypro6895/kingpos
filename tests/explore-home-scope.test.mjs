import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { createHash } from 'node:crypto';

function load(file, deps = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', source)(name => { assert.ok(name in deps, name); return deps[name]; }, exports);
  return exports;
}
const { scopeExploreHomeContent } = load('lib/explore-home-scope.ts');
const home = () => ({ error: null, inspiration: { items: [], error: null, hasMore: false, nextCursor: null }, recommendedSalons: [{ id: 'PA' }], newSalons: [], popularServices: [{ category: 'Hair', salonCount: 1000 }] });
const response = (location, results = []) => ({ location, results, error: null, sections: { bestMatches: [], nearby: [], recommended: [] } });
const salon = (id, searchScope = 'A', resultGroup = 'bestMatches') => ({ id, searchScope, resultGroup, city: 'Milwaukee', state: 'WI', postalCode: '53222' });

test('chosen ZIP uses only canonical primary rows and never the global sample or broader references', () => {
  const input = home(), result = response('53222', [salon('local'), salon('nearby', 'B'), salon('outside', 'C'), salon('reference', 'A', 'reference'), salon('local')]);
  const scoped = scopeExploreHomeContent(input, result);
  assert.deepEqual(scoped.recommendedSalons.map(s => s.id), ['local']);
  assert.deepEqual(scoped.popularServices, []);
  assert.deepEqual(input.recommendedSalons, [{ id: 'PA' }]);
  assert.equal(result.results.length, 5);
});
test('empty, failed and legacy unclassified local searches never fall back globally', () => {
  for (const result of [response('00000'), { ...response('53222', [salon('old')]), error: 'Network error' }, response('53222', [salon('legacy', undefined)])]) {
    if (result.results[0]?.id === 'legacy') delete result.results[0].searchScope;
    assert.deepEqual(scopeExploreHomeContent(home(), result).recommendedSalons, []);
  }
});
test('late home extras and a changed ZIP cannot reintroduce the preceding region', () => {
  const old = scopeExploreHomeContent(home(), response('53222', [salon('WI')]));
  const next = scopeExploreHomeContent(old, response('10001', [salon('NY')]));
  assert.deepEqual(next.recommendedSalons.map(s => s.id), ['NY']);
  assert.deepEqual(scopeExploreHomeContent(home(), response('10001', [salon('NY')])).recommendedSalons, next.recommendedSalons);
});
test('Anywhere preserves the existing home content; city labels are not parsed against salon text', () => {
  const input = home();
  assert.equal(scopeExploreHomeContent(input, response('')), input);
  assert.deepEqual(scopeExploreHomeContent(input, response('Wauwatosa, Wisconsin', [salon('indexed')])).recommendedSalons.map(s => s.id), ['indexed']);
});
test('regional suggestions preserve authoritative booking, media and new-salon metadata', () => {
  const entry = { ...salon('local'), isNew: true, bookingEnabled: true, bookingHref: '/book/local', imageProvenance: 'salon_post' };
  const result = scopeExploreHomeContent(home(), response('53222', [entry])).recommendedSalons[0];
  for (const key of ['isNew', 'bookingEnabled', 'bookingHref', 'imageProvenance']) assert.equal(result[key], entry[key]);
});

async function render(params, selected = '53222', searchError = null) {
  const calls = [], gate = {};
  gate.promise = new Promise(done => { gate.resolve = done; });
  const current = { ...response(selected, [salon('local')]), error: searchError, target: 'salons', query: '', displayQuery: '', filters: {}, page: 1 };
  const jsx = (type, props) => ({ type, props });
  const api = load('app/(app)/explore/page.tsx', {
    '@/lib/explore-home-scope': { scopeExploreHomeContent },
    '@/lib/explore-comment-identity': { exploreCommentIdentity: () => null },
    '@/components/experience-page': { withExperiencePage: fn => fn },
    react: { Suspense: 'Suspense' }, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/app/explore/explore-startup-shell': { ExploreStartupShell: 'Shell' },
    '@/app/explore/explore-progressive-client': { ExploreProgressiveClient: 'Client' },
    '@/lib/explore-startup-feed-server': { prepareExploreStartupFeed: async () => null },
    '@/lib/bounded-get': { runReadWithDeadline: p => p },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => ({ user: null }) },
    '@/lib/explore-search': { EXPLORE_PAGE_SIZE: 12, getExploreWorkspaceLocation: async () => ({ label: selected, source: 'saved' }), searchExploreSalons: async input => { calls.push(input); return current; } },
    '@/lib/explore-feed': { emptyFeedPage: () => ({ items: [] }) },
    '@/lib/explore-query-routing': { resolveExploreQueryRouting: async () => ({ location: selected, locationOrigin: 'manual', locationSource: 'manual', scopePolicy: 'fixed', query: '', target: 'salons' }) },
    '@/lib/explore-home': { emptyHomeContent: home, getExploreHomeContent: async () => { calls.push('global'); return home(); } },
    '@/lib/explore-showcase-content': { enrichExploreShowcaseContent: x => x },
    'next/navigation': { redirect: () => assert.fail('unexpected redirect') },
    '@/lib/explore-page-resource-server': { stringParam: x => x, clean: x => x ?? '', parsePage: () => 1, buildQuickActions: async () => gate.promise, buildExploreDiscoveryContent: () => ({ shortcuts: [] }), getExploreUtilityContent: async () => ({}) },
  });
  const shell = await api.default({ searchParams: Promise.resolve(params) });
  const core = await shell.props.children.type(shell.props.children.props);
  const client = core.props.children;
  assert.equal(client.type, 'Client');
  assert.equal(calls.length, 1, 'one bounded search and no global home RPC');
  assert.equal(calls[0].pageSize, 4);
  assert.deepEqual(client.props.initial.homeContent.recommendedSalons.map(s => s.id), searchError ? [] : ['local']);
  let resolved = false;
  void client.props.extras.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, 'optional data remains independent of the initial view');
  gate.resolve([]);
  const extras = await client.props.extras;
  assert.deepEqual(extras.homeContent.recommendedSalons, client.props.initial.homeContent.recommendedSalons);
}
test('SSR ZIP browse reuses its bounded search without waiting on optional extras', () => render({ browse: '1', location: '53222' }));
test('SSR saved area also skips global sampling', () => render({}));
test('SSR failed scoped search preserves its error and does not substitute global suggestions', () => render({ browse: '1', location: '53222' }, '53222', 'Search unavailable'));

test('app-local core and deferred extras reuse regional search without global home reads', async () => {
  const file = 'lib/app-local-explore-server.ts', source = readFileSync(file, 'utf8');
  const deps = Object.fromEntries([...source.matchAll(/(?:from\s+|import\s+)["']([^"']+)["']/g)].map(match => [match[1], {}]));
  const calls = [], empty = () => ({ ...home(), recommendedSalons: [], popularServices: [] });
  Object.assign(deps, {
    './explore-home-scope': { scopeExploreHomeContent },
    './explore-filter-state': load('lib/explore-filter-state.ts', { '@/lib/explore-query-intent': load('lib/explore-query-intent.ts') }),
    'node:crypto': { createHash }, 'next/headers': { headers: async () => new Headers() },
    './post-hidden-server': { readHiddenPostIdentities: async () => [] },
    './read-context-scope': { memoizeReadValidation: (_key, _args, fn) => fn() },
    './request-business-context': { getRequestBusinessContext: async () => ({ user: null }) },
    './experience-context': { getExperienceContext: () => ({ scope: 'guest:test' }) },
    './explore-page-resource-server': { buildQuickActions: async () => [], buildExploreDiscoveryContent: () => ({ shortcuts: [] }), getExploreUtilityContent: async () => ({}) },
    './explore-search': { EXPLORE_PAGE_SIZE: 12, getExploreWorkspaceLocation: async () => ({ label: '53222', source: 'saved' }), emptyExploreSearchResponse: input => response(input.location), searchExploreSalons: async input => { calls.push(input); return response(input.location, [salon('local')]); } },
    './explore-feed': { emptyFeedPage: () => ({ items: [] }) },
    './explore-query-routing': { resolveExploreQueryRouting: async () => ({ location: '53222', locationOrigin: 'manual', locationSource: 'manual', scopePolicy: 'fixed', target: 'salons', query: '' }) },
    './explore-home': { emptyHomeContent: empty, getExploreHomeContent: async () => { calls.push('global'); return home(); } },
    './explore-showcase-content': { enrichExploreShowcaseContent: x => x },
    './explore-comment-identity': { exploreCommentIdentity: () => null },
    './bounded-get': { runReadWithDeadline: p => p },
    './app-local-explore-metadata': load('lib/app-local-explore-metadata.ts'),
  });
  const api = load(file, deps), options = { scope: 'guest:test' };
  const args = { query: 'browse=1&location=53222&locationSource=manual' };
  const core = await api.readAppLocalExploreResource('page.explore', args, options);
  const extras = await api.readAppLocalExploreResource('page.explore-extras', args, options);
  assert.deepEqual(core.data.homeContent.recommendedSalons.map(s => s.id), ['local']);
  assert.deepEqual(extras.data.homeContent.recommendedSalons, []);
  assert.equal(calls.length, 1);
  calls.length = 0;
  const pending = await api.readAppLocalExploreResource('page.explore', {}, options);
  assert.equal(pending.data.homeSearchPending, true);
  assert.equal(calls.length, 0, 'default app launch keeps search deferred');
  const deferred = await api.readAppLocalExploreResource('page.explore-extras', {}, options);
  assert.equal(calls.length, 1);
  assert.deepEqual(deferred.data.homeContent.recommendedSalons.map(s => s.id), ['local']);
  calls.length = 0;
  const filtered = await api.readAppLocalExploreResource('page.explore', { query: 'browse=1&location=53222&bookableOnly=true&maxPrice=45&color=pink' }, options);
  assert.equal(filtered.data.initialSearchMode, true);
  assert.deepEqual(calls[0].filters, { color: 'pink', maxPrice: 45, bookableOnly: true });
});
