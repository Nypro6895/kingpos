import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const mock = `
  export const getCurrentBusinessContext = async () => globalThis.__campaignReadContext;
  export const isOwnerMembership = membership => membership?.role === 'owner';
  export const isSalonManageContext = context => context.workspace === 'owner';
  export const advertisingClient = () => globalThis.__campaignReadClient;
  export function revalidatePath() { throw Error('Status must not revalidate'); }
`;
const bundle = await build({
  entryPoints: ["app/campaigns/actions.ts"], bundle: true, write: false,
  platform: "node", format: "esm", alias: { "@": process.cwd() },
  plugins: [{ name: "read-only-authorities", setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/cache|@\/lib\/(current-context|explore-advertising))$/ },
      args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" },
      args => ({ contents: args.path === "server-only" ? "" : mock, loader: "js" }));
  } }],
});
const { loadOwnerCampaignsAction } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"),
);
const salon = "10000000-0000-0000-0000-000000000001";
const otherSalon = "10000000-0000-0000-0000-000000000002";
const owner = {
  user: { id: "owner", status: "active" }, currentAccount: { status: "active" },
  currentSalon: { id: salon, status: "active" }, currentMembership: { role: "owner" },
  workspace: "owner",
};

function fixture() {
  const calls = [], state = { installed: true, readError: false };
  const accounting = { views: 7, spent_cents: 2, total_price_cents: 100, reserved_credits: 100, released_credits: 0 };
  const rows = [
    { id: "expired", salon_id: salon, status: "running", ends_at: "2000-01-01T00:00:00Z", ...accounting },
    { id: "paused", salon_id: salon, status: "paused", ends_at: "2000-01-01T00:00:00Z", ...accounting },
    { id: "returned", salon_id: salon, status: "cancelled", ...accounting, released_credits: 98 },
    { id: "other", salon_id: otherSalon, status: "running", ...accounting },
  ];
  globalThis.__campaignReadContext = structuredClone(owner);
  globalThis.__campaignReadClient = {
    async rpc(name, args) {
      calls.push({ operation: "rpc", name, args });
      assert.equal(name, "campaign_plugin_installed", "status must not close periods, admit views or alter wallets/ledger");
      return { data: state.installed, error: null };
    },
    from(table) {
      assert.ok(["owner_campaigns", "owner_campaign_settings"].includes(table), "status reads only campaign/settings tables");
      const filters = {}, memberships = {};
      const query = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        in(key, values) { memberships[key] = values; return this; },
        order() { return this; },
        async single() {
          calls.push({ operation: "read", table, filters: { ...filters } });
          assert.equal(table, "owner_campaign_settings"); assert.deepEqual(filters, { id: true });
          return { data: { config: {}, version: 7 }, error: null };
        },
        async range(from, through) {
          calls.push({ operation: "read", table, filters: { ...filters }, memberships, from, through });
          assert.equal(table, "owner_campaigns");
          assert.equal(filters.salon_id, globalThis.__campaignReadContext.currentSalon.id, "all status reads use current salon authority");
          const selected = rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)
            && Object.entries(memberships).every(([key, values]) => values.includes(row[key])));
          return { data: structuredClone(selected.slice(from, through + 1)), error: state.readError ? { message: "fixture read failed" } : null };
        },
      };
      for (const method of ["insert", "update", "delete", "upsert"]) {
        query[method] = () => assert.fail("status must not " + method + " " + table);
      }
      return query;
    },
  };
  return { calls, rows, state };
}

function cleanup() {
  delete globalThis.__campaignReadContext;
  delete globalThis.__campaignReadClient;
}

test("expired campaign status/history reads are repeatable and preserve authoritative accounting", async () => {
  const { rows, calls } = fixture(), before = structuredClone(rows);
  try {
    for (let i = 0; i < 3; i++) {
      const history = await loadOwnerCampaignsAction();
      const active = await loadOwnerCampaignsAction(0, true);
      assert.deepEqual(history.campaigns, before.slice(0, 3));
      assert.deepEqual(active.campaigns, before.slice(0, 2));
      assert.equal(history.settings.version, 7);
      assert.equal(history.hasMore, false);
      assert.equal(active.campaigns[0].status, "running", "read reports persisted status without closing an expired period");
    }
    assert.deepEqual(rows, before, "views, spend, reserve and released credits remain unchanged");
    assert.equal(calls.filter(call => call.operation === "rpc").length, 6);
    assert.ok(calls.every(call => call.operation === "read" || call.name === "campaign_plugin_installed"));
  } finally { cleanup(); }
});

test("status reads keep the actual owner/plugin guard and current salon scope", async () => {
  const { calls, state, rows } = fixture();
  try {
    for (const context of [
      { ...owner, user: null }, { ...owner, user: { id: "owner", status: "inactive" } },
      { ...owner, workspace: "personal" }, { ...owner, currentMembership: { role: "staff" } },
      { ...owner, currentAccount: { status: "inactive" } },
      { ...owner, currentSalon: { id: salon, status: "inactive" } },
    ]) {
      globalThis.__campaignReadContext = context;
      await assert.rejects(() => loadOwnerCampaignsAction(), /owner workspace/);
    }
    assert.deepEqual(calls, [], "unauthorized contexts do not access campaign data");
    globalThis.__campaignReadContext = structuredClone(owner); state.installed = false;
    await assert.rejects(() => loadOwnerCampaignsAction(), /Add Campaigns/);
    assert.equal(calls.length, 1); assert.equal(calls[0].name, "campaign_plugin_installed");
    state.installed = true;
    globalThis.__campaignReadContext = { ...owner, currentSalon: { id: otherSalon, status: "active" } };
    assert.deepEqual((await loadOwnerCampaignsAction()).campaigns, [rows[3]], "role context cannot read another salon's rows");
  } finally { cleanup(); }
});

test("invalid pagination and failed status reads cannot fall back to accounting mutations", async () => {
  const { calls, state } = fixture();
  try {
    for (const offset of [-1, 0.5, NaN, 100001]) {
      await assert.rejects(() => loadOwnerCampaignsAction(offset), /Reopen campaign history/);
    }
    assert.ok(!calls.some(call => call.table === "owner_campaigns"));
    state.readError = true;
    await assert.rejects(() => loadOwnerCampaignsAction(), /could not load/);
    assert.ok(calls.filter(call => call.operation === "rpc").every(call => call.name === "campaign_plugin_installed"));
  } finally { cleanup(); }
});
