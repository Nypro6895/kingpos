import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => deps[name], AbortController, setTimeout, clearTimeout, console: { warn() {} }, ...globals });
  return exports;
}
const helpers = load('lib/explore-search-refresh.ts');
const row = (id, extra = {}) => ({ id, mediaRevision: 'old', resultGroup: 'best_match', relevanceScore: 100, ...extra });
const flush = () => new Promise(setImmediate);

test('deep lists refresh at most36 known visible salons, independent of scroll depth', () => {
  const results = Array.from({ length: 600 }, (_, n) => row(String(n)));
  assert.equal(helpers.exploreSearchRefreshIds(results).length, 36);
  const ids = helpers.exploreSearchRefreshIds(results, ['unknown', '590', '590', '599']);
  assert.deepEqual(Array.from(ids), ['590', '599']);
  const merged = helpers.mergeExploreSearchMedia(results, [row('599', { mediaRevision: 'new' })], ['590', '599']);
  assert.equal(merged.length, 599, 'only the requested withdrawn salon is removed');
  assert.equal(merged[0], results[0], 'unrequested pages retain their data');
  assert.equal(merged.at(-1).mediaRevision, 'new');
  assert.equal(merged.at(-1).relevanceScore, 100);
});

function hookHarness({ results = Array.from({ length: 600 }, (_, n) => row(String(n))), omit = new Set(), pending = false } = {}) {
  const slots = [], effects = [], events = new Map(), docEvents = new Map(), requests = [], observers = [];
  const timeouts = new Map(), intervals = new Map(), nodes = new Map();
  let slot = 0, timer = 0, scanCount = 0, visible = 'visible', pendingEffects = [];
  let props = { response: { searchVersion: 3, sessionCursor: { session: 's', after: 12 }, query: 'gel', queryKind: 'service', filters: {}, scope: { policy: 'fixed' } }, results, viewerId: 'viewer' };
  const react = {
    useState(initial) {
      const index = slot++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], update => { slots[index] = typeof update === 'function' ? update(slots[index]) : update; }];
    },
    useRef(initial) { const index = slot++; return slots[index] ?? (slots[index] = { current: initial }); },
    useEffect(fn, deps) {
      const index = slot++, previous = effects[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) {
        pendingEffects.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: fn() }; });
      }
    },
  };
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; this.nodes = []; this.disconnected = false; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    disconnect() { this.disconnected = true; }
  }
  const api = load('lib/use-explore-search-media.ts', {
    react,
    '@/lib/experience-cache-events': { EXPERIENCE_RESET_EVENT: 'reset' },
    '@/lib/explore-search-context': { buildExploreCommittedSearchContext: (response, options) => ({ sessionKey: JSON.stringify([response.query, options.viewerId]) }) },
    '@/lib/explore-search-refresh': helpers,
    '@/lib/explore-search-client': { fetchExploreSearchPage: (input, signal) => {
      const request = { input, signal }; requests.push(request);
      if (pending) return new Promise(resolve => { request.resolve = resolve; });
      return Promise.resolve({ results: input.hydrateIds.filter(id => !omit.has(id)).map(id => row(id, { mediaRevision: 'fresh' })) });
    } },
  }, {
    IntersectionObserver: Observer,
    setTimeout: fn => { timeouts.set(++timer, fn); return timer; }, clearTimeout: id => timeouts.delete(id),
    window: { setInterval: fn => { intervals.set(++timer, fn); return timer; }, clearInterval: id => intervals.delete(id), addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) },
    document: { get visibilityState() { return visible; }, querySelectorAll: () => {
      scanCount++;
      return props.results.map(result => {
        if (!nodes.has(result.id)) nodes.set(result.id, { dataset: { salonId: result.id }, getBoundingClientRect() { throw new Error('Observer path must not measure every card'); } });
        return nodes.get(result.id);
      });
    }, addEventListener: (name, fn) => docEvents.set(name, fn), removeEventListener: name => docEvents.delete(name) },
  });
  const render = (next = {}) => {
    props = { ...props, ...next }; slot = 0; pendingEffects = [];
    const rows = api.useExploreSearchMedia(props);
    for (const effect of pendingEffects) effect();
    return rows;
  };
  const intersect = async ids => {
    const observer = observers.at(-1), visibleIds = new Set(ids);
    observer.callback(observer.nodes.map(target => ({ target, isIntersecting: visibleIds.has(target.dataset.salonId) })));
    for (const [id, fn] of timeouts) { timeouts.delete(id); fn(); }
    await flush();
  };
  render();
  return { requests, events, docEvents, intervals, observers, render, intersect, scanCount: () => scanCount,
    visibility: state => { visible = state; docEvents.get('visibilitychange')?.(); },
    cleanup: () => { for (const effect of effects) effect?.cleanup?.(); } };
}

test('observer follows deep viewport without per-scroll geometry scans and keeps updates across windows', async () => {
  const h = hookHarness({ omit: new Set(['590']) });
  assert.equal(h.requests.length, 0, 'modern browsers wait for actual visibility');
  await h.intersect(['590', '599']);
  assert.equal(h.requests.length, 1); assert.deepEqual(Array.from(h.requests[0].input.hydrateIds), ['590', '599']);
  let visible = h.render();
  assert.equal(visible.length, 599); assert.equal(visible[0].id, '0');
  await h.intersect(['5']);
  visible = h.render();
  assert.equal(visible.at(-1).mediaRevision, 'fresh', 'earlier window updates survive later refresh');
  assert(!visible.some(x => x.id === '590'));
  assert.equal(h.scanCount(), 1, 'IO callbacks reuse observed nodes instead of scanning the document on scroll');
  h.events.get('reset')(); assert.equal(h.render().length, 0); assert(h.requests[0].signal.aborted);
  h.cleanup(); assert.equal(h.events.size, 0); assert.equal(h.docEvents.size, 0); assert.equal(h.intervals.size, 0);
  assert(h.observers.every(observer => observer.disconnected));
});

test('withdrawn members cannot resurrect when continuation appends or advances cursor offset', async () => {
  const h = hookHarness({ omit: new Set(['590']) });
  await h.intersect(['590', '599']);
  assert(!h.render().some(result => result.id === '590'));
  const appended = Array.from({ length: 612 }, (_, n) => row(String(n)));
  const visible = h.render({ results: appended });
  assert.equal(visible.length, 611);
  assert(!visible.some(result => result.id === '590'), 'same-session append preserves live withdrawal before any new response');
  assert.equal(visible.find(result => result.id === '599').mediaRevision, 'fresh');
  const advanced = h.render({ response: { searchVersion: 3, sessionCursor: { session: 's', after: 612 }, query: 'gel', queryKind: 'service', filters: {}, scope: { policy: 'fixed' } } });
  assert(!advanced.some(result => result.id === '590'), 'cursor offset is not a new authority/session');
  await h.intersect(['611']);
  assert(!h.render().some(result => result.id === '590'), 'refreshing a different window must retain the tombstone');
  h.cleanup();
});

test('account reset stays suspended through append; new viewer/session gets separate authority', async () => {
  const h = hookHarness();
  await h.intersect(['599']);
  const requestCount = h.requests.length;
  h.events.get('reset')(); assert.equal(h.render().length, 0);
  assert.equal(h.render({ results: Array.from({ length: 612 }, (_, n) => row(String(n))) }).length, 0);
  await h.intersect(['611']); h.events.get('focus')(); await flush();
  assert.equal(h.requests.length, requestCount, 'appending cached data cannot restart a reset account session');
  const fresh = h.render({ viewerId: 'new-viewer', response: { searchVersion: 3, sessionCursor: { session: 'new-session', after: 0 }, query: 'new search' }, results: [row('fresh')] });
  assert.deepEqual(Array.from(fresh, item => item.id), ['fresh']);
  await h.intersect(['fresh']); assert.equal(h.requests.length, requestCount + 1);
  h.cleanup();
});

test('late observer response is discarded after cleanup or account reset', async () => {
  for (const reset of [false, true]) {
    const h = hookHarness({ pending: true });
    await h.intersect(['599']); assert.equal(h.requests.length, 1);
    if (reset) h.events.get('reset')(); else h.cleanup();
    assert(h.requests[0].signal.aborted);
    h.requests[0].resolve({ results: [row('599', { mediaRevision: 'forbidden-late' })] }); await flush();
    const rows = h.render();
    assert(!rows.some(result => result.mediaRevision === 'forbidden-late'));
    if (reset) assert.equal(rows.length, 0);
    h.cleanup();
  }
});

test('timeout retry has a cancellable backoff and never repeats after query cancellation', async () => {
  const api = load('lib/explore-search-rpc.ts');
  const controller = new AbortController(); let calls = 0;
  const promise = api.runExploreSearchRpc(async () => { calls++; return { data: null, error: { code: '57014' } }; }, controller.signal);
  await flush(); assert.equal(calls, 1);
  controller.abort(); await promise; assert.equal(calls, 1);
  const started = performance.now(); calls = 0;
  await api.runExploreSearchRpc(async () => ({ error: ++calls === 1 ? { code: '57014' } : null }));
  assert.equal(calls, 2); assert(performance.now() - started >= 300);
});
