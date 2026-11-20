import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("lib/tax-workspace.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ signedIn = true, failure = null } = {}) {
  const calls = [], report = { salon: { id: "salon" }, runs: [], lines: [] };
  const client = {
    async rpc(name, args) { calls.push({ name, args }); return { data: report, error: failure }; },
    from() { throw new Error("The numeric report must not read documents or other workspace tables."); },
  };
  const exports = {};
  const require = name => {
    if (name === "server-only") return {};
    if (name === "@/lib/supabase/server") return { createAuthenticatedSupabaseServerClient: async () => client };
    if (name === "@/lib/current-context") return { getCurrentBusinessContext: async () => ({ user: signedIn ? { id: "owner" } : null }) };
    throw new Error(`Unexpected import ${name}`);
  };
  new Function("exports", "require", source)(exports, require);
  return { ...exports, calls, report };
}
test("numeric tax report uses one authenticated scoped RPC without loading workspace records", async () => {
  const f = fixture();
  assert.equal(await f.loadTaxReport("salon"), f.report);
  assert.deepEqual(f.calls, [{ name: "tax_report_data", args: { p_salon: "salon" } }]);
});
test("numeric report denies missing identity before reading", async () => {
  const f = fixture({ signedIn: false });
  await assert.rejects(f.loadTaxReport("salon"), /sign in/i);
  assert.deepEqual(f.calls, []);
});
test("numeric report fails closed without retrying a broader workspace or live payroll read", async () => {
  const f = fixture({ failure: { message: "Scoped report unavailable" } });
  await assert.rejects(f.loadTaxReport("salon"), /Scoped report unavailable/);
  assert.equal(f.calls.length, 1);
});
