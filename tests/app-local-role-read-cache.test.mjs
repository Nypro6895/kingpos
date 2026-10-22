import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

// Exercise the real DTO vault; authorization and DOM ownership remain entry's job.
const built = buildSync({
  entryPoints: ["lib/app-local-role-read-cache.ts"],
  bundle: true, write: false, platform: "node", format: "esm", target: "node20",
});
const { createAppLocalRoleReadCache } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`);
const start = 1_000_000;
const scope = letter => "v3:" + letter.repeat(64);
const authority = (overrides = {}) => ({
  viewerId: "viewer-a", generation: "generation-a", salonId: "salon-a",
  workspaceId: "owner:salon-a", scope: scope("a"), permissionRevision: "owner-rights-1",
  grantRevision: "grant-owner-1", proof: "owner:leased", ...overrides,
});
const owner = authority();
const staff = authority({ workspaceId: "staff:salon-a", scope: scope("b"), permissionRevision: "staff-rights-1", grantRevision: "grant-staff-1", proof: "staff:online-only" });
const row = (auth = owner, overrides = {}) => ({
  name: "page.synthetic-read", args: { date: "2026-10-21", filter: { b: 2, a: 1 } },
  snapshot: { schemaVersion: 1, status: 200, scope: auth.scope, etag: '"dto-1"', updatedAt: start, data: { items: [{ id: "synthetic-a", value: 7 }] } },
  ...overrides,
});
const fixture = (options = {}) => {
  let time = start;
  return { cache: createAppLocalRoleReadCache({ now: () => time, ...options }), setTime: value => { time = value; } };
};
const plain = value => JSON.parse(JSON.stringify(value));

test("A to B to A retains distinct settled DTOs only for the same principal, generation and known salon", () => {
  const { cache } = fixture();
  const a = row(owner), b = row(staff, { name: "staff.synthetic-read" });
  cache.remember(owner, [a]);
  assert.equal(cache.observe(staff), true);
  assert.deepEqual(cache.restore(staff), []);
  cache.remember(staff, [b]);
  assert.deepEqual(cache.restore(owner), [a]);
  assert.deepEqual(cache.restore(staff), [b]);
  assert.equal(cache.stats().entries, 2);
});

test("unknown Personal tenant or incomplete authority fails closed and clears earlier role DTOs", () => {
  for (const invalid of [null, { ...owner, salonId: null }, { ...owner, salonId: "" }, { ...owner, salonId: "   " }, { ...owner, viewerId: "" }, { ...owner, generation: "" }]) {
    const { cache } = fixture();
    cache.remember(owner, [row()]);
    assert.equal(cache.observe(invalid), false);
    assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
    assert.deepEqual(cache.restore(owner), []);
  }
});

test("principal and device generation changes purge every former partition", () => {
  for (const change of [{ viewerId: "viewer-b" }, { generation: "generation-b" }]) {
    const { cache } = fixture();
    cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
    assert.equal(cache.observe(authority(change)), true);
    assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
    assert.deepEqual(cache.restore(owner), []);
  }
});

test("a known workspace permission, grant revision or proof change purges only that context", () => {
  for (const change of [{ scope: scope("d") }, { permissionRevision: "owner-rights-2" }, { grantRevision: "grant-owner-2" }, { proof: "owner:different-proof" }]) {
    const { cache } = fixture();
    cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
    assert.equal(cache.observe(authority(change)), true);
    assert.equal(cache.stats().entries, 1);
    assert.deepEqual(cache.restore(staff), [row(staff)]);
    assert.deepEqual(cache.restore(authority(change)), []);
  }
});

test("restore requires the full scope and workspace tuple rather than a matching viewer or resource name", () => {
  for (const change of [{ scope: scope("d") }, { workspaceId: "owner:salon-a:other" }, { permissionRevision: "new" }, { grantRevision: "new" }, { proof: "new" }]) {
    const { cache } = fixture();
    cache.remember(owner, [row()]);
    assert.deepEqual(cache.restore(authority(change)), []);
  }
});

test("resource identity canonicalizes object keys but keeps domain/date and ordered arrays separate", () => {
  const { cache } = fixture();
  const first = row(owner, { args: { filter: { a: 1, b: 2 }, order: [1, 2], date: "2026-10-21" } });
  const replacement = row(owner, { args: { date: "2026-10-21", order: [1, 2], filter: { b: 2, a: 1 } }, snapshot: { ...first.snapshot, etag: '"dto-2"', data: { version: 2 } } });
  cache.remember(owner, [first]); cache.remember(owner, [replacement]);
  cache.remember(owner, [row(owner, { args: { ...first.args, date: "2026-10-22" } }), row(owner, { args: { ...first.args, order: [2, 1] } })]);
  const restored = cache.restore(owner);
  assert.equal(restored.length, 3);
  assert.equal(restored.filter(value => value.snapshot.etag === '"dto-2"').length, 1);
});

test("remember and restore deep-clone arguments and DTOs without exposing stored authority objects", () => {
  const { cache } = fixture();
  const auth = authority(), original = row(auth), expected = plain(original);
  cache.remember(auth, [original]);
  original.args.filter.a = 99; original.snapshot.data.items[0].value = 99; auth.scope = "mutated-caller-scope";
  const restored = cache.restore(owner);
  assert.deepEqual(restored, [expected]);
  assert.deepEqual(Object.keys(restored[0]).sort(), ["args", "name", "snapshot"]);
  restored[0].args.filter.a = 88; restored[0].snapshot.data.items[0].value = 88;
  assert.deepEqual(cache.restore(owner), [expected]);
});

test("only successful online exact-scope envelopes can enter the vault", () => {
  for (const patch of [{ status: 304 }, { status: 503 }, { schemaVersion: 2 }, { scope: "another-role-scope" }, { offline: true }, { updatedAt: start + 1 }, { updatedAt: NaN }, { updatedAt: Infinity }, { data: undefined }]) {
    const { cache } = fixture();
    const candidate = row(); candidate.snapshot = { ...candidate.snapshot, ...patch };
    cache.remember(owner, [candidate]);
    assert.deepEqual(cache.restore(owner), [], JSON.stringify(patch));
    assert.equal(cache.stats().entries, 0);
  }
});

test("TTL uses original DTO age and cannot slide when a role is restored or checkpointed again", () => {
  const { cache, setTime } = fixture();
  cache.remember(owner, [row()]);
  setTime(start + 299_999);
  const restored = cache.restore(owner); assert.equal(restored.length, 1);
  assert.equal(restored[0].snapshot.updatedAt, start);
  cache.remember(owner, restored);
  setTime(start + 300_000);
  assert.deepEqual(cache.restore(owner), []);
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
});

test("retention options can shorten but cannot extend the five minute ceiling", () => {
  for (const retainForMs of [300_001, 3_600_000]) {
    const { cache, setTime } = fixture({ retainForMs });
    cache.remember(owner, [row()]); setTime(start + 300_000);
    assert.deepEqual(cache.restore(owner), []);
  }
  const { cache, setTime } = fixture({ retainForMs: 100 });
  cache.remember(owner, [row()]); setTime(start + 100);
  assert.deepEqual(cache.restore(owner), []);
});

test("bounded LRU evicts an inactive older DTO and counts DTOs rather than role partitions", () => {
  const { cache } = fixture({ maxEntries: 2 });
  const third = authority({ workspaceId: "other:salon-a", scope: scope("c"), permissionRevision: "other-rights", grantRevision: "other-grant", proof: "other" });
  cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
  assert.equal(cache.restore(owner).length, 1);
  cache.remember(third, [row(third)]);
  assert.equal(cache.stats().entries, 2);
  assert.deepEqual(cache.restore(staff), []);
  assert.equal(cache.restore(owner).length, 1);
  assert.equal(cache.restore(third).length, 1);
});

test("entry and byte ceilings remain bounded when larger options or one oversized DTO are supplied", () => {
  const { cache } = fixture({ maxEntries: 1000, maxBytes: 100 * 1024 * 1024 });
  cache.remember(owner, Array.from({ length: 31 }, (_, index) => row(owner, { args: { index } })));
  assert.equal(cache.stats().entries, 30);
  assert.equal(cache.restore(owner).some(value => value.args.index === 0), false);
  cache.clear();
  const huge = row(); huge.snapshot.data = { value: "x".repeat(5 * 1024 * 1024 + 1) };
  cache.remember(owner, [huge]);
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
  const small = fixture({ maxBytes: 64 }).cache;
  small.remember(owner, [row()]); assert.deepEqual(small.stats(), { entries: 0, bytes: 0 });
});

test("non-finite configuration cannot disable count, byte or age bounds", () => {
  const { cache, setTime } = fixture({ maxEntries: NaN, maxBytes: NaN, retainForMs: NaN });
  cache.remember(owner, Array.from({ length: 31 }, (_, index) => row(owner, { args: { index } })));
  assert.ok(cache.stats().entries <= 30);
  const huge = row(); huge.snapshot.data = { value: "x".repeat(5 * 1024 * 1024 + 1) };
  cache.remember(owner, [huge]);
  assert.ok(cache.stats().bytes <= 5 * 1024 * 1024);
  setTime(start + 300_000);
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
});

test("security material is rejected recursively in DTO and argument fields", () => {
  for (const field of ["password", "token", "session", "grants"]) {
    for (const location of ["args", "data"]) {
      const { cache } = fixture(); const candidate = row();
      if (location === "args") candidate.args = { filter: { [field]: "synthetic-forbidden" } };
      else candidate.snapshot.data = { records: [{ [field]: "synthetic-forbidden" }] };
      cache.remember(owner, [candidate]);
      assert.deepEqual(cache.restore(owner), [], `${field} in ${location}`);
      assert.equal(cache.stats().bytes, 0);
    }
  }
});

test("pending work, executable values and cyclic graphs cannot become settled DTO snapshots", () => {
  const cycle = {}; cycle.self = cycle;
  for (const data of [Promise.resolve({ private: "synthetic" }), { pending: Promise.resolve(1) }, { callback() {} }, cycle]) {
    const { cache } = fixture(); const candidate = row(); candidate.snapshot.data = data;
    cache.remember(owner, [candidate]);
    assert.deepEqual(cache.restore(owner), []);
  }
});

test("clear withdraws all quarantined DTOs without allowing old restored copies to repopulate them", () => {
  const { cache } = fixture();
  cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
  const previouslyRestored = cache.restore(owner);
  cache.clear(); previouslyRestored[0].snapshot.data.items[0].value = 999;
  assert.deepEqual(cache.restore(owner), []);
  assert.deepEqual(cache.restore(staff), []);
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
});


test("positive Personal principal observation retains quarantine without a restorable Personal context", () => {
  const { cache } = fixture(); cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
  assert.equal(cache.observePrincipal(owner.viewerId, owner.generation), true);
  assert.equal(cache.stats().entries, 2);
  assert.deepEqual(cache.restore(owner), [row()]);
  assert.deepEqual(cache.restore(staff), [row(staff)]);
});

test("unknown or changed Personal principal/generation clears all quarantine", () => {
  for (const [viewer, generation] of [["", owner.generation], [owner.viewerId, ""], [null, owner.generation], ["viewer-b", owner.generation], [owner.viewerId, "generation-b"]]) {
    const { cache } = fixture(); cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
    cache.observePrincipal(viewer, generation);
    assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
  }
});

test("another known salon remains a separate quarantine until its own exact authority returns", () => {
  const { cache } = fixture(), other = authority({ salonId: "salon-b", workspaceId: "owner:salon-b", scope: scope("c") });
  cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
  assert.deepEqual(cache.restore(other), []); assert.equal(cache.stats().entries, 2);
  cache.remember(other, [row(other)]); assert.equal(cache.stats().entries, 3);
  assert.deepEqual(cache.restore(owner), [row()]); assert.deepEqual(cache.restore(other), [row(other)]);
});

test("explicit scoped invalidation removes its context without erasing an unaffected role", () => {
  const { cache } = fixture(); cache.remember(owner, [row()]); cache.remember(staff, [row(staff)]);
  cache.clear(owner.scope); assert.equal(cache.stats().entries, 1);
  assert.deepEqual(cache.restore(owner), []); assert.deepEqual(cache.restore(staff), [row(staff)]);
  cache.clear('malformed'); assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
});
