import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";
import { build } from "esbuild";

// Exercise the real validator, DAL and actions together. Only framework/auth
// boundaries are replaced; there is no Supabase client, credential or network.
const fixtureKey = Symbol.for("reylumi.market-registry.boundary-test");
const previousFlag = process.env.MARKET_PRIVATE_REGISTRY_ENABLED;
const previousFetch = globalThis.fetch;
const state = {};
globalThis[fixtureKey] = state;
globalThis.fetch = () => { throw new Error("Boundary tests must not access the network."); };

const result = await build({
  stdin: {
    contents: `export * as manifest from './lib/market-registry/manifest';
      export * as server from './lib/market-registry/server';
      export * as actions from './app/(market-private)/actions';`,
    loader: "ts", resolveDir: process.cwd(),
  },
  bundle: true, write: false, platform: "node", format: "esm", metafile: true,
  alias: { "@": process.cwd() },
  plugins: [{ name: "private-registry-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/cache|@\/lib\/supabase\/server)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
      args.path === "server-only" ? "" : args.path === "next/cache" ? `
        export function revalidatePath(path) {
          globalThis[Symbol.for('reylumi.market-registry.boundary-test')].revalidated.push(path);
        }` : `
        export async function createAuthenticatedSupabaseServerClient(options) {
          const state = globalThis[Symbol.for('reylumi.market-registry.boundary-test')];
          const clientId = state.authCalls.length + 1;
          const actor = state.actor;
          state.authCalls.push({clientId, actor, options});
          if (state.authError) throw state.authError;
          if (state.noSession) return null;
          return new Proxy({async rpc(name, params) {
            state.rpcCalls.push({clientId, actor, name, params});
            if (state.rpcThrow) throw state.rpcThrow;
            return state.rpcResult;
          }}, {get(target, key) {
            if (key === 'then') return undefined;
            if (key !== 'rpc') throw Error('Unexpected privileged client operation: ' + String(key));
            return target[key];
          }});
        }`,
    }));
  }}],
});
const { manifest, server, actions } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function reset() {
  Object.assign(state, {
    actor: "synthetic-developer", authCalls: [], rpcCalls: [], revalidated: [],
    noSession: false, authError: null, rpcThrow: null,
    rpcResult: { data: { id: "synthetic-result" }, error: null },
  });
  process.env.MARKET_PRIVATE_REGISTRY_ENABLED = "true";
}
beforeEach(reset);
after(() => {
  if (previousFlag === undefined) delete process.env.MARKET_PRIVATE_REGISTRY_ENABLED;
  else process.env.MARKET_PRIVATE_REGISTRY_ENABLED = previousFlag;
  globalThis.fetch = previousFetch;
  delete globalThis[fixtureKey];
});

const appId = "12345678-1234-4123-8123-123456789abc";
const submissionId = "abcdef12-3456-4789-8123-123456789abc";
const hash = "a1".repeat(32);
const previous = { ok: false, message: "" };
const baseManifest = () => ({ manifestSchemaVersion: 1, appVersion: "1.2.3", displayName: "Fixture app", description: "Synthetic metadata only.", requestedCapabilities: [] });
function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
const draft = (overrides = {}) => form({ appId: "", expectedVersion: "0", appVersion: "1.2.3", displayName: "Fixture app", description: "Synthetic metadata only.", ...overrides });
const submit = (overrides = {}) => form({ appId, expectedVersion: "7", ...overrides });
const withdraw = (overrides = {}) => form({ submissionId, expectedHash: hash, ...overrides });
const review = (overrides = {}) => form({ submissionId, expectedVersion: "7", expectedHash: hash, decision: "metadata_approved", reason: "Verified metadata only.", ...overrides });
const actionCases = [
  ["saveDraftAction", draft], ["submitDraftAction", submit],
  ["withdrawSubmissionAction", withdraw], ["reviewSubmissionAction", review],
];
function noCalls() {
  assert.deepEqual(state.authCalls, []);
  assert.deepEqual(state.rpcCalls, []);
  assert.deepEqual(state.revalidated, []);
}
function inputError(fn) { assert.throws(fn, manifest.MarketRegistryInputError); }

test("manifest admits only metadata fields and an empty capability set", () => {
  assert.deepEqual(manifest.validateMarketRegistryManifest(baseManifest()), baseManifest());
  for (const input of [null, [], "{}", 1, {}, { ...baseManifest(), manifestSchemaVersion: "1" }, { ...baseManifest(), manifestSchemaVersion: 2 }]) {
    inputError(() => manifest.validateMarketRegistryManifest(input));
  }
  for (const field of Object.keys(baseManifest())) {
    const value = baseManifest(); delete value[field];
    inputError(() => manifest.validateMarketRegistryManifest(value));
  }
  for (const field of ["publisherId", "userId", "status", "runtime", "entrypoint", "slots", "pricing", "permissions", "webhookUrl"]) {
    inputError(() => manifest.validateMarketRegistryManifest({ ...baseManifest(), [field]: "untrusted" }));
  }
  for (const requestedCapabilities of [["bookings:read"], ["runtime:iframe"], [null], {}, "", null]) {
    inputError(() => manifest.validateMarketRegistryManifest({ ...baseManifest(), requestedCapabilities }));
  }
});

test("semantic versions accept build metadata but reject ambiguous numeric prereleases", () => {
  for (const appVersion of ["0.0.0", "1.2.3-alpha.0", "1.2.3-beta-", "1.2.3+build.01", "1.2.3-rc.1+sha-123"]) {
    assert.equal(manifest.validateMarketRegistryManifest({ ...baseManifest(), appVersion }).appVersion, appVersion);
  }
  for (const appVersion of ["1", "1.2", "v1.2.3", "01.2.3", "1.02.3", "1.2.03", "1.2.3-01", "1.2.3-alpha.01", "1.2.3-", "1.2.3+", "1.2.3-rc..1", "1.2.3/next", "1.2.3-" + "a".repeat(64)]) {
    inputError(() => manifest.validateMarketRegistryManifest({ ...baseManifest(), appVersion }));
  }
});

test("Unicode is NFC-normalized without mutating input; limits count Unicode scalar values", () => {
  const original = { ...baseManifest(), displayName: "  Cafe\u0301 🧪  ", description: "  A\u030a\nSecond\tline  " };
  const normalized = manifest.validateMarketRegistryManifest(original);
  assert.equal(normalized.displayName, "Café 🧪");
  assert.equal(normalized.description, "Å\nSecond\tline");
  assert.equal(original.displayName, "  Cafe\u0301 🧪  ");
  assert.notEqual(normalized.requestedCapabilities, original.requestedCapabilities);
  const maximum = manifest.validateMarketRegistryManifest({ ...baseManifest(), displayName: "🧪".repeat(100), description: "🧪".repeat(2000) });
  assert.equal([...maximum.displayName].length, 100);
  assert.equal([...maximum.description].length, 2000);
  assert.ok(Buffer.byteLength(JSON.stringify(maximum)) < 16384);
  for (const [key, value] of [
    ["displayName", "🧪".repeat(101)], ["description", "x".repeat(2001)],
    ["description", "x".repeat(16385)], ["displayName", ""], ["description", " \n\t "],
    ["displayName", "two\nlines"], ["displayName", "two\tcolumns"],
    ["description", "bad\u0000text"], ["description", "bad\u0007text"],
    ["displayName", "unpaired\ud800"], ["description", "unpaired\udc00"],
    ["description", 42],
  ]) inputError(() => manifest.validateMarketRegistryManifest({ ...baseManifest(), [key]: value }));
});

test("identifiers, revisions, hashes and review reasons have strict typed boundaries", () => {
  assert.equal(manifest.registryId(appId.toUpperCase()), appId.toUpperCase());
  for (const id of [null, "", " " + appId, appId + "'", 123, "12345678-1234-1234-1234-123456789abz"]) inputError(() => manifest.registryId(id));
  assert.equal(manifest.registryVersion("1"), 1);
  assert.equal(manifest.registryVersion("999999999"), 999999999);
  assert.equal(manifest.registryVersion("0", true), 0);
  for (const version of ["0", "01", "-1", "1.0", "1e2", " 1", "1000000000", 1, null]) inputError(() => manifest.registryVersion(version));
  assert.equal(manifest.registryHash(hash), hash);
  for (const value of [hash.toUpperCase(), hash.slice(1), hash + "a", "g".repeat(64), null]) inputError(() => manifest.registryHash(value));
  assert.equal(manifest.registryReason("  Cafe\u0301 checked  "), "Café checked");
  for (const value of ["", " ", "x".repeat(1001), "bad\u0000reason", "bad\ud800", null]) inputError(() => manifest.registryReason(value));
});

test("disabled flag is closed before authentication or RPC for every read and action", async () => {
  for (const flag of [undefined, "false", "1", "TRUE", "true "]) {
    reset();
    if (flag === undefined) delete process.env.MARKET_PRIVATE_REGISTRY_ENABLED;
    else process.env.MARKET_PRIVATE_REGISTRY_ENABLED = flag;
    assert.equal((await server.loadDeveloperWorkspace()).status, "disabled");
    assert.equal((await server.loadReviewQueue()).status, "disabled");
    for (const [name, makeForm] of actionCases) assert.equal((await actions[name](previous, makeForm())).ok, false);
    noCalls();
  }
});

test("invalid, duplicate and spoofed form fields are rejected before authentication", async () => {
  for (const [name, makeForm] of actionCases) {
    for (const field of ["publisherId", "userId", "actorId", "role", "salonId", "approved", "requestedCapabilities", "p_actor_user_id", "runtime", "priceCents"]) {
      reset(); const data = makeForm(); data.set(field, "untrusted");
      assert.equal((await actions[name](previous, data)).ok, false, `${name}: ${field}`);
      noCalls();
    }
    for (const [field, value] of makeForm().entries()) {
      reset(); const data = makeForm(); data.append(field, value);
      assert.equal((await actions[name](previous, data)).ok, false, `${name}: duplicate ${field}`);
      noCalls();
    }
  }
});

test("invalid action values and uploaded-file substitutes never reach the DAL", async () => {
  const invalidCases = [
    ["saveDraftAction", draft({ appId: "forged" })],
    ["saveDraftAction", draft({ appId, expectedVersion: "0" })],
    ["saveDraftAction", draft({ expectedVersion: "01" })],
    ["saveDraftAction", draft({ description: "x".repeat(20000) })],
    ["submitDraftAction", submit({ expectedVersion: "-1" })],
    ["submitDraftAction", submit({ appId: "" })],
    ["withdrawSubmissionAction", withdraw({ expectedHash: "invalid" })],
    ["reviewSubmissionAction", review({ expectedVersion: "0" })],
    ["reviewSubmissionAction", review({ expectedHash: hash.toUpperCase() })],
    ["reviewSubmissionAction", review({ decision: "live" })],
    ["reviewSubmissionAction", review({ decision: "installed" })],
    ["reviewSubmissionAction", review({ reason: " " })],
  ];
  const uploaded = draft(); uploaded.set("displayName", new Blob(["Fixture"]), "name.txt");
  invalidCases.push(["saveDraftAction", uploaded]);
  for (const [name, data] of invalidCases) {
    reset(); assert.equal((await actions[name](previous, data)).ok, false, name); noCalls();
  }
});

test("successful draft action sends normalized metadata and never accepts caller identity", async () => {
  const data = draft({ displayName: "  Cafe\u0301  ", description: "  Details  " });
  data.set("$ACTION_ID_fixture", "framework-protocol-only");
  const output = await actions.saveDraftAction({ ok: true, message: "spoofed", userId: "forged", role: "platform_owner" }, data);
  assert.equal(output.ok, true);
  assert.deepEqual(state.rpcCalls.map(({ name, params }) => ({ name, params })), [{
    name: "market_registry_save_draft",
    params: { p_app_id: null, p_expected_version: 0, p_manifest: { ...baseManifest(), displayName: "Café", description: "Details" } },
  }]);
  assert.deepEqual(state.revalidated, ["/developers/market", "/market-review"]);
  assert.deepEqual(state.authCalls[0].options, { throwOnUnavailable: true });
});

test("edits, submit, withdrawal and review preserve the exact revision and database hash", async () => {
  await actions.saveDraftAction(previous, draft({ appId, expectedVersion: "7" }));
  await actions.submitDraftAction(previous, submit());
  await actions.withdrawSubmissionAction(previous, withdraw());
  const approved = await actions.reviewSubmissionAction(previous, review({ reason: "  Metadata checked  " }));
  const rejected = await actions.reviewSubmissionAction(previous, review({ decision: "rejected", reason: "Explain intended feature." }));
  assert.equal(approved.ok, true); assert.equal(rejected.ok, true);
  assert.match(approved.message, /private.*cannot be installed/i);
  assert.deepEqual(state.rpcCalls.map(({ name, params }) => ({ name, params })), [
    { name: "market_registry_save_draft", params: { p_app_id: appId, p_expected_version: 7, p_manifest: baseManifest() } },
    { name: "market_registry_submit", params: { p_app_id: appId, p_expected_version: 7 } },
    { name: "market_registry_withdraw", params: { p_submission_id: submissionId, p_expected_hash: hash } },
    { name: "market_registry_review", params: { p_submission_id: submissionId, p_expected_version: 7, p_expected_hash: hash, p_decision: "metadata_approved", p_reason: "Metadata checked" } },
    { name: "market_registry_review", params: { p_submission_id: submissionId, p_expected_version: 7, p_expected_hash: hash, p_decision: "rejected", p_reason: "Explain intended feature." } },
  ]);
  assert.deepEqual(state.revalidated, Array.from({ length: 5 }, () => ["/developers/market", "/market-review"]).flat());
});

test("each read and action acquires the current user client rather than cached authority", async () => {
  const operations = [
    () => server.loadDeveloperWorkspace(), () => server.loadReviewQueue(),
    ...actionCases.map(([name, makeForm]) => () => actions[name](previous, makeForm())),
  ];
  for (const [index, operation] of operations.entries()) {
    state.actor = `synthetic-actor-${index}`; await operation();
  }
  assert.equal(state.authCalls.length, operations.length);
  assert.deepEqual(state.rpcCalls.map(call => call.clientId), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(state.rpcCalls.map(call => call.actor), operations.map((_, index) => `synthetic-actor-${index}`));
  assert.ok(state.authCalls.every(call => call.options.throwOnUnavailable === true));
});

test("unauthenticated access is denied without invoking RPC or revalidating", async () => {
  state.noSession = true;
  for (const loader of [server.loadDeveloperWorkspace, server.loadReviewQueue]) {
    const output = await loader(); assert.equal(output.status, "unauthorized"); assert.equal("data" in output, false);
  }
  for (const [name, makeForm] of actionCases) assert.equal((await actions[name](previous, makeForm())).ok, false);
  assert.equal(state.authCalls.length, 6);
  assert.deepEqual(state.rpcCalls, []); assert.deepEqual(state.revalidated, []);
});

test("RPC denial remains authoritative even for a caller labelled platform owner", async () => {
  state.actor = "platform_owner";
  state.rpcResult = { data: { shouldNotLeak: true }, error: { code: "42501", message: "synthetic internal ACL detail" } };
  for (const loader of [server.loadDeveloperWorkspace, server.loadReviewQueue]) {
    const output = await loader(); assert.equal(output.status, "unauthorized"); assert.equal("data" in output, false);
    assert.doesNotMatch(output.message, /internal ACL/);
  }
  for (const [name, makeForm] of actionCases) {
    const output = await actions[name](previous, makeForm()); assert.equal(output.ok, false); assert.doesNotMatch(output.message, /internal ACL/);
  }
  assert.equal(state.rpcCalls.length, 6); assert.deepEqual(state.revalidated, []);
});

test("SQL validation/conflict errors expose only safe action messages and never revalidate", async () => {
  for (const code of ["22023", "PT409", "40001", "23505", "P0001", "XX000", "42P01"]) {
    for (const [name, makeForm] of actionCases) {
      reset();
      state.rpcResult = { data: null, error: { code, message: "RAW_PRIVATE_SQL_DETAIL", details: "RAW_PRIVATE_CONNECTION_DETAIL", hint: "RAW_PRIVATE_HINT" } };
      const output = await actions[name](previous, makeForm());
      assert.equal(output.ok, false);
      assert.doesNotMatch(JSON.stringify(output), /RAW_PRIVATE|42P01|XX000|P0001/);
      if (code === "22023") assert.match(output.message, /invalid/i);
      if (["PT409", "40001", "23505"].includes(code)) assert.match(output.message, /changed.*reload/i);
      assert.equal(state.rpcCalls.length, 1); assert.deepEqual(state.revalidated, []);
    }
  }
});

test("thrown auth/provider failures and null RPC results remain sanitized and unavailable", async () => {
  for (const failure of ["authError", "rpcThrow", "null-result"]) {
    reset();
    if (failure === "null-result") state.rpcResult = { data: null, error: null };
    else state[failure] = new Error("RAW_PRIVATE_AUTH_PROVIDER_DETAIL");
    for (const loader of [server.loadDeveloperWorkspace, server.loadReviewQueue]) {
      const output = await loader(); assert.equal(output.status, "unavailable"); assert.equal("data" in output, false);
      assert.doesNotMatch(JSON.stringify(output), /RAW_PRIVATE/);
    }
    for (const [name, makeForm] of actionCases) {
      const output = await actions[name](previous, makeForm()); assert.equal(output.ok, false);
      assert.doesNotMatch(JSON.stringify(output), /RAW_PRIVATE/);
    }
    assert.deepEqual(state.revalidated, []);
    if (failure === "authError") assert.deepEqual(state.rpcCalls, []);
  }
});

test("the private action surface has no install, execution, billing or privileged helper boundary", () => {
  assert.deepEqual(Object.keys(actions).sort(), actionCases.map(([name]) => name).sort());
  const allowed = new Set([
    "<stdin>", "lib/market-registry/manifest.ts", "lib/market-registry/server.ts", "app/(market-private)/actions.ts",
    "fixture:server-only", "fixture:next/cache", "fixture:@/lib/supabase/server",
  ]);
  assert.deepEqual(Object.keys(result.metafile.inputs).map(path => path.replaceAll("\\", "/")).filter(path => !allowed.has(path)), [],
    "The tested boundary must not import service-role, owner-shortcut, plugin execution or billing dependencies.");
});

test("real offline-path policy excludes private developer and review routes", async () => {
  const bundled = await build({ entryPoints: ["lib/experience-offline-policy.ts"],
    bundle: true, write: false, platform: "node", format: "esm" });
  const { getExperienceOfflinePath } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
  assert.equal(getExperienceOfflinePath("/market?q=fixture"), "/market?q=fixture", "Existing public catalog remains eligible.");
  for (const route of ["/developers/market", "/market-review"]) {
    for (const suffix of ["", "/", "?q=fixture", "/?q=fixture", "?category=metadata"]) {
      assert.equal(getExperienceOfflinePath(route + suffix), null, route + suffix);
      assert.equal(getExperienceOfflinePath("https://reylumi.invalid" + route + suffix), null);
    }
  }
});
