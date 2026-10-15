import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, ...globals, require: key => {
    assert.ok(key in imports, key); return imports[key];
  } });
  return exports;
}
const catalog = load('lib/nail-inspiration-catalog.ts');
const imports = { '@/lib/nail-inspiration-catalog': catalog };
const ranking = load('lib/nail-inspiration-personalization.ts', imports);
const search = load('lib/nail-inspiration.ts', imports);
const ids = looks => Array.from(looks, look => look.id);
const now = Date.now();

test('new visitors keep varied rotation; saved looks and recent opens automatically influence recommendations', () => {
  const candidates = search.selectNailLooks('', {}, 'automatic');
  assert.deepEqual(ids(ranking.personalizeNailLooks(candidates, [], [], now)), ids(candidates));
  for (const [saved, views] of [[['look:nail-cherry-stiletto'], []], [[], [{ id: 'cherry-stiletto', at: now }]]]) {
    const ranked = ranking.personalizeNailLooks(candidates, saved, views, now);
    assert.equal(ranked.length, candidates.length);
    assert.equal(new Set(ids(ranked)).size, candidates.length);
    assert.ok(ranked[0].colors.includes('red'));
    assert.equal(ranked[0].shape, 'stiletto');
    const firstUnseen = candidates.find(look => !ids(ranked.slice(0, 3)).includes(look.id));
    assert.equal(ranked[3].id, firstUnseen.id, 'every fourth item preserves broader discovery');
  }
});

test('explicit queries win over preferences, and switching or removing interests changes recommendations', () => {
  const candidates = search.selectNailLooks('short square', { color: 'nude' }, 'automatic');
  const ranked = ranking.personalizeNailLooks(candidates, ['look:nail-cherry-stiletto'], [], now);
  assert.ok(ranked.length);
  assert.ok(ranked.every(look => look.length === 'short' && look.shape === 'square' && look.colors.includes('nude')));
  const all = search.selectNailLooks('', {}, 'automatic');
  const red = ranking.personalizeNailLooks(all, ['look:nail-cherry-stiletto'], [], now);
  const nude = ranking.personalizeNailLooks(all, ['look:nail-nude-square'], [], now);
  assert.notDeepEqual(ids(red.slice(0, 3)), ids(nude.slice(0, 3)));
  assert.deepEqual(ids(ranking.personalizeNailLooks(all, [], [], now)), ids(all));
});

test('new batches adapt without moving displayed cards or introducing duplicates', () => {
  const all = search.selectNailLooks('', {}, 'stable');
  const displayed = all.slice(0, 6);
  const ranked = ranking.personalizeNailLooks(all, ['look:nail-cherry-stiletto'], [], now);
  const appended = ranking.appendNailRecommendations(displayed, ranked, 12);
  assert.deepEqual(ids(appended.slice(0, 6)), ids(displayed));
  assert.equal(appended.length, 12);
  assert.equal(new Set(ids(appended)).size, 12);
  assert.equal(appended[6].id, ranked.find(look => !ids(displayed).includes(look.id)).id);
});

test('browser history is bounded, validated and expires after 30 days', () => {
  const values = ranking.normalizeNailViews([
    { id: 'cherry-stiletto', at: now - 1000 }, { id: 'cherry-stiletto', at: now },
    { id: 'ruby-stiletto', at: now - 31 * 86400000 }, { id: 'nude-square', at: now + 1 },
    { id: 'not-a-look', at: now }, { id: 'scarlet-square', at: 'yesterday' }, null,
  ], now);
  assert.deepEqual(ids(values), ['cherry-stiletto']);
  assert.equal(values[0].at, now);
  assert.equal(ranking.normalizeNailViews(catalog.NAIL_LOOKS.map(look => ({ id: look.id, at: now })), now).length, 40);
});

test('opened looks persist per viewer; guest and other accounts do not share interests; storage failures remain usable', () => {
  const stored = new Map(), events = [];
  const client = load('lib/nail-inspiration-personalization.ts', imports, {
    window: { localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) }, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
  });
  client.recordNailLookView('cherry-stiletto', 'alice');
  client.recordNailLookView('cherry-stiletto', 'alice');
  assert.equal(events.length, 1, 'repeated opens within 30 seconds are deduplicated');
  assert.deepEqual(ids(client.readNailViews('alice')), ['cherry-stiletto']);
  assert.equal(client.readNailViews('bob').length, 0);
  assert.equal(client.readNailViews(null).length, 0);
  stored.set(client.nailInterestStorageKey('alice'), 'broken');
  assert.equal(client.readNailViews('alice').length, 0);
  const blocked = load('lib/nail-inspiration-personalization.ts', imports, {
    window: { get localStorage() { throw Error('unavailable'); }, dispatchEvent() {} },
    CustomEvent: class {},
  });
  assert.doesNotThrow(() => blocked.recordNailLookView('cherry-stiletto', null));
  assert.equal(blocked.readNailViews().length, 0);
});
