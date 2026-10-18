import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const filename = path.resolve("lib/experience-resource-cache.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = {};
vm.runInNewContext(compiled, { require: name => { if(name === "./read-request-metrics") return { recordReadRequest() {}, readResourceCategory: () => "other" }; throw new Error("Unexpected cache dependency "+name); }, exports: api, Date, Map, Set, Promise, Error, TypeError, JSON, Object, Array, Math, Number, URLSearchParams, AbortController }, { filename });
const { createExperienceResourceCache, ExperienceResourceInvalidatedError, ExperienceResourceAccessError } = api;
const ctx = (scope = "account-a/salon-a/grants-v1", key = "today?date=2026-10-11") => ({ scope, key });
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("canonical keys deduplicate concurrent requests while keeping business date and account isolated", async () => {
  const cache = createExperienceResourceCache();
  const pending = deferred();
  let calls = 0;
  const fetcher = () => { calls += 1; return pending.promise; };
  const first = cache.load(ctx(undefined, "today?tab=tickets&date=2026-10-11"), fetcher);
  const duplicate = cache.load(ctx(undefined, "today?date=2026-10-11&tab=tickets"), fetcher, { force: true });
  assert.equal(first, duplicate);
  await turn();
  assert.equal(calls, 1);
  pending.resolve({ data: { tickets: ["ticket-a"] }, etag: '"a"' });
  await first;
  assert.equal(cache.get(ctx(undefined, "today?tab=tickets&date=2026-10-11")).data.tickets[0], "ticket-a");
  assert.equal(cache.get(ctx("account-b/salon-a/grants-v1", "today?tab=tickets&date=2026-10-11")), undefined);
  assert.equal(cache.get(ctx(undefined, "today?tab=tickets&date=2026-10-12")), undefined);
  assert.notEqual(api.getExperienceResourceIdentity(ctx(undefined, "x?a=1&a=2")), api.getExperienceResourceIdentity(ctx(undefined, "x?a=2&a=1")));
});

test("freshness expires before retention and a conditional 304 renews the same data reference", async () => {
  let now = 1000;
  const cache = createExperienceResourceCache({ now: () => now });
  const data = { tickets: [{ id: "one", amount: 10 }] };
  cache.seed(ctx(), data, { freshForMs: 100, retainForMs: 1000 }, now, '"revision-1"');
  let calls = 0;
  assert.equal(await cache.load(ctx(), async () => { calls += 1; return { data: {} }; }), data);
  assert.equal(calls, 0);
  now = 1100;
  assert.equal(cache.get(ctx()).fresh, false);
  const result = await cache.load(ctx(), async options => {
    calls += 1;
    assert.equal(options.etag, '"revision-1"');
    assert.equal(options.cached, data);
    return { notModified: true };
  }, { freshForMs: 100, retainForMs: 1000 });
  assert.equal(result, data);
  assert.equal(cache.get(ctx()).data, data);
  assert.equal(cache.get(ctx()).updatedAt, 1100);
  assert.equal(cache.get(ctx()).fresh, true);
  now = 2100;
  assert.equal(cache.get(ctx()), undefined);
  assert.equal(cache.stats().bytes, 0);
});

test("tag invalidation retains the view, aborts only affected requests and blocks late ignored-abort responses", async () => {
  const cache = createExperienceResourceCache();
  const ticket = ctx(undefined, "today/tickets");
  const catalog = ctx(undefined, "catalog");
  cache.seed(ticket, { count: 1 }, { tags: ["tickets"] });
  cache.seed(catalog, { name: "service" }, { tags: ["catalog"] });
  const pending = deferred();
  let signal;
  const oldRequest = cache.load(ticket, async options => { signal = options.signal; return pending.promise; }, { force: true, tags: ["tickets"] });
  await turn();
  cache.invalidate({ scope: ticket.scope, tags: ["tickets"] });
  await assert.rejects(oldRequest, ExperienceResourceInvalidatedError);
  assert.equal(signal.aborted, true);
  assert.equal(cache.get(ticket).data.count, 1);
  assert.equal(cache.get(ticket).fresh, false);
  assert.equal(cache.get(catalog).fresh, true);
  await cache.load(ticket, async () => ({ data: { count: 2 } }), { tags: ["tickets"] });
  pending.resolve({ data: { count: 999 } });
  await turn();
  assert.equal(cache.get(ticket).data.count, 2);
});

test("scope reset isolates other accounts and invalidates requests that finish after a new context", async () => {
  const cache = createExperienceResourceCache();
  const first = ctx("account-a/salon-a/grants-v1");
  const other = ctx("account-b/salon-b/grants-v2");
  cache.seed(first, { private: "a" });
  cache.seed(other, { private: "b" });
  const pending = deferred();
  const request = cache.load(first, () => pending.promise, { force: true });
  await turn();
  cache.reset(first.scope);
  await assert.rejects(request, ExperienceResourceInvalidatedError);
  assert.equal(cache.get(first), undefined);
  assert.equal(cache.get(other).data.private, "b");
  cache.seed(first, { private: "a-new" });
  pending.resolve({ data: { private: "a-old" } });
  await turn();
  assert.equal(cache.get(first).data.private, "a-new");
});

test("logout suspension refuses seed, reads and fetches until validated resume; stale errors cannot revoke the new session", async () => {
  const cache = createExperienceResourceCache();
  cache.seed(ctx(), { amount: 10 });
  const pending = deferred();
  const old = cache.load(ctx(), () => pending.promise, { force: true });
  await turn();
  cache.suspend();
  await assert.rejects(old, ExperienceResourceInvalidatedError);
  assert.equal(cache.seed(ctx(), { amount: 999 }), false);
  assert.equal(cache.get(ctx()), undefined);
  let fetched = false;
  await assert.rejects(cache.load(ctx(), async () => { fetched = true; return { data: {} }; }), ExperienceResourceInvalidatedError);
  assert.equal(fetched, false);
  cache.resume();
  await cache.load(ctx(), async () => ({ data: { amount: 20 } }));
  pending.reject(new ExperienceResourceAccessError(401));
  await turn();
  assert.equal(cache.isAvailable(ctx()), true);
  assert.equal(cache.get(ctx()).data.amount, 20);
});

test("live authorization failure removes the entire scope and stops active hooks from refetching it", async () => {
  const cache = createExperienceResourceCache();
  cache.seed(ctx(), { amount: 10 });
  cache.seed(ctx(undefined, "my-work"), { appointments: ["private"] });
  cache.seed(ctx("other-account"), { amount: 30 });
  await assert.rejects(cache.load(ctx(), async () => { throw new ExperienceResourceAccessError(403); }, { force: true }));
  assert.equal(cache.isAvailable(ctx()), false);
  assert.equal(cache.get(ctx()), undefined);
  assert.equal(cache.get(ctx(undefined, "my-work")), undefined);
  assert.equal(cache.get(ctx("other-account")).data.amount, 30);
  await assert.rejects(cache.load(ctx(), async () => ({ data: { amount: 999 } })), ExperienceResourceInvalidatedError);
  cache.resume(ctx().scope);
  assert.equal(cache.get(ctx()), undefined);
});

test("newer authorized SSR seed supersedes old requests; old seed cannot overwrite a live result", async () => {
  let now = 1000;
  const cache = createExperienceResourceCache({ now: () => now });
  cache.seed(ctx(), { count: 1 }, {}, now);
  const pending = deferred();
  const request = cache.load(ctx(), () => pending.promise, { force: true });
  await turn();
  assert.equal(cache.seed(ctx(), { count: 0 }, {}, 900), false);
  now = 1100;
  cache.seed(ctx(), { count: 3 }, {}, now);
  await assert.rejects(request, ExperienceResourceInvalidatedError);
  assert.equal(cache.seed(ctx(), { count: 0 }, {}, 1000), false);
  pending.resolve({ data: { count: 2 } });
  await turn();
  assert.equal(cache.get(ctx()).data.count, 3);
});

test("after resume, repeated old initial props cannot cancel the first live request without a cached entry", async () => {
  let now = 1000;
  const cache = createExperienceResourceCache({ now: () => now });
  cache.suspend();
  cache.resume();
  const pending = deferred();
  let signal;
  const request = cache.load(ctx(), options => { signal = options.signal; return pending.promise; });
  await turn();
  now = 1100;
  assert.equal(cache.seed(ctx(), { count: 0 }, {}, 900), false);
  assert.equal(signal.aborted, false);
  pending.resolve({ data: { count: 3 } });
  assert.equal((await request).count, 3);
  assert.equal(cache.get(ctx()).data.count, 3);
});

test("LRU and conservative byte budget stay bounded, including oversize, cycles and never-resolving requests", async () => {
  const cache = createExperienceResourceCache({ maxEntries: 2, maxBytes: 2000 });
  cache.seed(ctx(undefined, "a"), { name: "a" });
  cache.seed(ctx(undefined, "b"), { name: "b" });
  cache.get(ctx(undefined, "a"));
  cache.seed(ctx(undefined, "c"), { name: "c" });
  assert.equal(cache.get(ctx(undefined, "b")), undefined);
  assert.equal(cache.get(ctx(undefined, "a")).data.name, "a");
  const huge = { text: "x".repeat(3000) };
  assert.equal(await cache.load(ctx(undefined, "huge"), async () => ({ data: huge })), huge);
  assert.equal(cache.get(ctx(undefined, "huge")), undefined);
  const cycle = {}; cycle.self = cycle;
  assert.equal(cache.seed(ctx(undefined, "cycle"), cycle), false);
  assert.ok(cache.stats().bytes <= 2000);
  assert.ok(cache.stats().entries <= 2);
  const waiting = () => new Promise(() => {});
  const first = cache.load(ctx(undefined, "pending-a"), waiting);
  cache.load(ctx(undefined, "pending-b"), waiting);
  cache.load(ctx(undefined, "pending-c"), waiting);
  await assert.rejects(first, ExperienceResourceInvalidatedError);
  assert.equal(cache.stats().pending, 2);
  cache.reset();
  assert.equal(cache.stats().pending, 0);
});

test("first-load invalidation notifies subscribers even without a retained entry", async () => {
  const cache = createExperienceResourceCache();
  const events = [];
  const unsubscribe = cache.subscribe(ctx(), event => events.push(event));
  const pending = deferred();
  const request = cache.load(ctx(), () => pending.promise, { tags: ["booking"] });
  await turn();
  cache.invalidate({ tags: ["booking"] });
  await assert.rejects(request, ExperienceResourceInvalidatedError);
  assert.equal(events.includes("invalidated"), true);
  unsubscribe();
  cache.reset();
  assert.equal(events.filter(event => event === "reset").length, 0);
});

test("the browser singleton never shares authorized server-render snapshots", async () => {
  assert.equal(api.experienceResourceCache.seed(ctx(), { private: "server" }), false);
  assert.equal(api.experienceResourceCache.get(ctx()), undefined);
  await assert.rejects(api.experienceResourceCache.load(ctx(), async () => ({ data: {} })), ExperienceResourceInvalidatedError);
});

test("one relationship removal cancels only its own request and preserves other authorized resources", async () => {
  const cache = createExperienceResourceCache();
  const a = ctx("same-owner", "app-local:" + JSON.stringify(["page.support-case", { query: "a?b=c&d=1" }]));
  const b = ctx("same-owner", "app-local:" + JSON.stringify(["page.support-case", { query: "a?d=1&b=c" }]));
  cache.seed(b, { unrelated: true });
  const pending = deferred();
  const request = cache.load(a, () => pending.promise);
  await turn(); cache.forget(a);
  await assert.rejects(request, ExperienceResourceInvalidatedError);
  pending.resolve({ data: { removed: true } }); await turn();
  assert.equal(cache.get(a), undefined);
  assert.equal(cache.get(b).data.unrelated, true);
  assert.equal(cache.isAvailable(b), true);
});

test("offline transport hydration cannot renew freshness and shorter observer freshness is honored", async () => {
  let now = 10000, calls = 0;
  const cache = createExperienceResourceCache({ now: () => now });
  await cache.load(ctx(), async () => ({ data: { saved: true }, validatedAt: 1000 }), { freshForMs: 3000 });
  assert.equal(cache.get(ctx()).fresh, false);
  assert.equal(cache.get(ctx()).updatedAt, 1000);
  cache.seed(ctx(), { online: true }, { freshForMs: 30000 }, now);
  now += 1000;
  await cache.load(ctx(), async () => { calls++; return { notModified: true }; }, { freshForMs: 500 });
  assert.equal(calls, 1, "a shorter caller freshness cannot reuse a longer observer's validation budget");
  assert.equal(cache.get(ctx()).data.online, true);
  await assert.rejects(cache.load(ctx(), async () => ({ data: {}, validatedAt: now + 1 }), { force: true }), /validation time/);
});

test("long native filters retain exact canonical identity without changing ordinary URL key bounds", () => {
  const cache = createExperienceResourceCache();
  const long = ctx("owner", "app-local:" + JSON.stringify(["page.explore", { text: "a?b=c".repeat(2000) }]));
  assert.equal(cache.seed(long, { value: 1 }), true);
  assert.equal(cache.get(long).data.value, 1);
  assert.throws(() => cache.get(ctx("owner", "ordinary?" + "a".repeat(5000))), /Invalid resource context/);
});

test("access-change browser events are emitted only for the current authorized request, never a late response", async () => {
  const exports = {}, events = [];
  class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  }
  vm.runInNewContext(compiled, {
    require: () => ({ recordReadRequest() {}, readResourceCategory: () => "other" }), exports, Date, Map, Set, Promise, Error, TypeError, JSON, Object, Array, Math, Number, URLSearchParams, AbortController,
    CustomEvent, window: { dispatchEvent: event => { events.push(event); return true; } },
  }, { filename });
  const cache = exports.createExperienceResourceCache();
  const late = deferred();
  const staleRequest = cache.load(ctx(), () => late.promise);
  await turn();
  cache.reset();
  await assert.rejects(staleRequest, exports.ExperienceResourceInvalidatedError);
  late.reject(new exports.ExperienceResourceAccessError(401));
  await turn();
  assert.equal(events.length, 0);
  await assert.rejects(cache.load(ctx(), async () => { throw new exports.ExperienceResourceAccessError(409); }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "reylumi:experience-access-changed");
  assert.equal(events[0].detail.scope, ctx().scope);
  assert.equal(events[0].detail.status, 409);
  assert.equal(cache.isAvailable(ctx()), false);
});


test("a seed uses the requesting observer freshness while explicit invalidation always requires validation", async () => {
  let now = 1000, calls = 0;
  const cache = createExperienceResourceCache({ now: () => now });
  cache.seed(ctx(), { config: true });
  now += 31000;
  await cache.load(ctx(), async () => { calls++; return { notModified: true }; }, { freshForMs: 60000 });
  assert.equal(calls, 0, "configuration seed remains fresh for its 60 second observer policy");
  cache.invalidate({ scope: ctx().scope });
  await cache.load(ctx(), async () => { calls++; return { notModified: true }; }, { freshForMs: 60000 });
  assert.equal(calls, 1, "authoritative invalidation beats every observer freshness policy");
});
