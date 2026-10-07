import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function compile(path, require) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require, Buffer, console });
  return exports;
}
const helpers = compile("lib/explore-feed-discovery.ts", () => ({}));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function salon(n, overrides = {}) {
  return { id: id(n), name: `Salon ${n}`, hasPublicProfile: true,
    coverImageUrl: "/test.jpg", latestMediaCreatedAt: null,
    averageRating: null, sharedExperienceCount: 0, uniqueCustomerCount: 0,
    verifiedVisitCount: 0, completedBookingCount: 0, reputationNoIssueRate: null,
    serviceCategories: ["Nails"], serviceNames: ["Manicure"],
    featuredServiceCategory: "Nails", featuredServiceName: "Manicure",
    distanceMiles: n, bookingEnabled: false, bookingHref: null,
    bookableServiceId: null, bookableServiceName: null, startingPrice: 35,
    nextAvailabilityLabel: null, city: "Chicago", state: "IL",
    operatingStatus: { isOpen: false }, ...overrides };
}
function harness(salons, { failOnce = false, personalItems = [] } = {}) {
  const calls = [];
  const empty = { error: null, items: [], hasMore: false, nextCursor: null };
  const service = compile("lib/explore-feed.ts", name => {
    if (name === "node:buffer") return { Buffer };
    if (name === "@/lib/explore-feed-discovery") return helpers;
    if (name === "@/lib/explore-home") return { getExploreHomeContent: async () => ({ error: null, recommendedSalons: [], newSalons: [], inspiration: empty }) };
    if (name === "@/lib/explore-inspiration") return { getExploreInspirationPage: async () => empty };
    if (name === "@/lib/explore-personal") return { getExplorePersonalPostPage: async input => {
      const eligible = [...personalItems].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)).filter(item => !input.cursor || item.publishedAt < input.cursor.createdAt || (item.publishedAt === input.cursor.createdAt && item.id < input.cursor.postId));
      const items = eligible.slice(0, input.pageSize);
      return { ...empty, items, hasMore: eligible.length > items.length };
    } };
    if (name === "@/lib/explore-search") return { searchExploreSalons: async input => {
      calls.push(input);
      if (failOnce) { failOnce = false; return { error: "Temporarily unavailable" }; }
      const results = salons.filter(s => (!input.location || s.city === input.location) &&
        (!input.category || s.serviceCategories.includes(input.category)));
      return { error: null, totalCount: results.length, results: results.slice((input.page - 1) * input.pageSize, input.page * input.pageSize) };
    } };
    return {};
  });
  return { ...service, calls };
}
async function collect(service, discovery) {
  let cursor = null;
  const items = [], cursors = new Set();
  for (let i = 0; i < 30; i++) {
    const page = await service.getExploreFeedPage({ cursor, discovery });
    assert.equal(page.error, null);
    items.push(...page.items);
    if (!page.hasMore) return items;
    assert.ok(page.nextCursor);
    assert.ok(!cursors.has(page.nextCursor), "every page must advance even when its visible items are empty");
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
  assert.fail("pagination did not terminate");
}

test("directory pagination reaches every salon across partially consumed batches without repetition", async () => {
  const service = harness(Array.from({ length: 61 }, (_, i) => salon(i + 1)));
  const items = await collect(service, { category: "Nails" });
  assert.equal(items.length, 61);
  assert.equal(new Set(items.map(item => item.feedKey)).size, 61);
  assert.ok(service.calls.some(call => call.page === 3));
});
test("salons without usable images advance the cursor instead of ending the whole feed", async () => {
  const service = harness(Array.from({ length: 51 }, (_, i) => salon(i + 1, { coverImageUrl: i < 24 ? null : "/test.jpg" })));
  const first = await service.getExploreFeedPage({ discovery: {} });
  assert.equal(first.items.length, 0);
  assert.equal(first.hasMore, true);
  assert.equal((await collect(service, {})).length, 27);
});
test("automatic expansion labels broader results and keeps the selected category", async () => {
  const service = harness([salon(1), salon(2, { city: "Milwaukee" }), salon(3, { city: "Milwaukee", serviceCategories: ["Hair"] })]);
  const items = await collect(service, { location: "Chicago", category: "Nails" });
  assert.ok(items.some(item => item.salon.city === "Milwaukee" && item.discoveryScope === "wider"));
  assert.ok(items.every(item => item.serviceCategory === "Nails"));
});
test("explicit location does not silently expand beyond the requested area", async () => {
  const service = harness([salon(1), salon(2, { city: "Milwaukee" })]);
  const items = await collect(service, { location: "Chicago", strictLocation: true });
  assert.equal(items.length, 1);
  assert.ok(service.calls.every(call => call.location === "Chicago"));
});
test("directory failure is retryable and does not masquerade as exhaustion", async () => {
  const service = harness([salon(1)], { failOnce: true });
  const failed = await service.getExploreFeedPage({ discovery: {} });
  assert.equal(failed.error, "Temporarily unavailable");
  assert.equal((await service.getExploreFeedPage({ discovery: {} })).items.length, 1);
});
test("category and strict location reject unrelated organic content", () => {
  const item = { serviceCategory: "Hair", serviceName: "Cut", salon: { city: "Milwaukee", state: "WI" } };
  assert.equal(helpers.matchesExploreFeedItem(item, { category: "Nails" }), false);
  assert.equal(helpers.matchesExploreFeedItem(item, { location: "Chicago", strictLocation: true }), false);
  assert.equal(helpers.matchesExploreFeedItem(item, { location: "Milwaukee, WI", strictLocation: true }), true);
});

function clientHarness() {
  const exports = {}, stored = new Map();
  const source = readFileSync("app/explore/explore-feed.tsx", "utf8") + "\nexport { appendUniqueFeedItems, readStoredFeedState, writeStoredFeedState };";
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports,
    window: { scrollY: 1600, sessionStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } },
    require: name => name === "@/lib/explore-feed-discovery" ? helpers : {},
  });
  return exports;
}
const feedItem = (key, author, href = `/posts/${key}`) => ({ feedKey: key, contentId: key, publishedAt: "2026-10-06", author: { id: author, name: author }, sourceType: "salon", contentType: "look", media: [{ imageUrl: "/test.jpg" }], destination: { type: "salon-post", href } });
test("appended batches dedupe shared post destinations and vary authors across page boundaries", () => {
  const client = clientHarness();
  const initial = [feedItem("a", "salon-a")];
  const result = client.appendUniqueFeedItems(initial, [feedItem("recommendation-a", "salon-a", "/posts/a"), feedItem("b", "salon-a"), feedItem("c", "salon-b"), feedItem("c", "salon-b")]);
  assert.deepEqual(Array.from(result, item => item.feedKey), ["a", "c", "b"]);
});
test("desktop, mobile and filter sessions preserve independent cursors and scroll positions", () => {
  const client = clientHarness();
  const items = [feedItem("a", "salon-a")];
  for (const route of ["/explore#desktop:all", "/explore#mobile:all", "/explore#desktop:nails"]) {
    client.writeStoredFeedState({ items, route, viewerId: null, cursor: route, hasMore: true });
  }
  for (const route of ["/explore#desktop:all", "/explore#mobile:all", "/explore#desktop:nails"]) {
    const restored = client.readStoredFeedState(route, "a", null);
    assert.equal(restored.cursor, route);
    assert.equal(restored.scrollY, 1600);
  }
});
test("discovery requests normalize unexpected action arguments", () => {
  const options = helpers.normalizeExploreFeedDiscoveryOptions({ category: 42, location: [], latitude: Infinity, longitude: 500, strictLocation: "yes" });
  assert.equal(options.category, ""); assert.equal(options.location, "");
  assert.equal(options.latitude, null); assert.equal(options.longitude, null); assert.equal(options.strictLocation, false);
});
test("undated directory entries do not pretend to have a publication date", async () => {
  const service = harness([salon(1)]);
  const page = await service.getExploreFeedPage({ discovery: {} });
  assert.equal(page.items[0].publishedAtKnown, false);
});

test("mixed ranking never advances a personal cursor past unseen posts", async () => {
  const personalItems = Array.from({ length: 55 }, (_, i) => ({
    ...feedItem(`personal:${i}`, `person:${i}`), id: id(i + 500), sourceSortId: id(i + 500),
    sourceType: "personal", contentType: "beauty_post", personal: { profileId: id(i + 1000), postType: "look" },
    publishedAt: new Date(Date.UTC(2026, 9, 6, 0, i)).toISOString(),
    serviceCategory: "Nails", serviceName: i % 2 ? "Manicure" : null,
    rankingSignals: {}, media: [{ id: `${i}`, imageUrl: "/test.jpg", role: "image" }],
  }));
  const service = harness(Array.from({ length: 61 }, (_, i) => salon(i + 1)), { personalItems });
  const items = await collect(service, { category: "Nails" });
  assert.equal(items.filter(item => item.sourceType === "personal").length, 55);
  assert.equal(new Set(items.map(item => item.feedKey)).size, 116);
});
