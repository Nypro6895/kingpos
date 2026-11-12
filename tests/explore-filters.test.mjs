import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, deps = {}) {
  const exports = {}, source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', source)(name => { assert.ok(name in deps, name); return deps[name]; }, exports);
  return exports;
}
const intent = load('lib/explore-query-intent.ts');
const api = load('lib/explore-filter-state.ts', { '@/lib/explore-query-intent': intent });
test('apply replaces filters and pagination while retaining ZIP, query, source, scope and sort', () => {
  const previous = new URLSearchParams('q=red+nails&location=53222&locationSource=manual&scope=fixed&sort=trusted&color=blue&page=5&cursor=old&browse=1');
  const next = api.exploreFilterParams(previous, 'Nails', { color: 'pink', maxPrice: 45, bookableOnly: true });
  for (const key of ['q', 'location', 'locationSource', 'scope', 'sort']) assert.equal(next.get(key), previous.get(key));
  for (const key of ['page', 'cursor', 'browse']) assert.equal(next.has(key), false);
  assert.deepEqual(api.readExploreFilterParams(next), { color: 'pink', maxPrice: 45, bookableOnly: true });
  assert.equal(previous.get('color'), 'blue');
});
test('clear removes all selected filters without disabling GPS or dropping the typed query', () => {
  const input = new URLSearchParams('q=pedicure&location=Milwaukee&locationSource=gps&scope=expandable&sort=closest&category=Nails&bookableOnly=true&shape=almond&maxPrice=30');
  const next = api.exploreFilterParams(input, 'All', {});
  assert.deepEqual(api.readExploreFilterParams(next), {});
  for (const key of ['q', 'location', 'locationSource', 'scope', 'sort']) assert.equal(next.get(key), input.get(key));
  assert.equal(next.get('category'), 'All');
});
test('URL round trips preserve style, numeric zero and true-only switches without unsafe values', () => {
  assert.deepEqual(api.readExploreFilterParams(new URLSearchParams('maxPrice=0&bookableOnly=false&shape=ALMOND&color=Pink&newOnly=true')), { shape: 'almond', color: 'pink', maxPrice: 0, newOnly: true });
  for (const value of ['', ' ', '-1', 'Infinity', 'NaN', '100001']) assert.deepEqual(api.readExploreFilterParams(new URLSearchParams({ maxPrice: value })), {});
  assert.equal(api.exploreFilterCount('All', {}), 0);
  assert.equal(api.exploreFilterCount('Nails', { maxPrice: 0, bookableOnly: true }), 3);
});
test('app-local allowlist accepts only declared filter keys and retains unrelated query restrictions', () => {
  const { APP_LOCAL_EXPLORE_QUERY_KEYS } = load('lib/app-local-explore-metadata.ts');
  for (const key of api.EXPLORE_FILTER_KEYS) assert.ok(APP_LOCAL_EXPLORE_QUERY_KEYS.includes(key));
  for (const key of ['userId', 'salonId', 'latitude', 'role', 'token']) assert.equal(APP_LOCAL_EXPLORE_QUERY_KEYS.includes(key), false);
});
test('actual Apply handler uses committed GPS response and filters in a single request', () => {
  const file = 'app/explore/explore-client.tsx', ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === 'applySearchFilters') handler = node; ts.forEachChild(node, visit); }; visit(ast);
  assert.ok(handler);
  const calls = [], coordinates = { latitude: 43.04, longitude: -87.91 }, filters = { bookableOnly: true, maxPrice: 50 };
  const deps = {
    prepareSearchTransition() {}, gpsRequestVersion: { current: 0 }, gpsRequest: { current: null }, typedRequest: { current: null }, setGpsStatus() {}, setCategory() {},
    committedSearch: { coordinates, displayQuery: 'pedicure', appliedSort: 'trusted', category: 'All', scopePolicy: 'fixed' },
    cleanCategory: value => value, runGpsSearch: (...args) => calls.push(args),
  };
  const code = ts.transpileModule(handler.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const fn = new Function(...Object.keys(deps), code + ';return applySearchFilters;')(...Object.values(deps));
  fn('Nails', filters);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [coordinates, 1, 'pedicure', 'trusted', 'Nails', 'salons', 'fixed', filters]);
});
