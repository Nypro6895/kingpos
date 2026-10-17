import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function service({ allowed = true, rows = [], rpcError = null } = {}) {
  const source = readFileSync("lib/salon-profile.ts", "utf8");
  const ast = ts.createSourceFile("salon-profile.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["setCurrentSalonProfileLookStatus", "deleteCurrentSalonProfileLook"];
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(nodes.length, names.length);
  const code = ts.transpileModule(nodes.map(node => source.slice(node.getStart(ast), node.end)).join("\n"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = [];
  const context = { user: { id: "owner" } };
  const client = {
    from(table) {
      calls.push({ kind: "query", table });
      const filters = {};
      const query = {
        select: () => query,
        eq(key, value) { filters[key] = value; return query; },
        maybeSingle: async () => ({ data: rows.find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null, error: null }),
        update: () => assert.fail("Archive/delete must use the shared server authority"),
        delete: () => assert.fail("Delete must use the shared server authority"),
      };
      return query;
    },
    async rpc(name, payload) { calls.push({ kind: "rpc", name, payload }); return { data: { ok: true }, error: rpcError ? { message: rpcError } : null }; },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, Error,
    SALON_PROFILE_PERMISSIONS: { contentManage: "salon_profile.content.manage" },
    getCurrentBusinessContext: async () => context,
    requirePermission: async (permission, actualContext) => {
      assert.equal(permission, "salon_profile.content.manage"); assert.equal(actualContext, context);
      calls.push({ kind: "permission" });
      if (!allowed) throw new Error("Permission denied.");
    },
    requireCurrentAccountAndSalon: () => ({ salon: { id: "current-salon" } }),
    createAuthenticatedSupabaseServerClient: async () => client,
    removeTrustedSalonProfileMediaPath: async input => calls.push({ kind: "cleanup", path: input.path, context: input.context, allowLegacy: input.allowLegacy }),
  });
  return { ...exports, calls, context };
}

for (const mutation of ["archive", "delete"]) {
  const run = (fixture, id) => mutation === "archive" ? fixture.setCurrentSalonProfileLookStatus({ lookId: id, status: "archived" }) : fixture.deleteCurrentSalonProfileLook(id);
  test(`Salon ${mutation} rejects missing and other-salon targets before the shared mutation`, async () => {
    const fixture = service({ rows: [{ id: "foreign", salon_id: "another-salon", media_path: "foreign.webp" }] });
    for (const id of ["foreign", "missing"]) await assert.rejects(run(fixture, id), /not found in the current salon/);
    assert.equal(fixture.calls.filter(call => call.kind === "rpc").length, 0);
    assert.equal(fixture.calls.filter(call => call.kind === "cleanup").length, 0);
  });
  test(`Salon ${mutation} preserves the application permission check and propagates shared authorization failure`, async () => {
    const denied = service({ allowed: false });
    await assert.rejects(run(denied, "post"), /Permission denied/);
    assert.equal(denied.calls.filter(call => ["query", "rpc", "cleanup"].includes(call.kind)).length, 0);
    const fixture = service({ rows: [{ id: "post", salon_id: "current-salon", media_path: "owned.webp" }], rpcError: "You cannot manage this post." });
    await assert.rejects(run(fixture, "post"), /cannot manage/);
    assert.equal(fixture.calls.filter(call => call.kind === "cleanup").length, 0, "A rejected mutation must not remove media");
  });
  test(`Salon ${mutation} goes through the shared mutation and cleans media only after a successful delete`, async () => {
    const fixture = service({ rows: [{ id: "post", salon_id: "current-salon", media_path: "owned.webp" }] });
    await run(fixture, "post");
    const calls = fixture.calls.filter(call => call.kind === "rpc");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "post_safety_action");
    assert.equal(calls[0].payload.p_type, "salon_profile_look");
    assert.equal(calls[0].payload.p_id, "post");
    assert.equal(calls[0].payload.p_action, mutation);
    const cleanup = fixture.calls.filter(call => call.kind === "cleanup");
    assert.equal(cleanup.length, mutation === "delete" ? 1 : 0);
    if (mutation === "delete") {
      assert.equal(cleanup[0].path, "owned.webp");
      assert.equal(cleanup[0].context, fixture.context);
      assert.equal(cleanup[0].allowLegacy, true);
      assert.ok(fixture.calls.indexOf(cleanup[0]) > fixture.calls.indexOf(calls[0]));
    }
  });
}

function hiddenIdentities(client) {
  const source = readFileSync("app/post-moderation/actions.ts", "utf8");
  const ast = ts.createSourceFile("actions.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === "loadHiddenPostIdentitiesAction");
  assert.ok(node);
  const code = ts.transpileModule(source.slice(node.getStart(ast), node.end), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Error,
    createAuthenticatedSupabaseServerClient: async () => client,
    createSafetySupabaseServerClient: async () => null,
  });
  return exports.loadHiddenPostIdentitiesAction;
}

test("unavailable hidden-post lookup rejects so offline local reports are not treated as an authoritative empty list", async () => {
  await assert.rejects(hiddenIdentities(null)(), /unavailable|unable/i);
  await assert.rejects(hiddenIdentities({ rpc: async () => ({ data: null, error: { message: "offline" } }) })(), /unavailable|unable/i);
});

test("a successful hidden-post lookup returns the authoritative server identities, including an actually empty list", async () => {
  for (const data of [[], [{ source_type: "beauty_post", source_id: "post" }]]) {
    const result = await hiddenIdentities({ rpc: async name => {
      assert.equal(name, "get_my_hidden_posts"); return { data, error: null };
    } })();
    assert.deepEqual(Array.from(result), data.map(row => `${row.source_type}:${row.source_id}`));
  }
});
