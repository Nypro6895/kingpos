import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = `guest:${'a'.repeat(64)}`;
const session = id(9999);
const at = new Date(Date.now() - 60_000).toISOString();
const cursor = after => Buffer.from(JSON.stringify({ version: 1, session, after })).toString('base64url');
const plain = value => JSON.parse(JSON.stringify(value));

function moduleFrom(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Buffer, URL, URLSearchParams, DOMException, Date, crypto: webcrypto, TextEncoder,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' } },
    console: { warn() {} },
    require(name) {
      if (name === 'server-only') return {};
      if (name === 'node:buffer') return { Buffer };
      if (name === 'node:crypto') return { createHash };
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency ${name} in ${file}`);
    },
  }, { filename: file });
  return exports;
}

const beautyMedia = moduleFrom('lib/beauty-media.ts');
const mediaPaths = moduleFrom('lib/salon-profile-media.ts');
const bookingRoutes = moduleFrom('lib/public-booking-routes.ts');
const beautyBooking = moduleFrom('lib/beauty-booking-verification.ts');
const defaultImages = moduleFrom('lib/default-nail-images.ts');
const discovery = moduleFrom('lib/explore-feed-discovery.ts');
const ranking = moduleFrom('lib/explore-social-feed-ranking.ts');
const revisions = moduleFrom('lib/explore-feed-revisions.ts');
const salonMedia = {
  getSalonProfileMediaUrl(path) {
    const safe = mediaPaths.normalizeSalonProfileMediaPath(path);
    return safe ? `https://database.example/storage/v1/object/public/salon-profile-media/${beautyMedia.encodeStoragePath(safe)}` : null;
  },
};
const contentBooking = moduleFrom('lib/content-booking.ts', {
  '@/lib/beauty-media': beautyMedia,
  '@/lib/public-booking-routes': bookingRoutes,
  '@/lib/salon-profile': salonMedia,
  '@/lib/supabase/server': { getSupabaseConfig: () => ({ supabaseUrl: 'https://database.example' }), createSupabaseServerClient: () => null },
});
const EMPTY = {
  averageRating: null, bookableServiceId: null, bookableServiceName: null,
  bookingEnabled: false, bookingHref: null, experienceCount: 0,
  nextAvailabilityLabel: null, nextAvailableAt: null, noIssueRate: null,
  reviewCount: 0, uniqueCustomerCount: 0, verifiedVisitCount: 0,
};

function candidate(n, overrides = {}) {
  return { contentKey: `salon_profile_look:${id(n)}`, contentId: id(n), sourceType: 'salon_profile_look', salonId: id(2000 + n), publishedAt: at, lane: 'new', scope: 'local', ...overrides };
}

function rowFor(item, overrides = {}) {
  return {
    contentKey: item.contentKey, sourceType: item.sourceType, contentId: item.contentId,
    candidate: item, profileId: null, publishedAt: at, bookable: false,
    document: {
      salon_id: item.salonId, salon_name: 'Salon', city: 'Madison', state: 'WI', postal_code: '53703',
      has_public_profile: true, service_categories: ['Nails'], service_names: ['Manicure'],
      created_at: at, active_service_count: 1, starting_price: 35, profile_completeness: 60,
    },
    post: { caption: 'Current caption', authorRole: 'salon', serviceCategory: 'Nails', serviceName: 'Manicure' },
    media: [{ id: id(6000), objectPath: `${item.salonId}/looks/${item.contentId}/image.webp`, role: 'image', width: 600, height: 600 }],
    ...overrides,
  };
}

function harness(handler, signalsFor = () => EMPTY) {
  const calls = [], selectedIds = [], statusIds = [];
  const client = { rpc(name, args) {
    const call = { name, args, signal: null }; calls.push(call);
    const response = Promise.resolve().then(() => handler(name, args));
    return {
      abortSignal(signal) { call.signal = signal; return response; },
      then(resolve, reject) { return response.then(resolve, reject); },
    };
  } };
  const api = moduleFrom('lib/explore-social-feed.ts', {
    '@supabase/supabase-js': { createClient: () => client },
    '@/lib/beauty-media': beautyMedia,
    '@/lib/beauty-booking-verification': beautyBooking,
    '@/lib/content-booking': contentBooking,
    '@/lib/default-nail-images': defaultImages,
    '@/lib/explore-decision-signals': {
      EMPTY_EXPLORE_DECISION_SIGNALS: EMPTY,
      exploreFeedTrustFromDecisionSignals: signals => ({ verifiedVisitCount: signals.verifiedVisitCount }),
      async getExploreDecisionSignalsBySalonId(runner, ids) {
        selectedIds.push([...ids]);
        await runner('test_selected_signals', { target_salon_ids: ids });
        return new Map(ids.map(salonId => [salonId, signalsFor(salonId)]));
      },
    },
    '@/lib/explore-feed-discovery': discovery,
    '@/lib/explore-social-feed-ranking': ranking,
    '@/lib/explore-feed-revisions': revisions,
    '@/lib/public-booking-routes': bookingRoutes,
    '@/lib/salon-operating-status': {
      async getPublicSalonOperatingStatusesBySalonId(ids, runner) {
        statusIds.push([...ids]);
        await runner('get_public_salon_operating_status_inputs', { target_salon_ids: ids });
        return new Map();
      },
      operatingStatusFromMap: () => ({ status: 'unknown' }),
    },
    '@/lib/salon-profile': salonMedia,
  });
  return { api, calls, selectedIds, statusIds };
}

test('first page persists a bounded queue and hydrates only12 selected items with actor, filters and abort signal', async () => {
  const candidates = Array.from({ length: 30 }, (_, n) => candidate(n + 1));
  const pool = { asOf: at, region: { kind: 'state', state: 'WI' }, seed: 'stable', seenKeys: [], weights: {}, lanes: { new: candidates, trending: [], personal: [], expanded: [] } };
  const h = harness((name, args) => ({ error: null, data: name === 'get_explore_social_candidate_pool' ? pool
    : name === 'create_explore_social_feed_session' ? { id: session }
    : name === 'get_explore_social_feed_page' ? { keys: candidates.slice(0, 12), cursor: { version: 1, session, after: 12 }, hasMore: true, asOf: at }
    : name === 'hydrate_explore_social_feed_items' ? candidates.filter(c => args.p_keys.includes(c.contentKey)).map(c => rowFor(c))
    : [] }));
  const controller = new AbortController();
  const input = { visitorKey: actor, discovery: { location: ' WI ', category: ' Nails ', strictLocation: true }, signal: controller.signal };
  const page = await h.api.getExploreSocialFeedPage(input);
  assert.equal(page.items.length, 12);
  assert.equal(page.hasMore, true);
  assert.equal(page.scope, 'local');
  assert.deepEqual(plain(h.api.decodeExploreSocialFeedCursor(page.nextCursor)), { version: 1, session, after: 12 });
  const create = h.calls.find(c => c.name === 'create_explore_social_feed_session');
  assert.equal(create.args.p_queue.length, 30);
  assert.equal(create.args.p_actor_key, actor);
  assert.equal(create.args.p_filters.location, 'WI');
  assert.equal(create.args.p_filters.category, 'Nails');
  const selected = h.calls.find(c => c.name === 'hydrate_explore_social_feed_items');
  assert.equal(selected.args.p_keys.length, 12);
  assert.equal(h.calls.find(c => c.name === 'get_explore_social_feed_page').args.p_limit, 12);
  assert.equal(h.calls.every(c => c.signal === controller.signal), true);
  assert.equal(h.selectedIds[0].length, 12);
  assert.deepEqual(h.selectedIds, h.statusIds);
  assert.ok(page.items.every(item => item.discoveryScope === 'local' && item.media.length === 1));
});

test('a small startup batch and larger continuation preserve the same ranked queue and exact cursor', async () => {
  const candidates = Array.from({ length: 24 }, (_, n) => candidate(n + 1));
  const pool = { asOf: at, region: {}, seed: 'stable', seenKeys: [], weights: {}, lanes: { new: candidates, trending: [], personal: [], expanded: [] } };
  const h = harness((name, args) => ({ error: null, data: name === 'get_explore_social_candidate_pool' ? pool
    : name === 'create_explore_social_feed_session' ? { id: session }
    : name === 'get_explore_social_feed_page' ? { keys: candidates.slice(args.p_cursor.after, args.p_cursor.after + args.p_limit), cursor: { version: 1, session, after: args.p_cursor.after + args.p_limit }, hasMore: true, asOf: at }
    : name === 'hydrate_explore_social_feed_items' ? candidates.filter(candidate => args.p_keys.includes(candidate.contentKey)).map(candidate => rowFor(candidate)) : [] }));
  const first = await h.api.getExploreSocialFeedPage({ visitorKey: actor, limit: 4 });
  const next = await h.api.getExploreSocialFeedPage({ visitorKey: actor, cursor: first.nextCursor, limit: 999 });
  assert.equal(first.items.length, 4);
  assert.equal(next.items.length, 12);
  assert.equal(new Set([...first.items, ...next.items].map(item => item.contentKey)).size, 16);
  assert.deepEqual(plain(h.api.decodeExploreSocialFeedCursor(next.nextCursor)), { version: 1, session, after: 16 });
  assert.deepEqual(h.calls.filter(call => call.name === 'get_explore_social_feed_page').map(call => call.args.p_limit), [4, 12]);
  assert.equal(h.calls.filter(call => call.name === 'create_explore_social_feed_session').length, 1);
});

test('continuation forwards its frozen cursor and retains database error codes without restarting a session', async () => {
  for (const code of ['57014', '22023']) {
    const h = harness(() => ({ data: null, error: { code } }));
    await assert.rejects(h.api.getExploreSocialFeedPage({ visitorKey: actor, cursor: cursor(12), discovery: { category: 'Nails' } }), error => error.code === code);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'get_explore_social_feed_page');
    assert.equal(h.calls[0].args.p_actor_key, actor);
    assert.equal(h.calls[0].args.p_cursor.after, 12);
    assert.equal(h.calls[0].args.p_filters.category, 'Nails');
  }
  const h = harness(() => { throw new Error('aborted request must not execute RPC'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.api.getExploreSocialFeedPage({ visitorKey: actor, cursor: cursor(0), signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.api.getExploreSocialFeedPage({ visitorKey: 'user:forged', cursor: cursor(0) }), /Invalid discovery session/);
  assert.throws(() => h.api.decodeExploreSocialFeedCursor(cursor(385)), /Invalid discovery cursor/);
  const during = new AbortController();
  const interrupted = harness(() => { during.abort(); return { data: null, error: { code: 'aborted' } }; });
  await assert.rejects(interrupted.api.getExploreSocialFeedPage({ visitorKey: actor, cursor: cursor(0), signal: during.signal }), error => error.name === 'AbortError');
  assert.equal(interrupted.calls.length, 1);
});

test('cache validation rehydrates current payloads in20-item chunks and preserves original local lane and scope', async () => {
  const candidates = Array.from({ length: 23 }, (_, n) => candidate(n + 1, { lane: 'trending', score: 9 }));
  const h = harness((name, args) => ({ error: null, data: name === 'validate_explore_social_feed_items' ? args.p_keys.filter(key => key !== candidates[22].contentKey)
    : name === 'hydrate_explore_social_feed_items' ? candidates.filter(c => args.p_keys.includes(c.contentKey)).map(c => rowFor(c, { post: { caption: 'Edited caption', serviceCategory: 'Nails' } })) : [] }));
  const page = await h.api.validateExploreSocialFeedItems({ visitorKey: actor, cursor: cursor(23), contentKeys: [...candidates.map(c => c.contentKey), candidates[0].contentKey] });
  assert.equal(page.items.length, 22);
  assert.equal(page.contentKeys.includes(candidates[22].contentKey), false);
  assert.deepEqual(h.calls.filter(c => c.name === 'hydrate_explore_social_feed_items').map(c => c.args.p_keys.length), [20, 2]);
  assert.ok(page.items.every(item => item.caption === 'Edited caption' && item.discoveryScope === 'local' && item.rankingSignals.engagementVelocityScore === .9));
  assert.ok(h.selectedIds.every(ids => ids.length <= 20));
});

test('validation reuses unchanged device payloads only after live viewer/visibility checks; edits and removed items never restore', async () => {
  const candidates = [candidate(1), candidate(2), candidate(3)];
  let removed = false, edited = false;
  const h = harness((name, args) => ({ error: null, data: name === 'validate_explore_social_feed_items' ? args.p_keys.filter(key => !removed || key !== candidates[2].contentKey)
    : name === 'hydrate_explore_social_feed_items' ? candidates.filter(c => args.p_keys.includes(c.contentKey)).map(c => rowFor(c, { post: { caption: edited && c === candidates[1] ? 'Updated caption' : 'Original caption', serviceCategory: 'Nails' } })) : [] }));
  const input = { visitorKey: actor, cursor: cursor(3), contentKeys: candidates.map(c => c.contentKey) };
  const original = await h.api.validateExploreSocialFeedItems(input);
  const known = await revisions.exploreFeedRevisions(original.items);
  const unchanged = await h.api.validateExploreSocialFeedItems({ ...input, revisions: known });
  assert.equal(unchanged.items.length, 0);
  assert.deepEqual(plain(unchanged.unchangedKeys), input.contentKeys);
  assert.equal(h.calls.filter(call => call.name === 'validate_explore_social_feed_items').length, 2);
  assert.ok(h.calls.every(call => !call.args.p_actor_key || call.args.p_actor_key === actor));
  edited = true; removed = true;
  const delta = await h.api.validateExploreSocialFeedItems({ ...input, revisions: known });
  assert.equal(delta.items.length, 1);
  assert.equal(delta.items[0].caption, 'Updated caption');
  const retained = revisions.retainValidatedExploreItems(original.items, delta, known);
  assert.equal(retained.length, 2);
  assert.equal(retained[0], original.items[0]);
  assert.equal(retained[1].caption, 'Updated caption');
});

test('all action/display changes invalidate a cached revision; ranking time decay does not', async () => {
  const item = { contentKey: 'beauty_post:test', author: { name: 'Customer' }, booking: { eligible: true, href: '/book/test' }, bookingMeta: { price: 35 }, media: [{ imageUrl: '/image.webp' }], saveTarget: { saved: false }, rankingSignals: { freshnessScore: .5 } };
  const digest = value => revisions.serializeExploreFeedItem(value);
  assert.equal(digest(item), digest({ ...item, rankingSignals: { freshnessScore: .4 } }));
  for (const changed of [
    { ...item, author: { name: 'New attribution' } }, { ...item, booking: { eligible: false, href: null } },
    { ...item, bookingMeta: { price: 45 } }, { ...item, media: [{ imageUrl: '/edited.webp' }] }, { ...item, saveTarget: { saved: true } },
  ]) assert.notEqual(digest(item), digest(changed));
  assert.equal(digest({ author: item.author, contentKey: item.contentKey }), digest({ contentKey: item.contentKey, author: item.author }));
  const forged = revisions.retainValidatedExploreItems([item], { contentKeys: [item.contentKey], unchangedKeys: [item.contentKey], items: [] }, []);
  assert.equal(forged.length, 0, 'an unrequested unchanged key cannot restore unvalidated local data');
  const oldServer = revisions.retainValidatedExploreItems([item], { contentKeys: [item.contentKey], items: [{ ...item, bookingMeta: { price: 45 } }] }, []);
  assert.equal(oldServer[0].bookingMeta.price, 45, 'older servers still supply authoritative payloads');
});

test('personal before/after media rejects unsafe paths and URLs and booking follows current eligibility', async () => {
  const personal = candidate(1, { sourceType: 'beauty_post', contentKey: `beauty_post:${id(1)}`, lane: 'personal' });
  let bookable = false;
  const h = harness(name => ({ error: null, data: name === 'get_explore_social_feed_page'
    ? { keys: [personal], cursor: { version: 1, session, after: 1 }, hasMore: false }
    : name === 'hydrate_explore_social_feed_items' ? [rowFor(personal, {
      sourceType: 'beauty_post', profileId: id(7000), bookable,
      post: { postType: 'before_after', verificationState: 'verified', authorName: 'Customer', avatarUrl: 'javascript:alert(1)' },
      media: [
        { id: id(6100), objectPath: `${id(7000)}/beauty/before/before.webp`, bucket: 'beauty-profile-media', role: 'before', width: 300, height: 600 },
        { id: id(6101), objectPath: `${id(7000)}/beauty/after/after.webp`, bucket: 'beauty-profile-media', role: 'after', width: 300, height: 600 },
        { id: id(6102), objectPath: '../private.webp', role: 'image' },
      ],
    })] : [] }));
  const input = { visitorKey: actor, cursor: cursor(0) };
  let page = await h.api.getExploreSocialFeedPage(input);
  let item = page.items[0];
  assert.equal(item.personal.postType, 'before_after');
  assert.equal(item.author.kind, 'person');
  assert.equal(item.author.avatarUrl, null);
  assert.deepEqual(plain(item.media.map(media => media.role)), ['before', 'after']);
  assert.ok(item.media.every(media => media.aspectRatio === .5 && media.layoutVariant === 'portrait'));
  assert.equal(item.booking, null);
  bookable = true;
  page = await h.api.getExploreSocialFeedPage(input); item = page.items[0];
  assert.equal(item.booking.eligible, true);
  assert.match(item.booking.href, new RegExp(`^/book/${personal.salonId}\\?inspiration=${personal.contentId}&source=explore$`));
});

test('salon attribution and booking require canonical gates and safe salon-relative routes', async () => {
  const look = candidate(2);
  let bookingEnabled = true, href = `/book/${look.salonId}`, role = 'staff';
  const h = harness(name => ({ error: null, data: name === 'get_explore_social_feed_page'
    ? { keys: [look], cursor: { version: 1, session, after: 1 }, hasMore: false }
    : name === 'hydrate_explore_social_feed_items' ? [rowFor(look, {
      bookable: true, post: { authorRole: role, authorName: 'Professional', authorStaffId: id(8000), serviceName: 'Manicure' },
      booking: { content_id: look.contentId, source_type: look.sourceType, content_type: 'look', salon_id: look.salonId,
        booking_cta_enabled: true, booking_enabled: bookingEnabled, booking_href: href, primary_service_id: id(9000), primary_service_name: 'Manicure' },
    })] : [] }));
  const input = { visitorKey: actor, cursor: cursor(0) };
  let item = (await h.api.getExploreSocialFeedPage(input)).items[0];
  assert.equal(item.salonAuthorRole, 'staff');
  assert.equal(item.salonAuthorName, 'Professional');
  assert.equal(item.booking.eligible, true);
  role = 'owner';
  item = (await h.api.getExploreSocialFeedPage(input)).items[0];
  assert.equal(item.salonAuthorName, 'Professional');
  assert.equal(item.salonAuthorStaffId, null);
  bookingEnabled = false; role = 'salon';
  item = (await h.api.getExploreSocialFeedPage(input)).items[0];
  assert.equal(item.booking.eligible, false); assert.equal(item.booking.href, null);
  assert.equal(item.salonAuthorName, null); assert.equal(item.salonAuthorStaffId, null);
  bookingEnabled = true; href = 'https://untrusted.example/book';
  item = (await h.api.getExploreSocialFeedPage(input)).items[0];
  assert.equal(item.booking.eligible, false); assert.equal(item.booking.href, null);
});

test('event and freshness requests preserve actor binding and only accept meaningful-view thresholds', async () => {
  const h = harness((name, args) => ({ error: null, data: name === 'record_explore_social_events' ? args.p_events.length : { hasNewPosts: true, newestPublishedAt: at } }));
  const key = candidate(1).contentKey;
  const result = await h.api.recordExploreSocialEvents({ visitorKey: actor, cursor: cursor(12), events: [
    { contentKey: key, kind: 'meaningful_view', elapsedMs: 1999, visibleRatio: .8 },
    { contentKey: key, kind: 'meaningful_view', elapsedMs: 2000, visibleRatio: .5 },
    { contentKey: key, kind: 'share' },
    { contentKey: key, kind: 'meaningful_view', elapsedMs: 2000, visibleRatio: 2 },
    { contentKey: key, kind: 'unknown' },
  ] });
  assert.equal(result.accepted, 2);
  assert.equal(h.calls[0].args.p_actor_key, actor);
  assert.deepEqual(plain(h.calls[0].args.p_events.map(event => event.kind)), ['meaningful_view', 'share']);
  const updates = await h.api.getExploreSocialFeedUpdates({ visitorKey: actor, cursor: cursor(12), discovery: { intent: 'latest', location: '53703' } });
  assert.equal(updates.hasNewPosts, true);
  assert.equal(h.calls.at(-1).args.p_cursor.after, 12);
  assert.equal(h.calls.at(-1).args.p_filters.intent, 'latest');
  assert.equal(h.calls.at(-1).args.p_filters.location, '53703');
});
