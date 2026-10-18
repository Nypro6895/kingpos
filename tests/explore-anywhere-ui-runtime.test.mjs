import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: name => deps[name] ?? {}, URLSearchParams, AbortController, process: { env: {} }, ...globals });
  return exports;
}

const discovery = load('lib/explore-feed-discovery.ts');
const intent = load('lib/explore-query-intent.ts');
const searchContext = load('lib/explore-search-context.ts', { '@/lib/explore-feed-discovery': discovery, '@/lib/explore-query-intent': intent });
const recommendations = load('lib/explore-search-recommendations.ts', { '@/lib/explore-feed-discovery': discovery });
const rpc = load('lib/explore-search-rpc.ts');
const source = readFileSync('app/explore/explore-client.tsx', 'utf8');
const ast = ts.createSourceFile('explore-client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const main = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExploreClient');
const stateNames = main.body.statements.flatMap(statement => ts.isVariableStatement(statement) ? statement.declarationList.declarations.flatMap(declaration => ts.isArrayBindingPattern(declaration.name) && ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(ast) === 'useState' ? [declaration.name.elements[0].getText(ast)] : []) : []);
const item = id => ({ id, name: id, serviceCategories: ['Nails'], city: 'Milwaukee', state: 'WI' });
const response = (query = 'nails near me', patch = {}) => ({
  searchVersion: 3, target: 'salons', query, contentQuery: query, displayQuery: query, category: '',
  location: '', locationSource: 'none', locationOrigin: 'none', scope: { policy: 'expandable' },
  sort: 'relevance', appliedSort: 'relevance', page: 1, pageSize: 12, error: null,
  results: [], sections: { bestMatches: [], nearby: [], recommended: [], reference: [] },
  groupCounts: { bestMatches: 0, nearby: 0, recommended: 0 }, totalCount: 0, totalPages: 1,
  hasMore: false, requiresGps: false, ...patch,
});

function harness(initial = response('nails near me', { requiresGps: true })) {
  const states = [], refs = [], setters = {}, requests = [], navigations = [], history = [], storage = new Map();
  let stateIndex = 0, refIndex = 0, pending = false;
  const input = { value: initial.query };
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState(initializer) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initializer === 'function' ? initializer() : initializer;
      const set = value => { states[index] = typeof value === 'function' ? value(states[index]) : value; };
      setters[stateNames[index]] = set;
      return [states[index], set];
    },
    useRef(initializer) { const index = refIndex++; refs[index] ??= { current: initializer }; return refs[index]; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {},
    useTransition: () => [pending, fn => { pending = true; fn(); }],
  };
  const jsx = (type, props, key) => ({ type, props, key });
  function ExploreSearchToolbar() {}
  function ExploreSearchContext() {}
  function ExploreSearchOnwardActions() {}
  const storageApi = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const api = load('app/explore/explore-client.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'next/navigation': { useRouter: () => ({ push: url => navigations.push(url) }), usePathname: () => '/explore', useSearchParams: () => new URLSearchParams('q=nails+near+me&location=&type=salons') },
    'next/dynamic': { __esModule: true, default: () => () => null },
    '@/lib/explore-search-context': searchContext, '@/lib/explore-search-recommendations': recommendations, '@/lib/explore-search-rpc': rpc,
    '@/lib/explore-viewport-priority': { useExploreFirstContentPaint() {} },
    '@/lib/use-explore-search-media': { useExploreSearchMedia: ({ results }) => results },
    '@/lib/explore-startup-interaction': { readExploreStartupInteraction: () => null },
    '@/lib/explore-search-client': { fetchExploreSearchPage: (input, signal) => new Promise((resolve, reject) => requests.push({ input, signal, resolve, reject })) },
    '@/app/explore/explore-search-toolbar': { ExploreSearchToolbar },
    '@/app/explore/explore-search-context': { ExploreSearchContext },
    '@/app/explore/explore-search-recommendations': { ExploreSearchOnwardActions },
  }, {
    document: { querySelector: () => null, getElementById: () => input },
    window: { sessionStorage: storageApi, localStorage: storageApi, history: { replaceState: (...args) => history.push(args) } },
  });
  const props = { initialResponse: initial, initialSearchMode: true, initialLocationSource: initial.locationSource, hasUrlLocation: true, commentViewer: { userId: null }, discoveryContent: { shortcuts: [] }, homeContent: { inspiration: { items: [] }, recommendedSalons: [], newSalons: [], popularServices: [] }, initialFeed: { items: [] }, quickActions: [], workspaceLocation: { label: '', source: 'none' } };
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== 'object') return null;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
    return null;
  };
  const render = () => { stateIndex = 0; refIndex = 0; return api.ExploreClient(props); };
  const component = (tree, name) => find(tree, node => node.type?.name === name);
  const toolbar = () => component(render(), 'ExploreSearchToolbar').props;
  return {
    render, find, component, toolbar, requests, navigations, history, storage,
    submit(query) { input.value = query; return toolbar().onSearch(query); },
    state(name) { return states[stateNames.indexOf(name)]; },
    set(name, value) { assert.ok(setters[name], name); setters[name](value); },
    finishNavigation() { pending = false; },
  };
}

const heading = (api, tree = api.render()) => api.find(tree, node => node.type === 'h2')?.props.children;
const hasGpsPrompt = (api, tree = api.render()) => Boolean(api.find(tree, node => node.type === 'button' && node.props.children === 'Use current location'));

test('Anywhere sequence near me → red nail → ZIP → nails near wa submits each query and hides the stale GPS prompt while waiting', async () => {
  const api = harness();
  assert.equal(heading(api), 'Choose a location to find salons near you');
  for (const query of ['red nail', '53222', 'nails near wa']) {
    const pending = api.submit(query);
    const request = api.requests.at(-1);
    assert.equal(request.input.query, query);
    assert.equal(request.input.location, '');
    assert.equal(request.input.locationSource, 'none');
    assert.equal(request.input.latitude, undefined);
    assert.equal(request.input.longitude, undefined);
    assert.equal(api.toolbar().pending, true);
    assert.equal(hasGpsPrompt(api), false);
    assert.equal(heading(api), 'Loading results…');
    assert.equal(api.component(api.render(), 'ExploreNotice'), null);
    request.resolve(response(query));
    await pending;
    assert.equal(api.toolbar().pending, false);
    assert.equal(heading(api), 'No results found');
    assert.equal(hasGpsPrompt(api), false);
    assert.ok(api.component(api.render(), 'ExploreSearchOnwardActions'));
  }
  assert.equal(api.requests.length, 3);
  assert.equal(api.history.length, 3);
});

test('a timeout or connection failure belongs to the new query, stops loading, and never revives the previous GPS prompt', async () => {
  for (const [error, title] of [[new Error('Search took too long.'), 'Search took too long'], [new Error('offline'), 'Search connection interrupted']]) {
    const api = harness();
    const pending = api.submit('red nail');
    api.requests[0].reject(error);
    await pending;
    const tree = api.render();
    assert.equal(heading(api, tree), 'Search is temporarily unavailable');
    assert.equal(api.toolbar().pending, false);
    assert.equal(hasGpsPrompt(api, tree), false);
    assert.equal(api.component(tree, 'ExploreNotice').props.title, title);
    assert.equal(api.component(tree, 'SearchRefinementBar'), null);
    assert.equal(api.component(tree, 'ExploreSearchOnwardActions'), null);
    const retry = api.submit('red nail');
    assert.equal(heading(api), 'Loading results…');
    assert.equal(api.component(api.render(), 'ExploreNotice'), null);
    const salon = item('Red Nail Salon');
    api.requests[1].resolve(response('red nail', { results: [salon], sections: { bestMatches: [salon], nearby: [], recommended: [] } }));
    await retry;
    assert.equal(api.component(api.render(), 'ResultSection').props.results[0].id, salon.id);
    assert.equal(hasGpsPrompt(api), false);
    assert.equal(api.component(api.render(), 'ExploreNotice'), null);
  }
});

test('Anywhere cancels a request and clears its GPS context so the same text remains searchable without coordinates', async () => {
  const api = harness();
  const stale = api.submit('53222');
  api.toolbar().onAreaApply('', 'expandable');
  assert.equal(api.requests[0].signal.aborted, true);
  api.finishNavigation();
  const current = api.submit('53222');
  assert.equal(api.requests.length, 2, 'cancelled request must not block an identical new query');
  api.requests[1].resolve(response('53222', { location: '53222', locationOrigin: 'query', locationSource: 'saved' }));
  await current;
  api.requests[0].reject(new Error('offline'));
  await stale;
  assert.equal(api.state('sessionResponse').query, '53222');
  assert.equal(api.state('typedSearchFailure'), null);
  assert.equal(api.toolbar().location, '53222');

  const active = response('nails', { location: 'Milwaukee, WI', locationSource: 'gps', locationOrigin: 'context' });
  api.set('gpsResponse', active); api.set('gpsCoordinates', { latitude: 43.04, longitude: -87.91 });
  api.set('committedGpsContext', { response: active, coordinates: { latitude: 43.04, longitude: -87.91 } });
  api.storage.set('kingpos-explore-manual-location', 'Milwaukee, WI');
  api.toolbar().onAreaApply('', 'expandable');
  assert.equal(api.state('gpsCoordinates'), null);
  assert.equal(api.state('gpsResponse'), null);
  assert.equal(api.state('committedGpsContext'), null);
  assert.equal(api.state('locationSource'), 'none');
  assert.equal(api.state('location'), '');
  assert.equal(api.storage.get('kingpos-explore-manual-location'), undefined);
  assert.equal(api.storage.get('kingpos-explore-use-current-location'), 'off');
  const url = new URL(api.navigations.at(-1), 'https://test');
  assert.equal(url.searchParams.get('location'), '');
  assert.equal(url.searchParams.get('locationSource'), 'none');
  assert.equal(url.searchParams.get('scope'), 'expandable');
});

test('a returned search error remains distinct from no results and is replaced by the next completed query', async () => {
  const api = harness();
  const failed = api.submit('red nail');
  api.requests[0].resolve(response('red nail', { error: 'Please try again.', errorKind: 'timeout' }));
  await failed;
  assert.equal(heading(api), 'Search is temporarily unavailable');
  assert.equal(api.component(api.render(), 'ExploreNotice').props.title, 'Search took too long');
  assert.equal(hasGpsPrompt(api), false);
  const next = api.submit('53222');
  assert.equal(api.component(api.render(), 'ExploreNotice'), null);
  assert.equal(heading(api), 'Loading results…');
  api.requests[1].resolve(response('53222', { location: '53222', locationSource: 'saved', locationOrigin: 'query' }));
  await next;
  assert.equal(heading(api), 'No results found');
  assert.equal(api.component(api.render(), 'ExploreNotice'), null);
  assert.equal(hasGpsPrompt(api), false);
});

test('successfully resolved typed ZIP and state stay visible without a GPS requirement', async () => {
  for (const [query, location] of [['53222', '53222'], ['nails near wa', 'WA']]) {
    const api = harness();
    const pending = api.submit(query);
    const salon = item(`${location} Salon`);
    api.requests[0].resolve(response(query, { location, locationOrigin: 'query', locationSource: 'saved', results: [salon], sections: { bestMatches: [salon], nearby: [], recommended: [] } }));
    await pending;
    assert.equal(api.toolbar().location, location);
    assert.equal(api.toolbar().locationSource, 'saved');
    assert.equal(hasGpsPrompt(api), false);
    assert.equal(api.state('gpsCoordinates'), null);
    assert.equal(api.component(api.render(), 'ResultSection').props.results[0].id, salon.id);
  }
});

test('global salon sections do not claim a local area, while selected-city and measured-GPS headings retain their meaning', () => {
  const salon = { ...item('Nail Salon'), distanceMiles: 2 };
  const global = response('nails', { results: [salon], sections: { bestMatches: [], nearby: [salon], recommended: [] } });
  const cases = [
    { result: global, title: 'Salons' },
    { result: { ...global, location: 'Milwaukee, WI', locationSource: 'manual', locationOrigin: 'manual' }, title: 'Salons in Milwaukee, WI' },
    { result: { ...global, locationSource: 'gps', locationOrigin: 'context' }, gps: true, title: 'Salons near you' },
  ];
  for (const { result, gps, title } of cases) {
    const api = harness(result);
    api.render();
    if (gps) api.set('gpsResponse', result);
    const section = api.find(api.render(), node => node.type?.name === 'ResultSection' && node.props.rankKind === 'area');
    assert.equal(section.props.title, title);
    assert.equal(section.props.results[0].id, salon.id);
  }
});
