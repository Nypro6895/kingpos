import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync("lib/explore-social-feed-ranking.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const { buildExploreSocialFeedQueue: build } = exports;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const candidate = (n, lane, overrides = {}) => ({ contentId: id(n), contentKey: `salon_profile_look:${id(n)}`, sourceType: "salon_profile_look", salonId: id(n + 2000), publishedAt: `2026-10-08T${String(n % 24).padStart(2, "0")}:00:00Z`, lane, scope: "local", ...overrides });
const pool = overrides => ({ asOf: "2026-10-09T00:00:00Z", region: { kind: "state", state: "WI" }, seed: "first", weights: { trending: .35, new: .30, personal: .20, expanded: .15 }, seenKeys: [], lanes: { trending: [], new: [], personal: [], expanded: [] }, ...overrides });

test("weighted lanes keep35/30/20/15 with distinct supplies and stable session order", () => {
  const lanes = Object.fromEntries(["trending", "new", "personal", "expanded"].map((lane, index) => [lane, Array.from({ length: 120 }, (_, n) => candidate(index * 120 + n + 1, lane))]));
  const result = build(pool({ lanes }), "discover", 100);
  assert.deepEqual(Object.fromEntries(Object.keys(lanes).map(lane => [lane, result.filter(row => row.lane === lane).length])), { trending: 35, new: 30, personal: 20, expanded: 15 });
  assert.equal(JSON.stringify(result), JSON.stringify(build(pool({ lanes }), "discover", 100)));
});
test("short lanes redistribute without blank slots or duplicate content", () => {
  const lanes = { trending: [candidate(1, "trending")], new: Array.from({ length: 25 }, (_, n) => candidate(n + 1, "new")), personal: [], expanded: [] };
  const result = build(pool({ lanes }), "discover", 20);
  assert.equal(result.length, 20);
  assert.equal(new Set(result.map(row => row.contentKey)).size, 20);
});
test("recent meaningful views are delayed until unseen candidates are exhausted", () => {
  const lanes = { trending: [], new: [candidate(1, "new"), candidate(2, "new"), candidate(3, "new")], personal: [], expanded: [] };
  const result = build(pool({ lanes, seenKeys: [candidate(1, "new").contentKey] }));
  assert.deepEqual(Array.from(result, row => row.contentId), [id(3), id(2), id(1)]);
});
test("newest local post leads; salon variety remains best effort within the active priority tier", () => {
  const lanes = { trending: [], new: [candidate(1, "new", { salonId: id(9) }), candidate(2, "new", { salonId: id(9) }), candidate(3, "new", { salonId: id(8) })], personal: [], expanded: [] };
  assert.deepEqual(Array.from(build(pool({ lanes })), row => row.contentId), [id(3), id(2), id(1)]);
});
test("latest begins with newest local posts before wider results and directory cards", () => {
  const lanes = { trending: [], new: [candidate(2, "new"), candidate(1, "new")], personal: [], expanded: [candidate(23, "expanded", { scope: "wider" }), candidate(8, "expanded", { sourceType: "directory", contentKey: `directory:${id(8)}`, publishedAt: null })] };
  assert.deepEqual(Array.from(build(pool({ lanes }), "latest"), row => row.contentId), [id(2), id(1), id(23), id(8)]);
});
test("seed changes bounded directory variation, preserving local before wider", () => {
  const expanded = Array.from({ length: 30 }, (_, n) => candidate(n + 1, "expanded", { sourceType: "directory", contentKey: `directory:${id(n + 1)}`, publishedAt: null, scope: n < 20 ? "local" : "wider" }));
  const base = pool({ lanes: { trending: [], new: [], personal: [], expanded } });
  const first = build(base), second = build({ ...base, seed: "second" });
  assert.notEqual(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.slice(0, 20).every(row => row.scope === "local"), true);
});
test("invalid keys and timestamps cannot enter a persisted queue; hard cap384", () => {
  const lanes = { trending: [], personal: [], expanded: [], new: [candidate(1, "new", { contentKey: "bad" }), candidate(2, "new", { publishedAt: "bad" }), ...Array.from({ length: 500 }, (_, n) => candidate(n + 3, "new"))] };
  assert.equal(build(pool({ lanes }), "discover", 1000).length, 384);
});
test("explicit latest keeps chronology when one salon posted the most recent posts", () => {
  const lanes = { trending: [], personal: [], expanded: [], new: [candidate(1, "new"), candidate(2, "new", { salonId: id(9) }), candidate(3, "new", { salonId: id(9) })] };
  assert.deepEqual(Array.from(build(pool({ lanes }), "latest"), row => row.contentId), [id(3), id(2), id(1)]);
});
test("zero quota disables that lane and all zero quotas end gracefully", () => {
  const lanes = { trending: [candidate(1, "trending")], new: [candidate(2, "new")], personal: [], expanded: [] };
  assert.deepEqual(Array.from(build(pool({ lanes, weights: { trending: 0, new: 1, personal: 0, expanded: 0 } })), row => row.contentId), [id(2)]);
  assert.equal(build(pool({ lanes, weights: { trending: 0, new: 0, personal: 0, expanded: 0 } })).length, 0);
});
test("missing personalization redistributes its quota across available lanes", () => {
  const lanes = { trending: Array.from({ length: 100 }, (_, n) => candidate(n + 1, "trending")), new: Array.from({ length: 100 }, (_, n) => candidate(n + 101, "new")), personal: [], expanded: Array.from({ length: 100 }, (_, n) => candidate(n + 201, "expanded")) };
  const result = build(pool({ lanes }), "discover", 100);
  assert.equal(result.length, 100);
  assert.ok(Math.abs(result.filter(row => row.lane === "trending").length - 43.75) <= 1);
  assert.ok(Math.abs(result.filter(row => row.lane === "new").length - 37.5) <= 1);
  assert.ok(Math.abs(result.filter(row => row.lane === "expanded").length - 18.75) <= 1);
});

test("keyword searches prioritize local relevance over lane quotas, seen history and wider trending", () => {
  const strongest = candidate(1, 'new', { matchScore: 1, salonId: id(99) });
  const second = candidate(2, 'new', { matchScore: .8, salonId: id(99) });
  const weaker = candidate(3, 'personal', { matchScore: .1 });
  const wider = candidate(4, 'trending', { scope: 'wider', matchScore: 10, score: 100 });
  const source = pool({ seenKeys: [strongest.contentKey], lanes: { new: [second, strongest], personal: [weaker], trending: [wider, {...strongest, lane:'trending'}], expanded: [] } });
  const result = build(source, 'discover', 384, 'brown almond');
  assert.deepEqual(Array.from(result, row => row.contentId), [id(1),id(2),id(3),id(4)]);
  assert.equal(build(source, 'discover', 2, 'brown almond').length, 2);
  assert.deepEqual(Array.from(build({...source,seenKeys:[]}, 'latest', 384, 'brown almond'), row => row.contentId), [id(3),id(2),id(1),id(4)]);
});
