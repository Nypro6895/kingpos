import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

// Deterministic controller fixtures verify ordering and withdrawal, not real-world latency.
const built = buildSync({
  entryPoints: ["lib/services-catalog-controller.ts"],
  bundle: true, write: false, platform: "node", format: "esm", target: "node20",
});
const { createServicesCatalogController, SERVICES_CATALOG_ADMISSION_MS } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const partition = (letter = "a", overrides = {}) => ({
  viewerId: "viewer-one", accountId: "account-one", salonId: `salon-${letter}`,
  scope: `v3:${letter.repeat(64)}`, permissionRevision: `role-${letter}:services.view`, ...overrides,
});
const catalog = label => ({ services: [{
  id: `service-${label}`, name: `Service ${label}`, category: "Nails", description: null,
  basePrice: 25, durationMinutes: 30,
}] });
const stored = (data, updatedAt = 999_000) => ({ data, updatedAt });
const id = value => JSON.stringify(value);
function memoryStore(initial = []) {
  const records = new Map(initial.map(([key, value]) => [id(key), value]));
  const calls = { observe: [], read: [], write: [], purge: 0, removeScope: [] };
  let account;
  const store = {
    async observeAccount(viewerId, accountId) {
      calls.observe.push({ viewerId, accountId });
      const next = JSON.stringify([viewerId, accountId]);
      if (account && account !== next) records.clear();
      account = next;
    },
    async read(key) { calls.read.push(key); return records.get(id(key)) ?? null; },
    async write(key, data, updatedAt) { calls.write.push({ key, data, updatedAt }); records.set(id(key), stored(data, updatedAt)); return true; },
    async purge() { calls.purge++; records.clear(); },
    async removeScope(scope) { calls.removeScope.push(scope); for (const key of records.keys()) if (JSON.parse(key).scope === scope) records.delete(key); },
  };
  return { store, records, calls };
}
function fixture(t, options = {}) {
  let time = 1_000_000, monotonicTime = 0;
  const auth = options.partition ?? partition();
  const backing = options.backing ?? memoryStore(options.initial);
  const metrics = [], states = [], admittedSignals = [], readSignals = [];
  const controller = createServicesCatalogController({
    scope: auth.scope, store: options.store ?? backing.store,
    now: () => time, monotonic: () => monotonicTime,
    metric: value => metrics.push(value),
    admit: signal => { admittedSignals.push(signal); return options.admit ? options.admit(signal) : Promise.resolve(auth); },
    fetchFresh: (value, signal) => { readSignals.push(signal); return options.fetchFresh ? options.fetchFresh(value, signal) : Promise.resolve(catalog("fresh")); },
  });
  controller.subscribe(() => states.push(controller.getSnapshot()));
  t.after(() => controller.dispose());
  return { controller, backing, metrics, states, admittedSignals, readSignals,
    setTime: value => { monotonicTime += value - time; time = value; },
    advance: value => { time += value; monotonicTime += value; },
    setWallTime: value => { time = value; }, setMonotonicTime: value => { monotonicTime = value; },
  };
}

test("cold entry waits for fresh admission, then fetches and saves only the catalog", async t => {
  const admission = deferred(), fresh = deferred();
  const f = fixture(t, { admit: () => admission.promise, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh();
  assert.equal(f.controller.getSnapshot().phase, "checking");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.read.length, 0);
  assert.equal(f.readSignals.length, 0);
  admission.resolve(partition()); await tick();
  assert.equal(f.backing.calls.read.length, 1);
  assert.equal(f.readSignals.length, 1);
  assert.equal(f.controller.getSnapshot().data, undefined);
  fresh.resolve(catalog("cold")); await pending;
  assert.equal(f.controller.getSnapshot().phase, "fresh");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("cold"));
  assert.deepEqual(f.backing.calls.write.map(value => value.data), [catalog("cold")]);
  assert.deepEqual(f.metrics.map(value => value.name), ["admission-ready", "fresh-data-ready"]);
});

test("warm entry admits before cache render and reports cache and fresh readiness separately", async t => {
  const admission = deferred(), fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: () => admission.promise, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh();
  assert.equal(f.controller.getSnapshot().data, undefined);
  f.advance(10); admission.resolve(partition()); await tick();
  assert.equal(f.controller.getSnapshot().phase, "cache");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("saved"));
  assert.deepEqual(f.metrics.map(value => value.name), ["admission-ready", "cache-ready"]);
  f.advance(40); fresh.resolve(catalog("updated")); await pending;
  assert.equal(f.controller.getSnapshot().phase, "fresh");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("updated"));
  assert.equal(f.metrics.find(value => value.name === "cache-ready").durationMs, 10);
  assert.equal(f.metrics.find(value => value.name === "fresh-data-ready").durationMs, 50);
  assert.ok(f.metrics.every(value => Number.isFinite(value.durationMs) && value.durationMs >= 0));
});

test("fresh data is visible before a slow disk read and cannot be overwritten by it", async t => {
  const disk = deferred(), backing = memoryStore();
  const store = { ...backing.store, read: () => disk.promise };
  const f = fixture(t, { store, backing, fetchFresh: async () => catalog("network") });
  const pending = f.controller.refresh(); await tick();
  assert.equal(f.controller.getSnapshot().phase, "fresh");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("network"));
  disk.resolve(stored(catalog("obsolete-disk"))); await pending;
  assert.deepEqual(f.controller.getSnapshot().data, catalog("network"));
  assert.equal(f.states.some(state => state.phase === "cache"), false);
  assert.equal(f.metrics.some(value => value.name === "cache-ready"), false);
});

test("new controllers preserve A-B-A salon partitions while requiring a new admission on return", async t => {
  const backing = memoryStore();
  const a = fixture(t, { backing, partition: partition("a"), fetchFresh: async () => catalog("salon-a") });
  await a.controller.refresh(); a.controller.dispose();
  const b = fixture(t, { backing, partition: partition("b"), fetchFresh: async () => catalog("salon-b") });
  await b.controller.refresh(); b.controller.dispose();
  const admission = deferred(), fresh = deferred();
  const again = fixture(t, { backing, partition: partition("a"), admit: () => admission.promise, fetchFresh: () => fresh.promise });
  const pending = again.controller.refresh();
  assert.equal(again.controller.getSnapshot().data, undefined);
  admission.resolve(partition("a")); await tick();
  assert.equal(again.controller.getSnapshot().phase, "cache");
  assert.deepEqual(again.controller.getSnapshot().data, catalog("salon-a"));
  fresh.resolve(catalog("salon-a-new")); await pending;
  assert.deepEqual(backing.records.get(id(partition("b"))).data, catalog("salon-b"));
  assert.equal(backing.calls.purge, 0);
});

test("logout and relogin under another account cannot restore a previous account catalog", async t => {
  const backing = memoryStore();
  const first = fixture(t, { backing, fetchFresh: async () => catalog("account-one") });
  await first.controller.refresh(); await first.controller.invalidate(true); first.controller.dispose();
  const secondAuth = partition("b", { viewerId: "viewer-two", accountId: "account-two" }), fresh = deferred();
  const second = fixture(t, { backing, partition: secondAuth, fetchFresh: () => fresh.promise });
  const pending = second.controller.refresh(); await tick();
  assert.equal(second.controller.getSnapshot().data, undefined);
  assert.equal(backing.records.has(id(partition())), false);
  fresh.resolve(catalog("account-two")); await pending;
  assert.deepEqual(second.controller.getSnapshot().data, catalog("account-two"));
});

test("late admission after invalidation cannot read disk, fetch, display or write", async t => {
  const admission = deferred(), f = fixture(t, { admit: () => admission.promise });
  const pending = f.controller.refresh(); await f.controller.invalidate();
  assert.equal(f.admittedSignals[0].aborted, true);
  admission.resolve(partition()); await pending;
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.read.length, 0);
  assert.equal(f.readSignals.length, 0);
  assert.equal(f.backing.calls.write.length, 0);
});

test("late disk and network replies cannot repopulate an invalidated context", async t => {
  const disk = deferred(), fresh = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  await f.controller.invalidate(true);
  assert.equal(f.readSignals[0].aborted, true);
  disk.resolve(stored(catalog("late-cache"))); fresh.resolve(catalog("late-fresh")); await pending;
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(backing.calls.write.length, 0);
  assert.equal(backing.calls.purge, 1);
});

test("an older run's delayed failure does not purge or replace the current fresh run", async t => {
  const old = deferred(); let calls = 0;
  const f = fixture(t, { fetchFresh: () => ++calls === 1 ? old.promise : Promise.resolve(catalog("new-run")) });
  const previous = f.controller.refresh(); await tick();
  await f.controller.refresh();
  old.reject(Object.assign(new Error("revoked old scope"), { status: 403 })); await previous;
  assert.deepEqual(f.controller.getSnapshot().data, catalog("new-run"));
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.write.map(value => value.data), [catalog("new-run")]);
});

for (const status of [401, 403, 404, 409]) {
  test(`admission ${status} denial withdraws and purges the denied data before any cache read`, async t => {
    const error = Object.assign(new Error("synthetic denial"), { status });
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))], [partition("b"), stored(catalog("other"))]], admit: async () => { throw error; } });
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.controller.getSnapshot().data, undefined);
    assert.equal(f.backing.calls.read.length, 0);
    assert.equal(f.backing.calls.purge, status === 401 ? 1 : 0);
    assert.deepEqual(f.backing.calls.removeScope, status === 401 ? [] : [partition().scope]);
    assert.equal(f.backing.records.has(id(partition())), false);
    assert.equal(f.backing.records.has(id(partition("b"))), status !== 401);
  });
  test(`background ${status} denial withdraws a rendered catalog and purges the denied data`, async t => {
    const fresh = deferred();
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], fetchFresh: () => fresh.promise });
    const pending = f.controller.refresh(); await tick();
    assert.equal(f.controller.getSnapshot().phase, "cache");
    fresh.reject(Object.assign(new Error("synthetic denial"), { status })); await pending;
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.controller.getSnapshot().data, undefined);
    assert.equal(f.backing.calls.write.length, 0);
    assert.equal(f.backing.calls.purge, status === 401 ? 1 : 0);
    assert.deepEqual(f.backing.calls.removeScope, status === 401 ? [] : [partition().scope]);
    assert.equal(f.backing.records.has(id(partition())), false);
  });
}

for (const failure of [{ kind: "network" }, { kind: "timeout" }, { status: 503 }, {}]) {
  test(`initial admission ${failure.kind ?? failure.status ?? "unknown"} uncertainty hides without purging durable data`, async t => {
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: async () => { throw Object.assign(new Error("cannot verify admission"), failure); } });
    await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.controller.getSnapshot().data, undefined);
    assert.equal(f.backing.calls.read.length, 0);
    assert.equal(f.backing.calls.purge, 0);
    assert.deepEqual(f.backing.calls.removeScope, []);
    assert.equal(f.backing.records.has(id(partition())), true);
  });
}

for (const kind of ["network", "timeout"]) {
  test(`fast ${kind} failure waits for an admitted slow cache without renewing its deadline`, async t => {
    const disk = deferred(), backing = memoryStore();
    const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: async () => { throw Object.assign(new Error("transport unavailable"), { kind }); } });
    const pending = f.controller.refresh(); await tick();
    assert.equal(f.controller.getSnapshot().phase, "checking");
    assert.equal(f.controller.getSnapshot().data, undefined);
    f.advance(500); disk.resolve(stored(catalog("slow-disk"))); await pending;
    assert.equal(f.controller.getSnapshot().phase, "cache");
    assert.deepEqual(f.controller.getSnapshot().data, catalog("slow-disk"));
    assert.equal(f.controller.getSnapshot().stale, true);
    assert.match(f.controller.getSnapshot().error, /could not update/i);
    assert.equal(f.admittedSignals.length, 1);
    assert.equal(backing.calls.write.length, 0);
    assert.equal(backing.calls.purge, 0);
    assert.deepEqual(backing.calls.removeScope, []);
    assert.deepEqual(f.metrics.map(value => value.name), ["admission-ready", "cache-ready"]);
    f.setTime(1_000_000 + SERVICES_CATALOG_ADMISSION_MS);
    assert.equal(f.controller.getSnapshot().data, undefined, "disk completion must not renew admission");
  });

  test(`background ${kind} loss retains the already admitted catalog as stale until the original deadline`, async t => {
    const fresh = deferred();
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], fetchFresh: () => fresh.promise });
    const pending = f.controller.refresh(); await tick();
    assert.equal(f.controller.getSnapshot().phase, "cache");
    f.advance(500);
    // Existing ReadConnectionError also carries503; explicit transport provenance
    // must remain distinct from an ambiguous raw HTTP503 response.
    fresh.reject(Object.assign(new Error("transport unavailable"), { status: 503, kind })); await pending;
    assert.equal(f.controller.getSnapshot().phase, "cache");
    assert.deepEqual(f.controller.getSnapshot().data, catalog("saved"));
    assert.equal(f.controller.getSnapshot().stale, true);
    assert.match(f.controller.getSnapshot().error, /could not update/i);
    assert.equal(f.controller.getSnapshot().updatedAt, 999_000);
    assert.equal(f.backing.calls.purge, 0);
    assert.deepEqual(f.backing.calls.removeScope, []);
    assert.equal(f.backing.calls.write.length, 0);
    assert.equal(f.admittedSignals.length, 1, "known transport loss does not manufacture another admission");
    f.setTime(1_000_000 + SERVICES_CATALOG_ADMISSION_MS);
    assert.equal(f.controller.getSnapshot().data, undefined, "transport failure must not renew authority");
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.backing.records.has(id(partition())), true, "expiry withdraws presentation without erasing valid durable rows");
  });
}

test("fast transport failure cannot restore disk that arrives after admission expiry", async t => {
  const disk = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: async () => { throw Object.assign(new Error("offline"), { kind: "network" }); } });
  const pending = f.controller.refresh(); await tick();
  f.advance(SERVICES_CATALOG_ADMISSION_MS);
  disk.resolve(stored(catalog("too-late"))); await pending;
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.metrics.some(value => value.name === "cache-ready"), false);
  assert.equal(backing.calls.purge, 0);
  assert.equal(backing.calls.write.length, 0);
});

test("fast transport failure cannot restore a catalog whose own TTL expired while disk was pending", async t => {
  const disk = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: async () => { throw Object.assign(new Error("offline"), { kind: "network" }); } });
  const pending = f.controller.refresh(); await tick();
  const expiry = 1_000_500;
  f.setTime(expiry); disk.resolve(stored(catalog("expired"), expiry - 15 * 60 * 1000)); await pending;
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.metrics.some(value => value.name === "cache-ready"), false);
  assert.equal(backing.calls.purge, 0);
});

test("old transport-failure disk completion cannot invalidate a newer successful run", async t => {
  const disk = deferred(), backing = memoryStore(); let reads = 0, fetches = 0;
  const f = fixture(t, { backing, store: { ...backing.store, read: () => ++reads === 1 ? disk.promise : Promise.resolve(null) }, fetchFresh: async () => {
    if (++fetches === 1) throw Object.assign(new Error("offline"), { kind: "network" });
    return catalog("new-run");
  } });
  const old = f.controller.refresh(); await tick();
  await f.controller.invalidate(); await f.controller.refresh();
  assert.deepEqual(f.controller.getSnapshot().data, catalog("new-run"));
  disk.resolve(stored(catalog("old-run"))); await old;
  assert.equal(f.controller.getSnapshot().phase, "fresh");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("new-run"));
  assert.equal(backing.calls.write.length, 1);
  assert.equal(f.states.some(value => value.data?.services[0].name === "Service old-run"), false);
});

test("explicit denial before slow disk finishes withdraws and removes the scope immediately", async t => {
  const disk = deferred(), backing = memoryStore([[partition(), stored(catalog("saved"))]]);
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: async () => { throw Object.assign(new Error("denied"), { status: 403 }); } });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.deepEqual(backing.calls.removeScope, [partition().scope]);
  assert.equal(backing.records.has(id(partition())), false);
  disk.resolve(stored(catalog("denied"))); await tick();
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.metrics.some(value => value.name === "cache-ready"), false);
});

test("storage rejection after fast transport loss remains unavailable without a false revoke", async t => {
  const disk = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: async () => { throw Object.assign(new Error("offline"), { kind: "network" }); } });
  const pending = f.controller.refresh(); await tick(); disk.reject(new Error("storage unavailable")); await pending;
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(backing.calls.purge, 0);
  assert.deepEqual(backing.calls.removeScope, []);
});

test("ambiguous server failure does not gain slow-cache fallback from the transport-only wait", async t => {
  const disk = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: async () => { throw Object.assign(new Error("unconfirmed"), { status: 503 }); } });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  disk.resolve(stored(catalog("unconfirmed"))); await tick();
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(backing.calls.purge, 0);
  assert.deepEqual(backing.calls.removeScope, []);
});

for (const status of [503, 500, undefined]) {
  test(`background ${status ?? "unknown"} server failure requires matching fresh admission before stale retention`, async t => {
    const fresh = deferred(), confirmation = deferred(); let admissions = 0;
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: () => ++admissions === 1 ? Promise.resolve(partition()) : confirmation.promise, fetchFresh: () => fresh.promise });
    const pending = f.controller.refresh(); await tick();
    fresh.reject(Object.assign(new Error("ambiguous server error"), status ? { status } : {})); await tick();
    assert.equal(f.admittedSignals.length, 2);
    assert.equal(f.controller.getSnapshot().phase, "checking");
    assert.equal(f.controller.getSnapshot().data, undefined, "ambiguous failure must hide rows while permission is rechecked");
    assert.equal(f.backing.calls.write.length, 0);
    f.advance(10_000); confirmation.resolve(partition()); await pending;
    assert.deepEqual(f.controller.getSnapshot().data, catalog("saved"));
    assert.equal(f.controller.getSnapshot().stale, true);
    assert.match(f.controller.getSnapshot().error, /could not update/i);
    assert.equal(f.backing.calls.purge, 0);
    assert.deepEqual(f.backing.calls.removeScope, []);
    f.setTime(1_000_000 + SERVICES_CATALOG_ADMISSION_MS);
    assert.equal(f.controller.getSnapshot().data, undefined, "successful confirmation cannot extend the original display deadline");
  });
}

for (const status of [401, 403, 404, 409]) {
  test(`ambiguous503 followed by admission ${status} denial withdraws and purges denied data`, async t => {
    const fresh = deferred(); let admissions = 0;
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: async () => { if (++admissions === 1) return partition(); throw Object.assign(new Error("confirmed denial"), { status }); }, fetchFresh: () => fresh.promise });
    const pending = f.controller.refresh(); await tick();
    fresh.reject(Object.assign(new Error("ambiguous R6 response"), { status: 503 })); await pending;
    assert.equal(f.admittedSignals.length, 2);
    assert.equal(f.controller.getSnapshot().data, undefined);
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.backing.calls.purge, status === 401 ? 1 : 0);
    assert.deepEqual(f.backing.calls.removeScope, status === 401 ? [] : [partition().scope]);
    assert.equal(f.backing.records.has(id(partition())), false);
  });
}

for (const failure of [{ kind: "network" }, { kind: "timeout" }, { status: 503 }, {}]) {
  test(`ambiguous503 followed by ${failure.kind ?? failure.status ?? "unknown"} admission uncertainty withdraws without purging`, async t => {
    const fresh = deferred(); let admissions = 0;
    const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: async () => { if (++admissions === 1) return partition(); throw Object.assign(new Error("cannot confirm permission"), failure); }, fetchFresh: () => fresh.promise });
    const pending = f.controller.refresh(); await tick();
    fresh.reject(Object.assign(new Error("ambiguous R6 response"), { status: 503 })); await pending;
    assert.equal(f.admittedSignals.length, 2);
    assert.equal(f.controller.getSnapshot().data, undefined);
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.backing.calls.purge, 0);
    assert.deepEqual(f.backing.calls.removeScope, []);
    assert.equal(f.backing.records.has(id(partition())), true);
    assert.equal(f.backing.calls.write.length, 0);
  });
}

test("an admission mismatch after ambiguous503 removes the former scope without exposing another context", async t => {
  const fresh = deferred(); let admissions = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: async () => ++admissions === 1 ? partition() : partition("b"), fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("ambiguous response"), { status: 503 })); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.deepEqual(f.backing.calls.removeScope, [partition().scope]);
  assert.equal(f.backing.calls.purge, 0);
  assert.equal(f.backing.calls.write.length, 0);
});

test("expired original validity cannot be revived by a delayed matching re-admission", async t => {
  const fresh = deferred(), confirmation = deferred(); let admissions = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: () => ++admissions === 1 ? Promise.resolve(partition()) : confirmation.promise, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("ambiguous response"), { status: 503 })); await tick();
  f.advance(SERVICES_CATALOG_ADMISSION_MS + 1); confirmation.resolve(partition()); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.removeScope, []);
  assert.equal(f.backing.calls.write.length, 0);
});

test("an admission arriving after the invocation validity budget cannot authorize a restore", async t => {
  const admission = deferred(), f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: () => admission.promise });
  const pending = f.controller.refresh(); f.advance(SERVICES_CATALOG_ADMISSION_MS);
  admission.resolve(partition()); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.read.length, 0);
  assert.equal(f.readSignals.length, 0);
  assert.equal(f.backing.calls.write.length, 0);
});

test("expired validity withdraws an already rendered cache and rejects a delayed fresh response", async t => {
  const fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  assert.equal(f.controller.getSnapshot().phase, "cache");
  f.advance(SERVICES_CATALOG_ADMISSION_MS + 1);
  fresh.resolve(catalog("too-late")); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.notEqual(f.controller.getSnapshot().phase, "cache");
  assert.equal(f.backing.calls.write.length, 0);
});

test("expired admission while disk is pending cannot publish cached or fresh results", async t => {
  const disk = deferred(), fresh = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  f.advance(SERVICES_CATALOG_ADMISSION_MS + 1);
  disk.resolve(stored(catalog("expired-cache"))); fresh.resolve(catalog("expired-fresh")); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.write.length, 0);
  assert.equal(f.metrics.some(value => value.name === "cache-ready" || value.name === "fresh-data-ready"), false);
});

test("missing identity, permission and mismatched scope admissions never access disk", async t => {
  const invalid = [null, undefined, {}, partition("b"), ...["viewerId", "accountId", "salonId", "permissionRevision"].flatMap(key => [partition("a", { [key]: "" }), partition("a", { [key]: undefined })])];
  for (const value of invalid) {
    const f = fixture(t, { admit: async () => value }); await f.controller.refresh();
    assert.equal(f.controller.getSnapshot().phase, "unavailable");
    assert.equal(f.backing.calls.read.length, 0);
    assert.equal(f.readSignals.length, 0);
    assert.equal(f.backing.calls.purge, 0);
    assert.deepEqual(f.backing.calls.removeScope, []);
    f.controller.dispose();
  }
});

for (const unavailable of ["observeAccount", "read", "write"]) {
  test(`optional ${unavailable} storage failure keeps authorized online fetching usable`, async t => {
    const backing = memoryStore();
    const store = { ...backing.store, [unavailable]: async () => { throw new Error("storage disabled"); } };
    const f = fixture(t, { backing, store }); await f.controller.refresh();
    assert.equal(f.readSignals.length, 1);
    assert.equal(f.controller.getSnapshot().phase, "fresh");
    assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
    assert.equal(backing.calls.purge, 0);
  });
}

test("corrupt cached projection is ignored while a valid fresh response remains usable", async t => {
  const fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored({ ...catalog("saved"), staff: [{ id: "private" }] })]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  assert.equal(f.controller.getSnapshot().data, undefined);
  fresh.resolve(catalog("valid")); await pending;
  assert.equal(f.controller.getSnapshot().phase, "fresh");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("valid"));
});

test("invalid fresh projection cannot overwrite the cache or leave the old catalog visible", async t => {
  const fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  assert.equal(f.controller.getSnapshot().phase, "cache");
  fresh.resolve({ ...catalog("unsafe"), access_token: "synthetic-never-persist" }); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.write.length, 0);
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.removeScope, [partition().scope]);
});

test("Activity disposal clears a visible catalog before the next admission can start", async t => {
  const admission = deferred(); let admissions = 0;
  const f = fixture(t, { admit: () => ++admissions === 1 ? Promise.resolve(partition()) : admission.promise });
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().phase, "fresh");
  f.controller.dispose();
  assert.equal(f.controller.getSnapshot().data, undefined);
  const pending = f.controller.refresh();
  assert.equal(f.controller.getSnapshot().data, undefined);
  admission.resolve(partition()); await pending;
  assert.equal(f.controller.getSnapshot().phase, "fresh");
});

test("a late re-admission after invalidation cannot restore cache or remove a newer context", async t => {
  const fresh = deferred(), confirmation = deferred(); let admissions = 0, reads = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: () => ++admissions === 2 ? confirmation.promise : Promise.resolve(partition()), fetchFresh: () => ++reads === 1 ? fresh.promise : Promise.resolve(catalog("new-run")) });
  const old = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("ambiguous response"), { status: 503 })); await tick();
  await f.controller.invalidate(); await f.controller.refresh();
  confirmation.resolve(partition("b")); await old;
  assert.deepEqual(f.controller.getSnapshot().data, catalog("new-run"));
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.removeScope, []);
});

test("re-admission compares named partition fields independently of JSON key order", async t => {
  const fresh = deferred(); let admissions = 0;
  const reordered = Object.fromEntries(Object.entries(partition()).reverse());
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(partition()));
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], admit: async () => ++admissions === 1 ? partition() : reordered, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("ambiguous response"), { status: 503 })); await pending;
  assert.equal(f.admittedSignals.length, 2);
  assert.deepEqual(f.controller.getSnapshot().data, catalog("saved"));
  assert.equal(f.controller.getSnapshot().stale, true);
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.removeScope, []);
});

test("cached TTL withdraws stale presentation earlier than the valid admission deadline", async t => {
  const ttl = 15 * 60 * 1000, cacheExpiresAt = 1_005_000, fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("near-expiry"), cacheExpiresAt - ttl)]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  assert.equal(f.controller.getSnapshot().phase, "cache");
  fresh.reject(Object.assign(new Error("connection lost"), { kind: "network" })); await pending;
  assert.equal(f.controller.getSnapshot().stale, true);
  f.setTime(cacheExpiresAt - 1);
  assert.deepEqual(f.controller.getSnapshot().data, catalog("near-expiry"));
  f.setTime(cacheExpiresAt);
  assert.equal(f.controller.getSnapshot().data, undefined, "catalog expiry must win over the remaining25s admission");
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.removeScope, []);
});

test("a matching re-admission cannot revive cache whose TTL expired while confirmation was pending", async t => {
  const ttl = 15 * 60 * 1000, cacheExpiresAt = 1_005_000, fresh = deferred(), confirmation = deferred(); let admissions = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("near-expiry"), cacheExpiresAt - ttl)]], admit: () => ++admissions === 1 ? Promise.resolve(partition()) : confirmation.promise, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("ambiguous response"), { status: 503 })); await tick();
  assert.equal(f.controller.getSnapshot().data, undefined);
  f.setTime(cacheExpiresAt); confirmation.resolve(partition()); await pending;
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.purge, 0);
  assert.deepEqual(f.backing.calls.removeScope, []);
  assert.equal(f.backing.calls.write.length, 0);
});

test("expired, future and nonfinite cached timestamps are ignored while fresh reads remain usable", async t => {
  const ttl = 15 * 60 * 1000;
  for (const updatedAt of [1_000_000 - ttl, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
    const fresh = deferred();
    const f = fixture(t, { initial: [[partition(), stored(catalog("invalid-time"), updatedAt)]], fetchFresh: () => fresh.promise });
    const pending = f.controller.refresh(); await tick();
    assert.equal(f.controller.getSnapshot().data, undefined);
    fresh.resolve(catalog("current")); await pending;
    assert.equal(f.controller.getSnapshot().phase, "fresh");
    assert.deepEqual(f.controller.getSnapshot().data, catalog("current"));
    f.controller.dispose();
  }
});

// Independent wall/monotonic clocks model background timers that have not fired.
// These are validity tests, not performance measurements.
test("monotonic admission boundary expires at30s even when the wall clock stops", async t => {
  const f = fixture(t); await f.controller.refresh();
  f.setMonotonicTime(SERVICES_CATALOG_ADMISSION_MS - 1);
  assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
  f.setMonotonicTime(SERVICES_CATALOG_ADMISSION_MS);
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.controller.getSnapshot().phase, "unavailable");
});

test("monotonic admission time starts before the pending server response despite wall rollback", async t => {
  const admission = deferred(), f = fixture(t, { admit: () => admission.promise });
  const pending = f.controller.refresh();
  f.setWallTime(995_000); f.setMonotonicTime(SERVICES_CATALOG_ADMISSION_MS);
  admission.resolve(partition()); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.read.length, 0);
  assert.equal(f.readSignals.length, 0);
  assert.equal(f.backing.calls.write.length, 0);
});

test("cached15min TTL boundary wins on monotonic elapsed when wall time stops", async t => {
  const cacheExpiresAt = 1_005_000, fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("near-expiry"), cacheExpiresAt - 15 * 60 * 1000)]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("offline"), { kind: "network" })); await pending;
  f.setMonotonicTime(4_999);
  assert.deepEqual(f.controller.getSnapshot().data, catalog("near-expiry"));
  f.setMonotonicTime(5_000);
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.purge, 0);
});

test("observed wall rollback latches withdrawal and cannot recover with a late200", async t => {
  const fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("saved"))]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  f.advance(1_000); assert.deepEqual(f.controller.getSnapshot().data, catalog("saved"));
  f.setWallTime(1_000_500); f.setMonotonicTime(1_500);
  assert.equal(f.controller.getSnapshot().data, undefined, "a clock regression withdraws the current run");
  f.setWallTime(1_002_000); f.setMonotonicTime(2_000);
  fresh.resolve(catalog("late200")); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.write.length, 0);
  assert.equal(f.backing.calls.purge, 0, "clock uncertainty is not revocation");
});

test("observed monotonic rollback also invalidates the current run", async t => {
  const f = fixture(t); await f.controller.refresh();
  f.advance(1_000); assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
  f.setMonotonicTime(999);
  assert.equal(f.controller.getSnapshot().data, undefined);
  f.setMonotonicTime(1_001);
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.purge, 0);
});

for (const clock of ["wall", "monotonic"]) test(`nonfinite ${clock} cannot leave private data visible`, async t => {
  const f = fixture(t); await f.controller.refresh();
  if (clock === "wall") f.setWallTime(Number.NaN); else f.setMonotonicTime(Number.NaN);
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.purge, 0);
});

test("fresh data stores observed wall time rather than a synthesized validity timestamp", async t => {
  const fresh = deferred(), f = fixture(t, { fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  f.setMonotonicTime(1_000); fresh.resolve(catalog("current")); await pending;
  assert.deepEqual(f.controller.getSnapshot().data, catalog("current"));
  assert.equal(f.controller.getSnapshot().updatedAt, 1_000_000);
  assert.equal(f.backing.calls.write[0].updatedAt, 1_000_000);
});

test("new controller after restart cannot inherit admission from a persisted catalog", async t => {
  const backing = memoryStore(), original = fixture(t, { backing });
  await original.controller.refresh(); original.controller.dispose();
  const restarted = fixture(t, { backing, admit: async () => { throw Object.assign(new Error("cannot confirm after restart"), { status: 503 }); } });
  restarted.setWallTime(900_000); restarted.setMonotonicTime(0);
  await restarted.controller.refresh();
  assert.equal(restarted.controller.getSnapshot().data, undefined);
  assert.equal(backing.calls.read.length, 1, "only the original controller was allowed to read disk");
  assert.equal(restarted.readSignals.length, 0);
  assert.equal(backing.records.size, 1);
});

for (const status of [401, 403]) test(`explicit${status} followed by503 cannot resurrect the denied catalog`, async t => {
  let admissions = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("denied"))]], admit: async () => {
    throw Object.assign(new Error("access unavailable"), { status: ++admissions === 1 ? status : 503 });
  } });
  await f.controller.refresh();
  assert.equal(f.backing.records.size, 0);
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.calls.read.length, 0);
  assert.equal(f.readSignals.length, 0);
  assert.equal(f.backing.calls.purge, status === 401 ? 1 : 0);
  assert.deepEqual(f.backing.calls.removeScope, status === 403 ? [partition().scope] : []);
});

test("late200 after logout purge cannot repopulate data when the next admission fails503", async t => {
  const fresh = deferred(); let admissions = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("old"))]], admit: async () => {
    if (++admissions === 1) return partition();
    throw Object.assign(new Error("cannot confirm"), { status: 503 });
  }, fetchFresh: () => fresh.promise });
  const old = f.controller.refresh(); await tick();
  await f.controller.invalidate(true); await f.controller.refresh();
  fresh.resolve(catalog("late200")); await old;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.records.size, 0);
  assert.equal(f.backing.calls.write.length, 0);
});

test("account and scope switch plus late200 cannot overwrite the newly admitted account", async t => {
  const backing = memoryStore(), fresh = deferred();
  const original = fixture(t, { backing, fetchFresh: () => fresh.promise });
  const pending = original.controller.refresh(); await tick();
  await original.controller.invalidate(); original.controller.dispose();
  const next = fixture(t, { backing, partition: partition("b", { viewerId: "viewer-two", accountId: "account-two" }), fetchFresh: async () => catalog("new-account") });
  await next.controller.refresh(); fresh.resolve(catalog("old-account-late200")); await pending;
  assert.deepEqual(next.controller.getSnapshot().data, catalog("new-account"));
  assert.equal(original.controller.getSnapshot().data, undefined);
  assert.equal(backing.calls.write.length, 1);
  assert.deepEqual([...backing.records.values()].map(value => value.data), [catalog("new-account")]);
});

test("a forward wall correction cannot stop the remaining catalog TTL from elapsing", async t => {
  const cacheExpiresAt = 1_025_000, fresh = deferred();
  const f = fixture(t, { initial: [[partition(), stored(catalog("near-expiry"), cacheExpiresAt - 15 * 60 * 1000)]], fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  fresh.reject(Object.assign(new Error("offline"), { kind: "network" })); await pending;
  f.setWallTime(1_020_000); f.setMonotonicTime(1_000);
  assert.deepEqual(f.controller.getSnapshot().data, catalog("near-expiry"));
  f.setMonotonicTime(6_000);
  assert.equal(f.controller.getSnapshot().data, undefined, "five seconds of monotonic elapsed consume the remaining TTL");
  assert.equal(f.backing.calls.purge, 0);
});

for (const status of [401, 403]) test(`visible catalog denied${status} stays withdrawn through a subsequent503 admission`, async t => {
  const fresh = deferred(); let admissions = 0;
  const f = fixture(t, { initial: [[partition(), stored(catalog("visible-before-denial"))]], admit: async () => {
    if (++admissions === 1) return partition();
    throw Object.assign(new Error("cannot confirm"), { status: 503 });
  }, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  assert.deepEqual(f.controller.getSnapshot().data, catalog("visible-before-denial"));
  fresh.reject(Object.assign(new Error("denied"), { status })); await pending;
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.records.size, 0);
  await f.controller.refresh();
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.backing.records.size, 0);
  assert.equal(f.backing.calls.read.length, 1);
  assert.equal(f.backing.calls.write.length, 0);
});

// The conservative optional-storage budget is3s (existing open1.5s+transaction1.5s),
// independent of the30s authorization budget and any performance acceptance goal.
test("hung observeAccount cannot block an authorized live fetch beyond3s", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const observe = deferred(), backing = memoryStore(); let finished = false;
  const f = fixture(t, { backing, store: { ...backing.store, observeAccount: () => observe.promise } });
  const pending = f.controller.refresh().then(() => { finished = true; }); await tick();
  assert.equal(f.readSignals.length, 0);
  f.advance(3_000); t.mock.timers.tick(3_000); await tick();
  assert.equal(f.readSignals.length, 1, "live read must not queue behind optional storage indefinitely");
  assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
  assert.equal(finished, true);
  assert.equal(backing.calls.read.length, 0, "unconfirmed storage binding is not used for cache");
  assert.equal(backing.calls.write.length, 0);
  observe.resolve(); await pending; await tick();
  assert.equal(backing.calls.read.length, 0, "late account observation cannot restart old cache work");
});

test("a hung cache read cannot hold a successful live refresh open beyond3s", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const disk = deferred(), backing = memoryStore(); let finished = false;
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise } });
  const pending = f.controller.refresh().then(() => { finished = true; }); await tick();
  assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
  f.advance(3_000); t.mock.timers.tick(3_000); await tick();
  assert.equal(finished, true);
  assert.equal(backing.calls.write.length, 0, "do not queue another optional operation behind a timed-out read");
  disk.resolve(stored(catalog("late"))); await pending; await tick();
  assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
});

test("a cache read completing after3s cannot render while the live response is still pending", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const disk = deferred(), fresh = deferred(), backing = memoryStore();
  const f = fixture(t, { backing, store: { ...backing.store, read: () => disk.promise }, fetchFresh: () => fresh.promise });
  const pending = f.controller.refresh(); await tick();
  f.advance(3_000); t.mock.timers.tick(3_000); await tick();
  disk.resolve(stored(catalog("too-late-storage"))); await tick();
  assert.equal(f.controller.getSnapshot().data, undefined);
  assert.equal(f.metrics.some(value => value.name === "cache-ready"), false);
  fresh.resolve(catalog("current")); await pending;
  assert.deepEqual(f.controller.getSnapshot().data, catalog("current"));
  assert.equal(backing.calls.write.length, 0);
});

test("hung optional write does not hold fresh-data completion open beyond3s", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const write = deferred(), backing = memoryStore(); let finished = false;
  const f = fixture(t, { backing, store: { ...backing.store, write: () => write.promise } });
  const pending = f.controller.refresh().then(() => { finished = true; }); await tick();
  assert.deepEqual(f.controller.getSnapshot().data, catalog("fresh"));
  f.advance(3_000); t.mock.timers.tick(3_000); await tick();
  assert.equal(finished, true);
  await f.controller.invalidate(); write.resolve(true); await pending; await tick();
  assert.equal(f.controller.getSnapshot().data, undefined);
});
