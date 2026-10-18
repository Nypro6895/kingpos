import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const ast = ts.createSourceFile('explore-client.tsx', readFileSync('app/explore/explore-client.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const client = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ExploreClient');
const effects = client.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect');
const automaticEffect = effects.find(node => node.getText(ast).includes('const restore = async'));
const startupEffect = effects.find(node => node.getText(ast).includes('if (interaction.gps)'));
assert.ok(automaticEffect);assert.ok(startupEffect);

function harness({ origin, source = 'manual', startupGps = false, requiresGps = false, preference = 'on', urlSource } = {}) {
  const calls = [], state = { current: false };
  const globals = {
    URLSearchParams, autoLocationChecked: state, appliedSavedLocation: { current: false },
    initialResponse: { location: 'Milwaukee, WI', locationOrigin: origin, requiresGps },
    initialLocationSource: source, hasUrlLocation: true, initialSearchMode: true,
    location: 'Milwaukee, WI', pathname: '/explore', query: 'nails', selectedCategory: 'Nails',
    commentViewer: { userId: null }, GPS_PREFERENCE_KEY: 'gps', SAVED_LOCATION_KEY: 'saved',
    searchParams: new URLSearchParams(urlSource ? `location=&locationSource=${urlSource}` : 'location=Milwaukee%2C+WI'),
    requestLocationRef: { current: () => calls.push('request-gps') },
    readExploreStartupInteraction: () => startupGps ? { gps: true } : null,
    clearExploreStartupInteraction: () => calls.push('clear-startup'),
    window: { sessionStorage: { getItem: () => preference }, localStorage: { getItem: () => 'Chicago, IL' } },
    navigator: { permissions: { query: async () => { calls.push('permission');return { state: 'granted' }; } } },
    startTransition: fn => fn(), router: { replace: () => calls.push('navigate') }, buildUrl: () => '/explore',
  };
  const invoke = effect => vm.runInNewContext(ts.transpileModule(`(${effect.expression.arguments[0].getText(ast)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, globals);
  return { calls, state, automatic: () => invoke(automaticEffect), startup: () => invoke(startupEffect) };
}

test('a chosen area survives automatic GPS preference restoration, including older responses without origin', async () => {
  for (const choice of [{ origin: 'manual', source: 'manual' }, { origin: 'query', source: 'saved' }, { source: 'manual' }]) {
    const api = harness(choice);api.automatic();await Promise.resolve();
    assert.deepEqual(api.calls, [], JSON.stringify(choice));assert.equal(api.state.current, true);
  }
  const contextual = harness({ origin: 'context', source: 'gps' });contextual.automatic();await new Promise(setImmediate);
  assert.deepEqual(contextual.calls, ['permission', 'request-gps']);
});

test('an explicit startup Use current location click remains actionable even when a city was selected', () => {
  const api = harness({ origin: 'manual', startupGps: true });api.startup();
  assert.deepEqual(api.calls, ['request-gps', 'clear-startup']);
});

test('an Anywhere preference never auto-requests GPS for a prior near-me response, but an explicit click still works', async () => {
  const api = harness({ origin: 'none', source: 'none', requiresGps: true, preference: 'off', startupGps: true });
  api.automatic();await new Promise(setImmediate);
  assert.deepEqual(api.calls, ['permission']);assert.equal(api.state.current, true);
  api.startup();assert.deepEqual(api.calls, ['permission', 'request-gps', 'clear-startup']);
});

test('an explicit Anywhere URL wins an older GPS-on preference while deliberate startup GPS remains actionable', async () => {
  const api = harness({ origin: 'none', source: 'none', requiresGps: true, preference: 'on', urlSource: 'none', startupGps: true });
  api.automatic();await new Promise(setImmediate);
  assert.deepEqual(api.calls, []);assert.equal(api.state.current, true);
  api.startup();assert.deepEqual(api.calls, ['request-gps', 'clear-startup']);
});

test('requesting a new GPS point keeps the chosen city and committed results until resolution, including permission denial', () => {
  const request = client.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requestCurrentLocation');
  assert.ok(request);
  for (const deny of [false, true]) {
    const state = {}, calls = [], activeResponse = { location: 'Milwaukee, WI', locationSource: 'gps' };
    const previousPoint = { latitude: 43.04, longitude: -87.91 };
    const nextPoint = { latitude: 41.88, longitude: -87.63 };
    let success, failure;
    const globals = {
      document: { getElementById: () => ({ value: 'nails' }) }, query: 'nails', searchTarget: 'salons',
      activeResponse, committedGpsContext: { response: activeResponse, coordinates: previousPoint },
      prepareSearchTransition() {}, typedRequest: { current: null }, gpsRequestVersion: { current: 0 }, gpsRequest: { current: null },
      GPS_PREFERENCE_KEY: 'gps', window: { sessionStorage: { setItem() {} } },
      explicitSearchMode: true, normalizedCategory: 'Nails', searchOrderMode: 'relevance',
      navigator: { geolocation: { getCurrentPosition: (ok, fail) => { success = ok;failure = fail; } } },
      runGpsSearch: (...args) => calls.push(args), runHomeNearYou: () => assert.fail('search mode must stay in search'),
    };
    for (const name of ['Query', 'GpsStatus', 'GpsMessage', 'GpsCoordinates', 'GpsResponse', 'LocationSource']) globals[`set${name}`] = value => { state[name] = value; };
    vm.runInNewContext(ts.transpileModule(request.getText(ast) + '\nrequestCurrentLocation();', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, globals);
    assert.equal(state.GpsResponse, undefined);assert.equal(state.LocationSource, undefined);assert.equal(state.GpsCoordinates, undefined);
    if (deny) {
      failure({ code: 1, PERMISSION_DENIED: 1 });assert.equal(state.GpsCoordinates, previousPoint);assert.equal(state.GpsStatus, 'denied');assert.equal(calls.length, 0);
    } else {
      success({ coords: nextPoint });assert.equal(calls.length, 1);assert.equal(calls[0][0].latitude, nextPoint.latitude);
      assert.equal(state.GpsResponse, undefined);assert.equal(state.LocationSource, undefined);assert.equal(state.GpsCoordinates, undefined);
    }
  }
});
