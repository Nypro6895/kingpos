import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const actionModule = "app/pos/settings/actions.ts";
const actionName = "loadDeviceDisplayAppearance";
const actionID = "action." + createHash("sha256").update(actionModule + "#" + actionName).digest("hex").slice(0, 24);

async function originalRead(options = {}) {
  const source = await fs.readFile(path.join(root, actionModule), "utf8");
  const ast = ts.createSourceFile(actionModule, source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === actionName);
  assert.ok(node, "Exercise the unchanged original server read, never a copied permission model");
  const javascript = ts.transpileModule(node.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [];
  const context = { user: { id: "synthetic-owner" }, currentSalon: { id: "synthetic-salon" }, ...options.context };
  const snapshot = { customer_left_ad_text: "Synthetic promotion" };
  const client = { from(table) { calls.push(["from", table]); return { select(columns) { calls.push(["select", columns]); return { eq(column, value) { calls.push(["eq", column, value]); return { async maybeSingle() { return { data: snapshot, error: options.queryError ? new Error("Synthetic read failure") : null }; } }; } }; } }; } };
  const exported = {};
  vm.runInNewContext(javascript, {
    exports: exported,
    getCurrentBusinessContext: async () => context,
    isSalonManageContext: () => options.manageWorkspace !== false,
    POS_TICKET_PERMISSIONS: { manage: "pos.manage" },
    hasPermission: async (permission, value) => { calls.push(["permission", permission, value.currentSalon?.id]); return options.permission !== false; },
    createAuthenticatedSupabaseServerClient: async () => { calls.push(["client"]); return options.clientAvailable === false ? null : client; },
    getCurrentSalonPosSettings: async value => { calls.push(["settings", value.currentSalon.id]); return { synthetic: true }; },
  });
  return { read: exported[actionName], calls, snapshot };
}

test("appearance read keeps original owner/workspace/permission and expected-salon boundaries", async () => {
  for (const options of [
    { context: { user: null } },
    { context: { currentSalon: null } },
    { manageWorkspace: false },
    { permission: false },
    { expectedSalonId: "another-salon" },
  ]) {
    const fixture = await originalRead(options);
    const result = await fixture.read(options.expectedSalonId);
    assert.equal(typeof result.error, "string");
    assert.equal(fixture.calls.some(([name]) => name === "client"), false, "Denied/mismatched salon cannot query settings");
    assert.equal(result.settings, undefined);
    assert.equal(result.snapshot, undefined);
  }
});

test("appearance read loads only the selected salon's explicit appearance fields and preserves errors", async () => {
  const fixture = await originalRead();
  const result = await fixture.read("synthetic-salon");
  assert.equal(result.salonId, "synthetic-salon");
  assert.deepEqual(result.snapshot, fixture.snapshot);
  assert.deepEqual(fixture.calls.find(([name]) => name === "permission"), ["permission", "pos.manage", "synthetic-salon"]);
  assert.deepEqual(fixture.calls.find(([name]) => name === "select"), ["select", "customer_background_image_path,customer_left_ad_image_path,customer_right_ad_image_path,customer_left_ad_text,customer_right_ad_text"]);
  assert.deepEqual(fixture.calls.find(([name]) => name === "eq"), ["eq", "salon_id", "synthetic-salon"]);
  for (const options of [{ clientAvailable: false }, { queryError: true }]) {
    const denied = await originalRead(options), value = await denied.read("synthetic-salon");
    assert.equal(typeof value.error, "string");
    assert.equal(denied.calls.some(([name]) => name === "settings"), false);
  }
});

test("installed generator resolves exact appearance read without granting it to a paired portable device", async () => {
  const policy = JSON.parse(await fs.readFile(path.join(root, "lib/app-local-command-policy.json"), "utf8"));
  assert.equal(policy.modules[actionModule].filter(name => name === actionName).length, 1);
  const portable = JSON.parse(await fs.readFile(path.join(root, "lib/app-local-portable-actions.generated.json"), "utf8"));
  assert.equal(portable.ids.includes(actionID), false, "Owner appearance settings cannot borrow device/PIN authority");
  const generator = await fs.readFile(path.join(root, "scripts/build-app-local-bundle.mjs"), "utf8");
  const start = generator.indexOf("const nextPlugin = ");
  const end = generator.indexOf("// Only these already-public", start);
  assert.ok(start >= 0 && end > start);
  const expression = generator.slice(start + "const nextPlugin = ".length, end).trim().replace(/;$/, "");
  const commandNames = new Map(Object.entries(policy.modules).flatMap(([module, names]) => names.map(name => [module + "#" + name, "action." + createHash("sha256").update(module + "#" + name).digest("hex").slice(0, 24)])));
  const unsupported = new Map();
  // Run the actual packager boundary plugin and installed entry graph entirely
  // in memory. No manifest, generated server mapping or bundle file is written.
  const plugin = new Function("fs", "path", "ts", "root", "commandNames", "unsupported", "wrappers", "return (" + expression + ");")(fs, path, ts, root, commandNames, unsupported, "app-local-next");
  const result = await build({ absWorkingDir: root, entryPoints: ["app/local-app/entry.tsx"], outfile: path.join(root, "artifacts/native-action-boundary/app.js"), write: false, bundle: true, format: "iife", platform: "browser", target: ["safari16"], minify: true, jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), plugins: [plugin], loader: { ".png": "file", ".svg": "file", ".woff2": "file" }, define: { __REYLUMI_SERVICES_CATALOG_QA__: "false", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_APP_URL": '"https://reylumi.com"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '"https://fixture.supabase.co"', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""', "process.env.NEXT_PUBLIC_MAPTILER_KEY": '""', "process.env.NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY": '""' } });
  const javascript = result.outputFiles.find(file => file.path.endsWith("app.js"))?.text;
  assert.ok(javascript);
  assert.ok(javascript.includes(actionID), "The real DeviceAppearance path remains reachable in the installed app");
  const activeUnsupported = [...unsupported.keys()].filter(name => javascript.includes("__unsupported_action:" + name));
  assert.deepEqual(activeUnsupported, []);
  // The real plugin output, rather than an action-name guess, proves load*
  // requests retain its non-invalidating read behavior.
  const loaded = await new Promise((resolve, reject) => {
    const hooks = [];
    plugin.setup({ onResolve() {}, onLoad(options, callback) { hooks.push({ options, callback }); } });
    const sourceHook = hooks.find(hook => hook.options.filter.test("actions.ts") && !hook.options.namespace);
    Promise.resolve(sourceHook.callback({ path: path.join(root, actionModule) })).then(resolve, reject);
  });
  assert.match(loaded.contents, new RegExp("export const " + actionName + "=\\(\\.\\.\\.values\\)=>invokeAppLocalCommand\\(\"" + actionID + "\",values,false,"));
});
