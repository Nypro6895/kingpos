import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

function compileFunctions(file, names, dependencies, tail = "") {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const code = names.map(name => {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `${file}: ${name}`);
    return declaration.getText(source);
  }).join("\n");
  const exports = {};
  const javascript = ts.transpileModule(code + tail, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function("exports", ...Object.keys(dependencies), javascript)(exports, ...Object.values(dependencies));
  return exports;
}

const metadata = {};
new Function("exports", ts.transpileModule(fs.readFileSync("lib/app-local-payroll-tax-metadata.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(metadata);

function fixture() {
  const state = { publishedReads: 0, legacyReads: 0, settingsReads: 0, owner: true, available: true, loaderError: null };
  const root = { user: { id: "owner" }, scope: "salon-a" };
  const context = { ...root, currentMembership: { role: "OWNER" }, currentSalon: { id: "salon-a" } };
  const report = { salon: { id: "salon-a", name: "Salon A" }, runs: [{ id: "published-run", version: 2 }], lines: [{ id: "published-line", tax_company_taxable_gross: 421 }] };
  const legacy = {
    context,
    access: { canViewAllPayroll: true },
    latestStatement: { run: { id: "legacy-run", version: 1, status: "published", privateSnapshot: "omit" } },
    lines: [{ staff_id: "staff", tax_company_taxable_gross: 999 }],
    period: { start: "2026-11-01", end: "2026-11-14" },
    periodOptions: [], scheduleSetup: null, salonPayrollSetting: {}, source: "live", summary: {},
  };
  const { readAppLocalPayrollTaxResource: read } = compileFunctions("lib/app-local-payroll-tax-server.ts", ["fail", "check", "readAppLocalPayrollTaxResource"], {
    createHash,
    headers: async () => new Headers(state.available ? {} : { "x-reylumi-auth-unavailable": "1" }),
    getRequestBusinessContext: async () => root,
    getExperienceContext: value => ({ scope: value.scope }),
    runReadWithDeadline: async value => value,
    requireSalonManagePageContext: async () => context,
    isOwnerMembership: () => state.owner,
    loadOwnerTaxReport: async value => { assert.equal(value, context); state.publishedReads++; if (state.loaderError) throw state.loaderError; return report; },
    getPayrollTaxCompanyData: async () => { state.legacyReads++; return legacy; },
    taxCompanySettings: async () => { state.settingsReads++; return { active: false, enabled: false }; },
    APP_LOCAL_PAYROLL_TAX_READS: metadata.APP_LOCAL_PAYROLL_TAX_READS,
  });
  return { state, root, context, report, legacy,
    read: (args = {}, options = {}) => read("owner.tax-report", args, { scope: "salon-a", ...options }),
    readLegacy: (args = {}, options = {}) => read("owner.payroll-tax-report", args, { scope: "salon-a", ...options }),
    readSettings: () => read("owner.payroll-tax-settings", {}, { scope: "salon-a" }),
  };
}

test("owner app-local read returns only the published mirror without live payroll or plugin settings", async () => {
  const f = fixture();
  const response = await f.read({ month: "2026-11" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { source: "published-tax", report: f.report });
  assert.equal(f.state.publishedReads, 1);
  assert.equal(f.state.legacyReads, 0);
  assert.equal(f.state.settingsReads, 0);
  const unchanged = await f.read({ month: "2026-11" }, { etag: response.etag });
  assert.equal(unchanged.status, 304);
  assert.equal(Object.hasOwn(unchanged, "data"), false);
  f.report.lines[0].tax_company_taxable_gross = 422;
  assert.notEqual((await f.read({ month: "2026-11" })).etag, response.etag);
});

test("an authorized non-owner retains the legacy live report and stripped statement header", async () => {
  const f = fixture(); f.state.owner = false;
  const response = await f.read();
  assert.equal(response.data.source, "live");
  assert.deepEqual(response.data.lines, f.legacy.lines);
  assert.deepEqual(response.data.latestStatement, { run: { id: "legacy-run", version: 1, status: "published" } });
  assert.equal(Object.hasOwn(response.data, "context"), false);
  assert.equal(f.state.legacyReads, 1);
  assert.equal(f.state.publishedReads, 0);
});

test("the old resource keeps its legacy owner DTO for installed app clients", async () => {
  const f = fixture();
  const response = await f.readLegacy({ month: "2026-11" });
  assert.equal(response.status, 200);
  assert.equal(response.data.source, "live");
  assert.deepEqual(response.data.lines, f.legacy.lines);
  assert.deepEqual(response.data.access, f.legacy.access);
  assert.deepEqual(response.data.period, f.legacy.period);
  assert.equal(Object.hasOwn(response.data, "report"), false);
  assert.equal(f.state.legacyReads, 1);
  assert.equal(f.state.publishedReads, 0);
  assert.equal(f.state.settingsReads, 0);
  assert.equal(metadata.APP_LOCAL_PAYROLL_TAX_READS["owner.tax-report"].retention, "none");
  assert.equal(metadata.APP_LOCAL_PAYROLL_TAX_READS["owner.payroll-tax-report"].retention, "none");
});

test("old and new resources have independent ETags and cache cells even when a viewer receives identical data", async () => {
  const f = fixture(); f.state.owner = false;
  const legacy = await f.readLegacy();
  const current = await f.read({}, { etag: legacy.etag });
  assert.deepEqual(current.data, legacy.data);
  assert.equal(current.status, 200);
  assert.notEqual(current.etag, legacy.etag);
  assert.equal((await f.readLegacy({}, { etag: current.etag })).status, 200);
  const cells = new Map();
  const { cellFor } = compileFunctions("lib/app-local-resource.ts", ["stable", "cellFor"], {
    cells, epoch: 0, appLocalResourceCache: { get: () => undefined },
  }, "\nexport {cellFor};");
  const oldCell = cellFor("salon-a", "owner.payroll-tax-report", { month: "2026-11" });
  const newCell = cellFor("salon-a", "owner.tax-report", { month: "2026-11" });
  assert.notEqual(oldCell.key, newCell.key);
  assert.notEqual(oldCell.cell, newCell.cell);
  assert.notEqual(oldCell.cell.context.key, newCell.cell.context.key);
  assert.equal(cellFor("salon-a", "owner.tax-report", { month: "2026-11" }).cell, newCell.cell);
});

test("owner loader denial cannot fall back to payroll or subscription settings", async () => {
  const f = fixture(); f.state.loaderError = Error("Salon owner access required.");
  await assert.rejects(f.read(), /Salon owner access required/);
  assert.equal(f.state.legacyReads, 0);
  assert.equal(f.state.settingsReads, 0);
});

test("app-local Tax keeps auth, workspace, abort and argument checks before releasing published data", async () => {
  for (const variant of ["auth", "unavailable", "scope", "context-scope", "user", "abort", "args"]) {
    const f = fixture();
    const options = {}, args = {};
    if (variant === "auth") f.root.user = null;
    if (variant === "unavailable") f.state.available = false;
    if (variant === "scope") options.scope = "another-salon";
    if (variant === "context-scope") f.context.scope = "another-salon";
    if (variant === "user") f.context.user = { id: "another-user" };
    if (variant === "abort") options.signal = AbortSignal.abort();
    if (variant === "args") args.token = "not-allowed";
    await assert.rejects(f.read(args, options));
    assert.equal(f.state.publishedReads, 0, variant);
    assert.equal(f.state.legacyReads, 0, variant);
  }
});

test("app-local settings retain their original authoritative loader", async () => {
  const f = fixture();
  assert.deepEqual((await f.readSettings()).data, { active: false, enabled: false });
  assert.equal(f.state.settingsReads, 1);
  assert.equal(f.state.publishedReads, 0);
});

test("the app-local registry renders the owner mirror and keeps the legacy and settings branches", () => {
  let data = { source: "published-tax", report: { salon: {}, runs: [], lines: [] } };
  const reads = [];
  const OwnerTaxReport = Symbol("OwnerTaxReport"), AppLocalPayrollTax = Symbol("AppLocalPayrollTax"), AppLocalPayrollTaxSettings = Symbol("AppLocalPayrollTaxSettings");
  const { PayrollTaxPage, getAppLocalPayrollTaxPage } = compileFunctions("lib/app-local-payroll-tax-registry.tsx", ["PayrollTaxPage", "getAppLocalPayrollTaxPage"], {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
    useAppLocalResource: (scope, name, args) => { reads.push({ scope, name, args }); return { data }; },
    OwnerTaxReport, AppLocalPayrollTax, AppLocalPayrollTaxSettings,
    filters: ["end", "month", "payPeriodStart", "preset", "segment", "start"],
  }, "\nexport { PayrollTaxPage };");
  const props = { path: "/payroll/tax-company?month=2026-11", context: { context: { authenticated: true, scope: "salon-a" } } };
  const owner = PayrollTaxPage(props);
  assert.equal(owner.type, OwnerTaxReport);
  assert.equal(owner.props.data, data.report);
  assert.deepEqual(owner.props.initialPeriod, { month: "2026-11" });
  assert.equal(owner.props.key, 'salon-a:{"month":"2026-11"}');
  assert.deepEqual(reads.at(-1), { scope: "salon-a", name: "owner.tax-report", args: { month: "2026-11" } });
  data = { source: "live", lines: [] };
  assert.equal(PayrollTaxPage(props).type, AppLocalPayrollTax);
  data = { active: false };
  assert.equal(PayrollTaxPage({ ...props, path: "/payroll/tax-company/settings" }).type, AppLocalPayrollTaxSettings);
  assert.equal(reads.at(-1).name, "owner.payroll-tax-settings");
  assert.equal(getAppLocalPayrollTaxPage(props.path).title, "Tax");
  assert.equal(getAppLocalPayrollTaxPage(props.path).id, "owner.payroll-tax-report");
  for (const path of ["/payroll/tax-company?token=secret", "/payroll/tax-company?month=a&month=b", "//other.invalid/payroll/tax-company", "/payroll%2ftax-company"]) assert.equal(getAppLocalPayrollTaxPage(path), null);
});
