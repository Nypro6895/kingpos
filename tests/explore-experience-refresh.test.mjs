import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual freshness effect, including delayed-request guards.
const source = ts.createSourceFile('feed.tsx', readFileSync('app/explore/explore-feed.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('const canRefresh =')) effect = node.arguments[0].getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(effect);
const code = ts.transpileModule(`globalThis.start=${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness({ top = 0, dialog = false, restoring = false, pending = null } = {}) {
  let time = 10000, tick;
  const events = new Map(), requests = [], changes = [];
  const section = { getClientRects: () => [1], getBoundingClientRect: () => ({ top }) };
  const generation = { current: 0 };
  const context = {
    Date: { now: () => time }, AbortController, HTMLElement: class {},
    sessionCursor: 'old-session', discovery: { category: 'Nails' },
    sectionRef: { current: section }, restoringRef: { current: restoring }, loadingMoreRef: { current: false }, mountedRef: { current: true }, generationRef: generation,
    activeRequest: { current: null }, requestedCursorsRef: { current: new Set(['old-page']) },
    document: { visibilityState: 'visible', activeElement: null, querySelector: () => dialog ? {} : null, addEventListener() {}, removeEventListener() {} },
    window: { innerHeight: 800, setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener() {}, scrollTo() { throw new Error('silent refresh must not scroll'); } },
    async requestExploreFeed(body) { requests.push(body); return { hasNewPosts: true }; },
    async fetchExploreFeedPage(cursor, discovery, signal) { requests.push({ cursor, discovery, signal }); if (pending) await pending; return { items: ['fresh'], nextCursor: 'fresh-page', sessionCursor: 'fresh-session', hasMore: true }; },
  };
  for (const name of ['Items', 'Cursor', 'SessionCursor', 'HasMore', 'PaginationError']) context[`set${name}`] = value => changes.push([name, value]);
  vm.runInNewContext(code, context);
  const cleanup = context.start();
  return { requests, changes, generation, cleanup, context, async tick() { time += 2000; tick(); await new Promise(resolve => setImmediate(resolve)); }, move(next) { top = next; events.get('scroll')?.(); } };
}

test('an idle feed at its beginning updates silently without forcing a scroll or notice', async () => {
  const h = harness(); await h.tick();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.changes.find(([name]) => name === 'Items'), ['Items', ['fresh']]);
  assert.equal(h.generation.current, 1);
  h.cleanup();
});

test('reading farther down, an open dialog or active restore prevents background feed replacement', async () => {
  for (const options of [{ top: -300 }, { dialog: true }, { restoring: true }]) {
    const h = harness(options); await h.tick(); assert.equal(h.requests.length, 0); assert.equal(h.changes.length, 0); h.cleanup();
  }
});

test('scrolling or leaving the feed during a request discards the delayed replacement', async () => {
  for (const unmount of [false, true]) {
    let resolve; const pending = new Promise(done => { resolve = done; });
    const h = harness({ pending }); await h.tick(); assert.equal(h.requests.length, 2);
    if (unmount) h.cleanup(); else h.move(-300);
    resolve(); await new Promise(done => setImmediate(done));
    assert.equal(h.changes.length, 0);
    if (!unmount) h.cleanup();
  }
});
