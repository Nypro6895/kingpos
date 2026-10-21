import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = fileURLToPath(new URL("../", import.meta.url));

// Run the real presentation and pure export modules without Next, actions, a
// server, or a database. Unknown runtime imports fail closed. All fixtures below
// are synthetic. Controls are inert; translations render their English input.
const h = React.createElement;
const language = {
  WorkspaceText: ({ text }) => h(React.Fragment, null, text),
  WorkspaceElement: ({ as: tag = "div", children, ...props }) => h(tag, props, children),
};
const stubs = new Map([
  ["@/components/workspace-language", language],
  ["./owner-payroll-form", { OwnerPayrollForm: ({ kind }) => h("form", { "data-test": "owner-form", "data-kind": kind }) }],
  ["./payroll-export-button", { PayrollExportButton: ({ filename }) => h("button", { "data-export": filename }, "Export CSV") }],
  ["./staff-pay-period-picker", { StaffPayPeriodPicker: () => h("select", { "data-test": "period-picker", "aria-label": "Pay period" }) }],
  ["@/app/payroll/paystub-upload-control", { PaystubUploadControl: () => h("button", { "data-test": "paystub-upload" }, "Upload") }],
]);
const allowed = new Set([
  "app/payroll/payroll-ledger-panel.tsx",
  "app/payroll/tax-company-table.tsx",
  "app/staff/my-work/staff-pay-analysis.tsx",
  "lib/payroll-export.ts",
  "lib/payroll-money.ts",
  "lib/staff-payroll-display.ts",
  "lib/staff-payroll-period.ts",
]);
const cache = new Map();
function evaluate(source, filename, importFrom) {
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, require: importFrom,
    console, Intl, Date,
  }, { filename });
  return module.exports;
}
function load(relative) {
  const normalized = relative.replaceAll("\\", "/");
  assert.ok(allowed.has(normalized), `Unexpected runtime module: ${normalized}`);
  if (cache.has(normalized)) return cache.get(normalized);
  const filename = path.join(root, normalized);
  const exports = evaluate(readFileSync(filename, "utf8"), filename, specifier => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier.endsWith(".module.css")) return { default: new Proxy({}, { get: (_target, key) => String(key) }) };
    const target = specifier.startsWith("@/") ? specifier.slice(2)
      : path.posix.join(path.posix.dirname(normalized), specifier);
    const matched = [target, `${target}.ts`, `${target}.tsx`].find(candidate => allowed.has(candidate));
    assert.ok(matched, `Unapproved runtime import ${specifier} from ${normalized}`);
    return load(matched);
  });
  cache.set(normalized, exports);
  return exports;
}

const { PayrollLedgerPanel, PayrollAdjustmentHistory } = load("app/payroll/payroll-ledger-panel.tsx");
const { StaffMyPay } = load("app/staff/my-work/staff-pay-analysis.tsx");
const { TaxCompanyLinesTable } = load("app/payroll/tax-company-table.tsx");
const exportsModule = load("lib/payroll-export.ts");
const render = (Component, props) => renderToStaticMarkup(h(Component, props));
const plain = html => html.replace(/<[^>]*>/g, "").replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
const summaries = html => [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map(match => plain(match[1]));
const period = { start: "2026-10-01", end: "2026-10-15" };
const original = { final_cash_amount: 40, final_check_amount: 60, tax_withheld: 10,
  tax_company_taxable_gross: 100, tax_company_cash_amount: 40,
  staff_legal_name_snapshot: "Synthetic Before", check_number: "SYN-1" };
const revised = { final_cash_amount: 45, final_check_amount: 75, tax_withheld: 12,
  tax_company_taxable_gross: 120, tax_company_cash_amount: 45,
  staff_legal_name_snapshot: "Synthetic After", check_number: "SYN-2" };
const adjustment = { id: "synthetic-adjustment", base_id: "synthetic-base", staff_id: "synthetic-staff",
  revision: 1, created_at: "2026-10-16T15:00:00.000Z", actor_id: "synthetic-owner",
  reason: "Synthetic correction only", delta_amount: 20, before_values: original, after_values: revised };
const payment = { id: "synthetic-payment", staff_id: "synthetic-staff", cash_amount: 40, check_amount: 60,
  paid_at: "2026-10-16T16:00:00.000Z", recorded_at: "2026-10-16T16:05:00.000Z",
  actor_id: "synthetic-owner", revision_at_payment: 0, note: "Synthetic payment evidence" };
function makeLine(adjusted = true) {
  return { staff_id: "synthetic-staff", staff_display_name_snapshot: "Synthetic Staff", ...revised,
    final_staff_income: 120, gross_sales: 200, staff_commission_gross: 100, tip_amount: 20,
    bonus_amount: 12, base_check_amount: 60, commission_rate_used: 50, tax_rate_used: 10,
    pay_type_used: "commission", fixed_pay_amount_used: 0, is_mixed_rate: false,
    settings_used_snapshot: [], tax_tips_snapshot: false, tax_bonus_snapshot: false,
    tip_payout_method_snapshot: "cash", bonus_payout_method_snapshot: "check",
    cash_to_tax_company_snapshot: true, paystub: null, note: "Synthetic statement note",
    ledger: { original, originalIncome: adjusted ? 100 : 120, delta: adjusted ? 20 : 0,
      adjusted, adjustments: adjusted ? [adjustment] : [], payments: [payment], paid: 100, balance: 20 } };
}
function makeLedger(overrides = {}) {
  return { state: "closed", configurationIssue: null, canAdjust: true, revision: 1,
    base: { id: "synthetic-base", periodStart: period.start, periodEnd: period.end },
    adjustments: [adjustment], payments: [payment], legacyPaidHistory: [], ...overrides };
}
function panel(ledger = makeLedger(), line = makeLine()) {
  return render(PayrollLedgerPanel, { ledger, lines: [line], scope: "synthetic-scope" });
}
function staffData(label = "Adjusted", kind = "printed", overrides = {}) {
  return { period: { startDate: period.start, endDate: period.end, label: "Synthetic period" },
    periodOptions: [], line: makeLine(), settings: [], dailyRows: [
      { id: "synthetic-day", businessDate: "2026-10-01", commissionGross: 100, tipAmount: 20 },
    ], status: { label, kind }, latestStatement: null, paystub: null, ...overrides };
}
function staffHero(html) {
  return html.split('<section aria-label="Payroll adjustment history"')[0];
}
function assertAuditPreserved(html) {
  for (const text of ["Original income", "Adjustment", "$100.00", "$20.00", "$40.00 → $45.00",
    "$60.00 → $75.00", "$10.00 → $12.00", "Synthetic correction only", "synthetic-owner",
    "Audit record: synthetic-adjustment", "Actual payment records (1)", "Synthetic payment evidence",
    "Whole payments associated with the source pay periods; not filtered by payment date.",
    "SYN-1 → SYN-2", "Synthetic Before → Synthetic After"]) {
    assert.ok(plain(html).includes(text), `Missing audit evidence: ${text}`);
  }
  assert.match(html, /href="#payroll-adjustment-synthetic-adjustment"/);
  assert.ok(summaries(html).some(text => text.startsWith("Adjusted ") && text.includes("$20.00")), "Dated audit entry remains available");
}

test("empty historical ledger hides its notice without fabricating calculated or paid income", () => {
  assert.equal(panel(makeLedger({ state: "legacy_review", base: null, canAdjust: true })), "");
});

test("historical configuration and prior-paid evidence survive; no historical adjustment/payment form appears", () => {
  for (const overrides of [
    { configurationIssue: "Synthetic configuration failure" },
    { legacyPaidHistory: [{ id: "synthetic-old-paid-statement" }] },
    { base: makeLedger().base },
  ]) {
    const html = panel(makeLedger({ state: "legacy_review", base: null, ...overrides }));
    assert.doesNotMatch(html, /Historical period needs review|no verified automatic original exists|<h2|data-test="owner-form"/);
    assert.doesNotMatch(html, /Existing saved statements and paid history remain available|Current calculations are not a verified original|no historical payroll will be recreated automatically/);
    assert.doesNotMatch(html, /Closed automatically|>Original ·|>Paid</);
    if (overrides.configurationIssue) assert.match(html, /Synthetic configuration failure/);
    if (overrides.legacyPaidHistory) {
      assert.match(html, /Earlier statements were marked paid/);
      assert.match(html, /those flags are not imported as cash payments/);
    }
    if (overrides.base) assert.match(html, /payroll-income-2026-10-01.csv/);
  }
});

test("processing, schedule-review, open and report-range notices remain visible", () => {
  for (const [state, label] of [
    ["processing", "Closing is processing — the captured inputs are preserved"],
    ["schedule_review", "Payroll schedule needs Owner review"],
    ["open", "Open period — closes automatically after its scheduled end"],
    ["range", "Report range — adjustments belong to their original pay periods"],
  ]) {
    const html = panel(makeLedger({ state, configurationIssue: "Synthetic configuration failure" }));
    assert.ok(plain(html).includes(label), state);
    assert.match(html, /Synthetic configuration failure/);
    assert.doesNotMatch(html, /data-test="owner-form"/);
  }
});

test("closed adjusted summary is neutral while amounts, dated audit and exports remain", () => {
  const ledger = makeLedger();
  const line = makeLine();
  const beforeRender = structuredClone({ ledger, line });
  const html = panel(ledger, line);
  assert.deepEqual({ ledger, line }, beforeRender, "Presentation does not mutate ledger or income inputs");
  const summary = summaries(html).find(value => value.startsWith("Synthetic Staff"));
  assert.equal(summary, "Synthetic Staff · Final $120.00");
  assert.match(html, /Closed automatically/);
  assertAuditPreserved(html);
  for (const kind of ["income", "adjustments", "actual-payments"]) {
    assert.ok(html.includes(`payroll-${kind}-${period.start}.csv`));
  }
  assert.ok(summaries(panel(makeLedger(), makeLine(false))).includes("Synthetic Staff · Original · Final $120.00"));
});

test("only closed ledgers with base and canAdjust expose the two owner forms", () => {
  const allowedHtml = panel();
  assert.equal((allowedHtml.match(/data-test="owner-form"/g) ?? []).length, 2);
  assert.match(allowedHtml, /data-kind="adjust"/);
  assert.match(allowedHtml, /data-kind="payment"/);
  for (const overrides of [{ canAdjust: false }, { base: null }, { state: "legacy_review" }, { state: "processing" }]) {
    assert.doesNotMatch(panel(makeLedger(overrides)), /data-test="owner-form"/, JSON.stringify(overrides));
  }
});

test("payment overage and partial-period limitations are retained", () => {
  const ledger = makeLine().ledger;
  assert.match(render(PayrollAdjustmentHistory, { ledger: { ...ledger, balance: -5 } }), /No money is collected and no future pay is deducted automatically/);
  const partial = render(PayrollAdjustmentHistory, { ledger: { ...ledger, paid: null, balance: null } });
  assert.match(partial, /See source-period payment records/);
  assert.match(partial, /Not calculated for a partial period/);
});

test("staff change-status badges disappear without relabeling adjusted income Paid or Original", () => {
  for (const [label, kind] of [["Adjusted", "printed"], ["Adjusted", "paid"], ["Historical payroll needs review", "printed"]]) {
    const html = render(StaffMyPay, { data: staffData(label, kind) });
    const hero = staffHero(html);
    assert.doesNotMatch(hero, /Adjusted|Historical payroll needs review|>Paid<|>Original<|<small/);
    assert.match(hero, /Take-home pay/);
    assert.match(hero, /\$120\.00/);
    assert.match(hero, /Cash payout/);
    assert.match(hero, /\$45\.00/);
    assert.match(hero, /\$75\.00/);
    assertAuditPreserved(html);
    assert.match(html, /Owner adjustment \(before tax change\)/);
    assert.match(html, /\$22\.00/);
    assert.match(html, /Income is separate from recorded payments/);
    assert.match(html, /Synthetic statement note/);
  }
});

test("staff supplied payment/workflow statuses and paid date remain accurate", () => {
  for (const label of ["Paid", "Under review", "Finalized", "Closed", "Closing is processing"]) {
    const html = render(StaffMyPay, { data: staffData(label, label === "Paid" ? "paid" : "printed") });
    assert.ok(staffHero(html).includes(`<small>${label}</small>`), label);
  }
  const paidData = { latestStatement: { run: { paid_at: payment.paid_at } } };
  const adjusted = staffHero(render(StaffMyPay, { data: staffData("Adjusted", "paid", paidData) }));
  assert.match(adjusted, /<small>Oct 16<\/small>/);
  assert.doesNotMatch(adjusted, /Adjusted|>Paid[< ]|>Original[< ]/);
  const paid = staffHero(render(StaffMyPay, { data: staffData("Paid", "paid", paidData) }));
  assert.match(paid, /<small>Paid · Oct 16<\/small>/);
  const live = render(StaffMyPay, { data: staffData("In progress", "live") });
  assert.match(live, /Estimated take-home/);
  assert.match(staffHero(live), /In progress/);
});

test("historical staff without a line retains the no-calculation message and no fabricated amount", () => {
  const html = render(StaffMyPay, { data: staffData("Historical payroll needs review", "printed", { line: null, dailyRows: [] }) });
  assert.match(html, /No payroll has been calculated for you in this period/);
  assert.match(html, /Payment has not been marked paid/);
  assert.doesNotMatch(html, /Historical payroll needs review|\$[0-9]|Take-home pay|data-test="owner-form"/);
});

test("tax view neutral summary retains adjustment details and original/historical distinctions", () => {
  const props = { lines: [makeLine()], payrollRunId: "synthetic-run", returnPath: "/payroll", canUpload: false };
  const html = render(TaxCompanyLinesTable, props);
  assert.ok(summaries(html).includes("Payroll record"));
  assert.ok(!summaries(html).includes("Adjusted"));
  assert.ok(!summaries(html).includes("Original"));
  assertAuditPreserved(html);
  assert.match(html, /Original and adjustments/);
  assert.doesNotMatch(html, /data-test="paystub-upload"/);
  assert.ok(summaries(render(TaxCompanyLinesTable, { ...props, lines: [makeLine(false)] })).includes("Original"));
  assert.match(render(TaxCompanyLinesTable, { ...props, lines: [{ ...makeLine(), ledger: undefined }] }), /Historical statement/);
});

test("tax warnings and upload permission remain visible and enforced", () => {
  const line = { ...makeLine(), final_check_amount: -3, staff_legal_name_snapshot: null };
  const html = render(TaxCompanyLinesTable, { lines: [line], payrollRunId: null, returnPath: "/payroll", canUpload: false });
  for (const warning of ["Check amount negative", "Missing legal name", "Save a statement first"]) assert.ok(html.includes(warning));
  assert.doesNotMatch(html, /data-test="paystub-upload"/);
  const allowedHtml = render(TaxCompanyLinesTable, { lines: [line], payrollRunId: "synthetic-run", returnPath: "/payroll", canUpload: true });
  assert.match(allowedHtml, /data-test="paystub-upload"/);
});

function loadOwnerHeader(relative) {
  const source = readFileSync(path.join(root, relative), "utf8");
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const headers = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "header" &&
        node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr) &&
          attr.name.getText(ast) === "className" && attr.initializer?.getText(ast) === "{styles.heading}")) headers.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(headers.length, 1, `Exactly one actual owner heading in ${relative}`);
  const extracted = `import { jsx } from "react/jsx-runtime";
    export function Header({data, pageContext, salonName}) {
      const styles = {heading:"heading", context:"context", status:"status"};
      const WorkspaceText = ({text}) => jsx("span", {children:text});
      return (${headers[0].getText(ast)});
    }`;
  return evaluate(extracted, `${relative}:actual-heading.tsx`, specifier => {
    assert.equal(specifier, "react/jsx-runtime");
    return require(specifier);
  }).Header;
}

for (const relative of ["app/(app)/payroll/page.tsx", "lib/app-local-owner-payroll-view.tsx"]) {
  test(`actual owner heading preserves period states without review/change notices: ${relative}`, () => {
    const Header = loadOwnerHeader(relative);
    for (const [state, expected] of [["closed", "Closed"], ["open", "Current calculation"],
      ["legacy_review", null], ["processing", "Needs review"], ["schedule_review", "Needs review"]]) {
      const html = render(Header, { data: { ledger: makeLedger({ state }) },
        pageContext: { currentSalon: { name: "Synthetic Salon" } }, salonName: "Synthetic Salon" });
      assert.match(html, /Payroll/);
      assert.match(html, /Synthetic Salon/);
      assert.doesNotMatch(html, /Adjusted|>Paid</);
      if (expected) assert.ok(plain(html).endsWith(expected), `${state}: ${html}`);
      else assert.doesNotMatch(html, /Needs review|class="status"|Closed|Current calculation/);
    }
  });
}

test("actual CSV row builders keep adjusted status, before/after values, source periods and payment evidence", () => {
  const { payrollIncomeExport, payrollAdjustmentExport, payrollPaymentExport,
    PAYROLL_INCOME_COLUMNS, PAYROLL_ADJUSTMENT_COLUMNS, PAYROLL_PAYMENT_COLUMNS } = exportsModule;
  const toObject = (columns, row) => Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  const line = makeLine();
  const income = toObject(PAYROLL_INCOME_COLUMNS, payrollIncomeExport([line], period, "closed")[0]);
  for (const [column, value] of Object.entries({ "Report status": "adjusted", Adjusted: "Yes", "Original income": 100,
    "Income adjustment": 20, "Final income": 120, "Final cash income": 45, "Final check income": 75,
    "Adjustment reasons": adjustment.reason, "Adjusted at (UTC)": adjustment.created_at, "Owner IDs": adjustment.actor_id })) {
    assert.equal(income[column], value, column);
  }
  const rows = payrollAdjustmentExport([line, line], period);
  assert.equal(rows.length, 1, "Existing export deduplication is retained");
  const audit = toObject(PAYROLL_ADJUSTMENT_COLUMNS, rows[0]);
  for (const [column, value] of Object.entries({ "Adjustment ID": adjustment.id, "Original period ID": adjustment.base_id,
    Reason: adjustment.reason, "Previous cash income": 40, "Final cash income": 45,
    "Previous check income": 60, "Final check income": 75, "Previous tax": 10, "Final tax": 12,
    "Previous legal name": "Synthetic Before", "Final legal name": "Synthetic After",
    "Source period start": period.start, "Source period end": period.end })) assert.equal(audit[column], value, column);
  const payments = payrollPaymentExport([line, line], period);
  assert.equal(payments.length, 1);
  const paid = toObject(PAYROLL_PAYMENT_COLUMNS, payments[0]);
  for (const [column, value] of Object.entries({ "Payment ID": payment.id, "Cash paid": 40, "Check paid": 60,
    "Total paid": 100, "Paid at (UTC)": payment.paid_at, "Recorded at (UTC)": payment.recorded_at,
    "Owner ID": payment.actor_id, "Income revision at payment": 0, Note: payment.note,
    "Source period start": period.start, "Source period end": period.end })) assert.equal(paid[column], value, column);
  assert.match(paid["Payment scope"], /Whole payment associated with source pay period; not filtered by payment date/);
});
