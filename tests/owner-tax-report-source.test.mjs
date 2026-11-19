import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync("lib/owner-tax-report.ts", "utf8");
const contextSource = fs.readFileSync("lib/current-context.ts", "utf8");
const contextAst = ts.createSourceFile(
  "current-context.ts",
  contextSource,
  ts.ScriptTarget.Latest,
  true,
);
const guards = ["isOwnerMembership", "isSalonManageContext"]
  .map((name) =>
    contextAst.statements
      .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
      .getText(contextAst),
  )
  .join("\n");
const transpile = (code) =>
  ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const guardExports = {};
new Function("exports", transpile(guards))(guardExports);

function ownerContext() {
  return {
    user: { id: "owner", status: "active" },
    workspaceType: "salon",
    salonMode: "manage",
    currentSalon: { id: "salon", account_id: "account" },
    currentMembership: {
      id: "membership",
      user_id: "owner",
      account_id: "account",
      salon_id: "salon",
      status: "active",
      role: { code: "OWNER", name: "Owner" },
    },
  };
}

function taxData() {
  return {
    salon: {
      id: "salon",
      name: "Salon",
      phone: null,
      city: null,
      state: null,
      address_line1: null,
    },
    runs: [
      {
        id: "published-v2",
        period_start: "2026-11-01",
        period_end: "2026-11-15",
        version: 2,
        status: "printed",
        cycle_type: "semi_monthly",
      },
    ],
    lines: [
      {
        id: "line",
        run_id: "published-v2",
        staff_id: "staff",
        name: "Anna",
        legal_name: "Anna Legal",
        reported_wage: 1000.01,
        reported_gross: 1150.01,
        tax: 115,
        actual_check: 1035.01,
        wage_check_net: 885.01,
        cash_reported: null,
        tip: 150,
        bonus: 0,
        tax_rate: 10,
        tip_method: "check",
        bonus_method: "cash",
        work_status: "pending",
        work_version: 0,
      },
      {
        id: "zero-line",
        run_id: "published-v2",
        staff_id: "other-staff",
        name: "Bea",
        legal_name: null,
        reported_wage: 0,
        reported_gross: 0,
        tax: 0,
        actual_check: 0,
        wage_check_net: 0,
        cash_reported: 0,
        tip: null,
        bonus: null,
        tax_rate: null,
        work_status: "reviewed",
        work_version: 1,
      },
    ],
    people: [{ id: "private-person" }],
    documents: [{ title: "PRIVATE DOCUMENT" }],
    messages: [{ body: "PRIVATE CONVERSATION" }],
    receipts: [{ description: "PRIVATE RECEIPT" }],
    events: [{ detail: "PRIVATE HISTORY" }],
  };
}

function fixture(data = taxData(), readError = null) {
  const calls = [];
  const exports = {};
  const require = (name) => {
    if (name === "server-only") return {};
    if (name === "@/lib/current-context") return guardExports;
    if (name === "@/lib/tax-workspace") {
      return {
        async loadTaxReport(salonId) {
          calls.push(salonId);
          if (readError) throw readError;
          return data;
        },
      };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("exports", "require", transpile(source))(exports, require);
  return { ...exports, calls };
}

test("owner reads the professional's published numbers without plugin or connection state", async () => {
  for (const taxAccess of [
    { pluginActive: false, connections: [] },
    { pluginActive: true, connections: [] },
    { pluginActive: false, connections: ["expired"] },
  ]) {
    const data = taxData();
    const f = fixture(data);
    const result = await f.loadOwnerTaxReport({ ...ownerContext(), ...taxAccess });
    assert.deepEqual(f.calls, ["salon"]);
    assert.deepEqual(result, {
      salon: data.salon,
      runs: data.runs,
      lines: data.lines,
    });
  }
});

test("non-owner, staff and inconsistent salon memberships are denied before any data read", async () => {
  const denied = [
    (c) => ({ ...c, user: null }),
    (c) => ({ ...c, user: { ...c.user, status: "suspended" } }),
    (c) => ({ ...c, currentSalon: null }),
    (c) => ({ ...c, workspaceType: "tax" }),
    (c) => ({ ...c, salonMode: "staff" }),
    (c) => ({ ...c, currentMembership: null }),
    (c) => ({ ...c, currentMembership: { ...c.currentMembership, role: { code: "MANAGER", name: "Manager" } } }),
    (c) => ({ ...c, currentMembership: { ...c.currentMembership, status: "removed" } }),
    (c) => ({ ...c, currentMembership: { ...c.currentMembership, user_id: "other-owner" } }),
    (c) => ({ ...c, currentMembership: { ...c.currentMembership, account_id: "other-account" } }),
    (c) => ({ ...c, currentMembership: { ...c.currentMembership, salon_id: "other-salon" } }),
  ];
  for (const change of denied) {
    const f = fixture();
    await assert.rejects(f.loadOwnerTaxReport(change(ownerContext())), /owner access required/i);
    assert.deepEqual(f.calls, []);
  }
});

test("account owners retain access to a salon owned by their account", async () => {
  const context = ownerContext();
  delete context.currentMembership.salon_id;
  const f = fixture();
  await f.loadOwnerTaxReport(context);
  assert.deepEqual(f.calls, ["salon"]);
});

test("numeric DTO preserves row/version identity, exact values and null versus zero", async () => {
  const data = taxData();
  const f = fixture(data);
  const result = await f.loadOwnerTaxReport(ownerContext());
  assert.strictEqual(result.runs, data.runs);
  assert.strictEqual(result.lines, data.lines);
  assert.equal(result.runs[0].version, 2);
  assert.equal(result.lines[0].cash_reported, null);
  assert.equal(result.lines[0].bonus, 0);
  assert.equal(result.lines[1].cash_reported, 0);
  assert.equal(result.lines[1].tip, null);
  assert.equal(result.lines[0].reported_gross, 1150.01);
  assert.equal(result.lines[0].actual_check, 1035.01);
});

test("report serialization excludes documents, conversations and other workspace records", async () => {
  const f = fixture();
  const result = await f.loadOwnerTaxReport(ownerContext());
  assert.deepEqual(Object.keys(result).sort(), ["lines", "runs", "salon"]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private-person/);
});

test("failed shared reads propagate without falling back to live payroll", async () => {
  const unavailable = new Error("Database unavailable");
  const f = fixture(taxData(), unavailable);
  await assert.rejects(f.loadOwnerTaxReport(ownerContext()), (error) => error === unavailable);
  assert.deepEqual(f.calls, ["salon"]);
});

test("a response outside the requested salon scope is never returned", async () => {
  const data = taxData();
  data.salon.id = "other-salon";
  const f = fixture(data);
  await assert.rejects(f.loadOwnerTaxReport(ownerContext()), /current salon/);
  assert.deepEqual(f.calls, ["salon"]);
});
