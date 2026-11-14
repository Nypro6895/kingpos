import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const { outputFiles } = buildSync({ entryPoints: ['lib/forum-read-cache.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', outputFiles[0].text)(module, module.exports);
const { createForumReadCache, forumReadCacheKey } = module.exports;
const key = (mode, filters = {}) => forumReadCacheKey({ mode, ...filters });

test('Forum list identity separates tabs and every applied filter without depending on object order', () => {
  const baseline = key('feed');
  const identities = [baseline, key('following'), key('saved'), key('mine'), key('feed', { q: 'nails' }), key('feed', { state: 'WI' }), key('feed', { section: 'operations' }), key('feed', { unanswered: true })];
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(key('feed', { state: 'WI', q: ' nails ' }), key('feed', { q: 'nails', state: 'WI' }));
  assert.equal(key('feed', { q: 'a'.repeat(160) }), key('feed', { q: 'a'.repeat(150) }));
  assert.throws(() => key('reports'), /Invalid forum list/);
});

test('A warm tab returns its own rows and stays visible when its freshness expires', () => {
  let now = 100_000;
  const cache = createForumReadCache({ now: () => now });
  const epoch = cache.getEpoch();
  cache.put(key('feed'), { rows: [{ id: 'feed-only' }], more: true }, epoch);
  cache.put(key('following'), { rows: [], more: false }, epoch);
  assert.deepEqual(cache.get(key('following')).rows, []);
  assert.equal(cache.get(key('mine')), undefined);
  assert.equal(cache.get(key('feed')).fresh, true);
  now += 29_999;
  assert.equal(cache.get(key('feed')).fresh, true);
  now += 1;
  assert.deepEqual(cache.get(key('feed')), { rows: [{ id: 'feed-only' }], more: true, updatedAt: 100_000, fresh: false });
});

test('Pagination replaces only its keyed snapshot and can retain the first-page freshness timestamp', () => {
  let now = 100_000;
  const cache = createForumReadCache({ now: () => now });
  const epoch = cache.getEpoch(), feed = key('feed'), following = key('following');
  const first = [{ id: 'first' }];
  cache.put(feed, { rows: first, more: true }, epoch);
  cache.put(following, { rows: [{ id: 'followed' }], more: false }, epoch);
  first.push({ id: 'external' });
  const retained = cache.get(feed);
  now += 10_000;
  cache.put(feed, { rows: [...retained.rows, { id: 'next-page' }], more: false, updatedAt: retained.updatedAt }, epoch);
  const result = cache.get(feed);
  assert.deepEqual(result.rows, [{ id: 'first' }, { id: 'next-page' }]);
  assert.equal(result.updatedAt, 100_000);
  result.rows.push({ id: 'external-read' });
  assert.equal(cache.get(feed).rows.length, 2);
  assert.deepEqual(cache.get(following).rows, [{ id: 'followed' }]);
});

test('Mutation invalidation keeps display rows stale and rejects earlier in-flight results', () => {
  const cache = createForumReadCache({ now: () => 100_000 });
  const before = cache.getEpoch();
  cache.put(key('feed'), { rows: ['old'], more: false }, before);
  cache.put(key('following'), { rows: ['followed'], more: false }, before);
  cache.invalidate(key('following'));
  assert.equal(cache.get(key('feed')).fresh, true);
  assert.equal(cache.get(key('following')).fresh, false);
  assert.equal(cache.put(key('following'), { rows: ['late-before-write'], more: false }, before), false);
  assert.deepEqual(cache.get(key('following')).rows, ['followed']);
  assert.equal(cache.put(key('following'), { rows: ['after-write'], more: false }, cache.getEpoch()), true);
  cache.invalidate();
  assert.equal(cache.get(key('feed')).fresh, false);
  assert.equal(cache.get(key('following')).fresh, false);
});

test('Privacy withdrawal clears every list and a late result cannot repopulate it', () => {
  const cache = createForumReadCache();
  const before = cache.getEpoch();
  cache.put(key('feed'), { rows: ['blocked-content'], more: true }, before);
  cache.put(key('saved'), { rows: ['private-saved'], more: false }, before);
  cache.clear();
  assert.equal(cache.get(key('feed')), undefined);
  assert.equal(cache.get(key('saved')), undefined);
  assert.equal(cache.put(key('feed'), { rows: ['late-blocked-content'], more: true }, before), false);
  assert.equal(cache.get(key('feed')), undefined);
});

test('Cache evicts the least recently used filter and bounds pagination rows', () => {
  const cache = createForumReadCache({ maxEntries: 2, maxRows: 2 });
  const epoch = cache.getEpoch();
  cache.put(key('feed'), { rows: [1, 2, 3], more: false }, epoch);
  cache.put(key('saved'), { rows: [4], more: false }, epoch);
  assert.deepEqual(cache.get(key('feed')).rows, [1, 2]);
  assert.equal(cache.get(key('feed')).more, true);
  cache.put(key('mine'), { rows: [5], more: false }, epoch);
  assert.equal(cache.get(key('saved')), undefined);
  assert.deepEqual(cache.get(key('feed')).rows, [1, 2]);
  assert.deepEqual(cache.get(key('mine')).rows, [5]);
});

test('Default bounds remain twelve filters and two hundred retained rows', () => {
  const cache = createForumReadCache({ maxEntries: 100, maxRows: 1000 });
  const epoch = cache.getEpoch();
  for (let i = 0; i < 13; i++) cache.put(key('feed', { q: String(i) }), { rows: Array.from({ length: 201 }, (_, id) => id), more: false }, epoch);
  assert.equal(cache.get(key('feed', { q: '0' })), undefined);
  assert.equal(cache.get(key('feed', { q: '12' })).rows.length, 200);
  assert.equal(cache.get(key('feed', { q: '12' })).more, true);
});

test('Accepted seen metadata updates a topic across lists without renewing freshness or unrelated rows', () => {
  let now = 100_000;
  const cache = createForumReadCache({ now: () => now });
  const epoch = cache.getEpoch(), target = { id: 'read-topic', unread_replies: 3 }, other = { id: 'other-topic', unread_replies: 2 };
  cache.put(key('feed'), { rows: [target, other], more: true }, epoch);
  cache.put(key('following'), { rows: [other, target], more: false }, epoch);
  now += 29_999;
  assert.equal(cache.mapRows(row => row.id === target.id ? { ...row, unread_replies: 0 } : row, epoch), true);
  assert.equal(target.unread_replies, 3, 'The original accepted object remains immutable');
  assert.deepEqual(cache.get(key('feed')), { rows: [{ id: 'read-topic', unread_replies: 0 }, other], more: true, updatedAt: 100_000, fresh: true });
  assert.deepEqual(cache.get(key('following')), { rows: [other, { id: 'read-topic', unread_replies: 0 }], more: false, updatedAt: 100_000, fresh: true });
  cache.invalidate(key('following'));
  assert.equal(cache.mapRows(row => ({ ...row, unread_replies: 1 }), cache.getEpoch()), true);
  assert.equal(cache.get(key('following')).fresh, false, 'A metadata patch cannot restore invalidated authority');
  now += 1;
  assert.equal(cache.get(key('feed')).fresh, false, 'Metadata updates do not extend the thirty-second freshness');
});

test('An outdated or withdrawn seen update cannot patch a new cache epoch', () => {
  const cache = createForumReadCache();
  const before = cache.getEpoch();
  cache.put(key('feed'), { rows: [{ id: 'target', unread_replies: 3 }], more: false }, before);
  cache.clear();
  cache.put(key('feed'), { rows: [{ id: 'new-epoch', unread_replies: 1 }], more: false }, cache.getEpoch());
  let calls = 0;
  assert.equal(cache.mapRows(row => { calls++; return { ...row, unread_replies: 0 }; }, before), false);
  assert.equal(calls, 0);
  assert.deepEqual(cache.get(key('feed')).rows, [{ id: 'new-epoch', unread_replies: 1 }]);
  const current = cache.getEpoch();
  assert.equal(cache.mapRows(row => { cache.clear(); return row; }, current), false);
  assert.equal(cache.get(key('feed')), undefined, 'Withdrawal during transformation cannot resurrect the rows');
});
