import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function cacheHarness(blocked = false) {
  let value = null;
  const window = { scrollY: 630, sessionStorage: {
    getItem() { if (blocked) throw Error("blocked"); return value; },
    setItem(_, next) { if (blocked) throw Error("blocked"); value = next; },
    removeItem() { if (blocked) throw Error("blocked"); value = null; },
  } };
  const exports = {};
  const source = readFileSync("app/explore/explore-feed.tsx", "utf8") + "\nexport { readStoredFeedState, writeStoredFeedState, applySavedPostChange };";
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, window, require: name => name === "@/types/saved-post" ? { savedPostKey: target => `${target.sourceType}:${target.sourceId}` } : {} });
  return exports;
}
const item = { feedKey: "personal:1", contentId: "1", publishedAt: "2026-09-24", sourceType: "personal", contentType: "beauty_post", author: { name: "Test" }, media: [{ imageUrl: "/test.jpg" }] };
const state = { cursor: "page-2", hasMore: true, items: [item], viewerId: "alice", route: "/explore" };
test("save changes are persisted with the feed so back navigation restores the updated count", () => {
  const h = cacheHarness();
  const items = [{ ...item, saveTarget: { sourceType: "beauty_post", sourceId: "1", saved: false, saveCount: 2 } }];
  const updated = h.applySavedPostChange(items, { key: "beauty_post:1", saved: true, saveCount: 3 });
  h.writeStoredFeedState({ ...state, items: updated });
  const restored = h.readStoredFeedState("/explore", item.feedKey, "alice");
  assert.equal(restored.items[0].saveTarget.saved, true);
  assert.equal(restored.items[0].saveTarget.saveCount, 3);
  assert.equal(h.applySavedPostChange(updated, { key: "beauty_post:1", saved: true, saveCount: 3 }), updated);
  assert.equal(h.applySavedPostChange(updated, { key: "beauty_post:other", saved: false }), updated);
});
test("restored feed preserves scroll and cursor only for the same viewer and route", () => {
  const h = cacheHarness(); h.writeStoredFeedState(state);
  const restored = h.readStoredFeedState("/explore", item.feedKey, "alice");
  assert.equal(restored.scrollY, 630);
  assert.equal(restored.cursor, "page-2");
  assert.equal(h.readStoredFeedState("/explore", item.feedKey, "bob"), null);
  assert.equal(h.readStoredFeedState("/explore", item.feedKey, null), null);
  assert.equal(h.readStoredFeedState("/explore?q=new", item.feedKey, "alice"), null);
});
test("cache limit never pairs a truncated feed with a later cursor", () => {
  const h = cacheHarness(); h.writeStoredFeedState(state);
  h.writeStoredFeedState({ ...state, items: Array.from({ length: 121 }, (_, i) => ({ ...item, feedKey: `personal:${i}` })), cursor: "page-20" });
  const restored = h.readStoredFeedState("/explore", item.feedKey, "alice");
  assert.equal(restored.items.length, 1);
  assert.equal(restored.cursor, "page-2");
});
test("unavailable session storage never breaks feed rendering or navigation", () => {
  const h = cacheHarness(true);
  assert.doesNotThrow(() => h.writeStoredFeedState(state));
  assert.equal(h.readStoredFeedState("/explore", null, "alice"), null);
});
