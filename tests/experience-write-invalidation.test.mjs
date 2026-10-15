import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";

function load(file, dependencies) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports, Error, FormData, console,
    require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
  });
  return exports;
}

const SETTINGS_PATHS = ["/pos/settings", "/settings", "/staff/today", "/staff/my-work"];
const RELAY_PATHS = ["/staff/today", "/staff/my-work", "/notifications"];

function settings({ error = null, permitted = true, conflict = false } = {}) {
  const paths = [], writes = [];
  const client = {
    rpc: async (name, args) => { writes.push({ name, args }); return { data: { staff_check_in_enabled: true }, error }; },
    from() { return { select() { return this; }, eq() { return this; }, single: async () => ({ data: conflict ? { staff_check_in_enabled: false } : null }) }; },
  };
  const api = load("app/pos/settings/actions.ts", {
    crypto,
    "next/cache": { revalidatePath: path => paths.push(path) },
    "next/navigation": { redirect: path => { throw Error(`Redirect ${path}`); } },
    "@/lib/current-context": { getCurrentBusinessContext: async () => ({ user: { id: "owner" }, currentSalon: { id: "salon" } }), isSalonManageContext: () => true },
    "@/lib/permissions": { hasPermission: async () => permitted },
    "@/lib/pos-portable-access": {},
    "@/lib/pos-portable-capabilities": {},
    "@/lib/pos-settings": { POS_SETTING_DEFAULTS: { tipSuggestions: [10, 15, 20, 25] } },
    "@/lib/pos-workspace-preferences": { normalizeWorkspacePreferences: value => value },
    "@/lib/supabase/postgrest-errors": {},
    "@/lib/pos-tickets": { POS_TICKET_PERMISSIONS: { manage: "tickets.manage" } },
    "@/lib/supabase/server": { createAuthenticatedSupabaseServerClient: async () => client },
  });
  return { ...api, paths, writes };
}

function settingsForm(group = "staff") {
  const form = new FormData();
  form.set("group", group);
  form.set("expected", JSON.stringify({ staff_check_in_enabled: false }));
  form.set("staff_check_in_enabled", "on");
  return form;
}

test("a committed settings save invalidates retained views without waiting for a socket hint", async () => {
  const f = settings();
  const result = await f.savePosSettingsGroup(settingsForm());
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.staff_check_in_enabled, true);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].name, "save_pos_workspace_settings");
  assert.equal(f.writes[0].args.p_salon, "salon");
  assert.deepEqual(f.paths, SETTINGS_PATHS);
});

test("settings conflicts, database failures, invalid input and denied permissions do not invalidate", async () => {
  for (const options of [{ error: { message: "Write failed" } }, { error: { message: "These settings changed on another screen" }, conflict: true }]) {
    const f = settings(options);
    assert.equal((await f.savePosSettingsGroup(settingsForm())).ok, false);
    assert.deepEqual(f.paths, []);
  }
  const invalid = settings();
  assert.equal((await invalid.savePosSettingsGroup(settingsForm("unknown"))).ok, false);
  assert.deepEqual(invalid.writes, []);
  assert.deepEqual(invalid.paths, []);
  const denied = settings({ permitted: false });
  await assert.rejects(denied.savePosSettingsGroup(settingsForm()), /permission/);
  assert.deepEqual(denied.writes, []);
  assert.deepEqual(denied.paths, []);
});

function relay({ error = null, permitted = true, failedBroadcast = false } = {}) {
  const paths = [], calls = [], broadcasts = [];
  const client = {
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { ticketId: "ticket" }, error }; },
    from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { plugin_id: "relay" }, error }) }; },
  };
  const context = permitted ? { user: { id: "owner" }, currentSalon: { id: "salon" } } : {};
  const api = load("app/service-relay/actions.ts", {
    "@/lib/staff-portal-identity": { getStaffPortalIdentity: async () => ({ context, staff: permitted ? { id: "staff" } : null, supabase: client }) },
    "@/lib/current-context": { getCurrentBusinessContext: async () => context },
    "@/lib/supabase/server": { createAuthenticatedSupabaseServerClient: async () => client, createSupabaseServerClient: () => client },
    "@/lib/market-plugins": {},
    "@/lib/pos-staff-realtime-server": { broadcastPosStaffChange: async (...args) => { broadcasts.push(args); if (failedBroadcast) throw Error("Socket unavailable"); } },
    "next/cache": { revalidatePath: path => paths.push(path) },
    "@/types/service-relay": { SERVICE_RELAY_PLUGIN: "relay" },
  });
  return { ...api, paths, calls, broadcasts };
}

const relayWrites = [
  ["respondServiceRelay", ["offer", true], "service_relay_respond"],
  ["saveServiceRelay", [{ offerId: "offer", lines: [], done: true, revision: 2 }], "service_relay_save"],
  ["submitServiceRelay", [{ visitId: "visit", revision: 2, tip: 0, discount: 0 }], "service_relay_submit"],
  ["findServiceRelay", [" code "], "service_relay_claim"],
];

for (const [name, args, rpc] of relayWrites) {
  test(`${name} signals a committed write, while failed/denied operations leave caches intact`, async () => {
    const f = relay();
    assert.equal((await f[name](...args)).ok, true);
    assert.equal(f.calls[0].name, rpc);
    assert.equal(f.calls[0].args.p_salon, "salon");
    assert.deepEqual(f.paths, RELAY_PATHS);
    assert.deepEqual(f.broadcasts, [["salon", "pos"]]);
    for (const options of [{ error: { message: "Write failed" } }, { permitted: false }]) {
      const failed = relay(options);
      assert.ok((await failed[name](...args)).error);
      assert.deepEqual(failed.paths, []);
      assert.deepEqual(failed.broadcasts, []);
      if (!options.permitted && options.permitted !== undefined) assert.deepEqual(failed.calls, []);
    }
  });
}

test("relay reads never invalidate retained views or broadcast mutations", async () => {
  const f = relay();
  await f.loadServiceRelay();
  await f.loadServiceRelay(true);
  await f.serviceRelayInstalled("salon");
  assert.deepEqual(f.calls.map(call => call.name), ["service_relay_workspace", "service_relay_workspace"]);
  assert.deepEqual(f.paths, []);
  assert.deepEqual(f.broadcasts, []);
});

test("a relay write already committed still invalidates if its realtime hint fails", async () => {
  const f = relay({ failedBroadcast: true });
  await f.respondServiceRelay("offer", true);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.paths, RELAY_PATHS);
});
