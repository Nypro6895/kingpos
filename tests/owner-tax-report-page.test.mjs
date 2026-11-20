import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function fixture({ owner = true, unavailable = false, qa = null } = {}) {
  const calls = [];
  const context = { user: { id: "owner" }, currentSalon: { id: "salon" }, currentMembership: { role: owner ? "Owner" : "Manager" } };
  const report = { salon: { id: "salon" }, runs: [], lines: [] };
  const file = "app/(app)/payroll/tax-company/page.tsx";
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const source = ts.createPrinter().printFile(ts.factory.updateSourceFile(ast, ast.statements.filter((statement) => !ts.isImportDeclaration(statement))));
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const deps = {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    withExperiencePage: (page) => page,
    WorkspaceText: Symbol("Text"), OwnerTaxReport: Symbol("OwnerTaxReport"), PayrollTaxCompanyLiveReport: Symbol("LegacyReport"),
    taxQaRequest: async () => qa,
    requireSalonManagePageContext: async (path) => { calls.push(["guard", path]); return context; },
    isOwnerMembership: () => owner,
    loadOwnerTaxReport: async (received) => { calls.push(["report", received]); if (unavailable) throw Error("Unavailable"); return report; },
  };
  const mod = { exports: {} };
  new Function("module", "exports", ...Object.keys(deps), code)(mod, mod.exports, ...Object.values(deps));
  return { page: mod.exports.default, deps, calls, context, report };
}

test("real owner page loads the shared report without a live-payroll or plugin branch", async () => {
  const f = fixture(), query = { month: "2026-10" };
  const result = await f.page({ searchParams: Promise.resolve(query) });
  assert.equal(result.type, f.deps.OwnerTaxReport);
  assert.equal(result.props.data, f.report);
  assert.deepEqual(result.props.initialPeriod, query);
  assert.equal(f.calls[1][1], f.context);
  const other = await f.page({ searchParams: Promise.resolve({ month: "2026-11" }) });
  assert.notEqual(result.props.key, other.props.key, "Explicit same-salon period navigation must reset filters");
});
test("owner read failure stays unavailable without using the delegated live report", async () => {
  const f = fixture({ unavailable: true });
  const result = await f.page({ searchParams: Promise.resolve({}) });
  assert.equal(result.type, "main");
  assert.equal(f.calls.filter(([name]) => name === "report").length, 1);
  assert.notEqual(result.type, f.deps.PayrollTaxCompanyLiveReport);
});
test("non-owner preserves the previous authorized report, without calling the owner reader", async () => {
  const f = fixture({ owner: false });
  const query = { month: "2026-11" };
  const result = await f.page({ searchParams: Promise.resolve(query) });
  assert.equal(result.type, f.deps.PayrollTaxCompanyLiveReport);
  assert.deepEqual(await result.props.searchParams, query);
  assert.equal(f.calls.some(([name]) => name === "report"), false);
});
