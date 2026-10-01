import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const source = readFileSync(join(root, "lib/salon-operating-status-core.ts"), "utf8");
const tableGrantsMigration = readFileSync(
  join(
    root,
    "supabase/migrations/202609220001_salon_operating_status_table_grants.sql",
  ),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleContext = {
  exports: {},
  module: { exports: {} },
  require(specifier) {
    throw new Error(`Unexpected require: ${specifier}`);
  },
  console,
  Date,
  Intl,
  Map,
  Math,
  Number,
  RegExp,
  Set,
};

moduleContext.exports = moduleContext.module.exports;
vm.runInNewContext(transpiled, moduleContext);

const {
  resolveSalonOperatingStatus,
} = moduleContext.module.exports;

function resolve(input) {
  return resolveSalonOperatingStatus({
    lifecycleStatus: "active",
    specialHours: [],
    timeZone: "America/Chicago",
    weeklyHours: [
      {
        closesAtLocal: "17:00",
        dayOfWeek: 1,
        opensAtLocal: "09:00",
      },
    ],
    ...input,
  });
}

test("operating-hours tables grant RLS roles the required table privileges", () => {
  assert.match(
    tableGrantsMigration,
    /grant select on table public\.salon_operating_hours to anon/,
  );
  assert.match(
    tableGrantsMigration,
    /grant select, insert, update, delete\s+on table public\.salon_operating_hours\s+to authenticated/,
  );
  assert.match(
    tableGrantsMigration,
    /grant select, insert, update, delete\s+on table public\.salon_special_hours\s+to authenticated/,
  );
});

test("returns open now and closing label inside normal weekly hours", () => {
  const status = resolve({
    now: "2026-08-31T15:30:00.000Z",
  });

  assert.equal(status.kind, "open");
  assert.equal(status.label, "Open now");
  assert.equal(status.detail, "Closes at 5 PM");
});

test("returns next opening when closed before open", () => {
  const status = resolve({
    now: "2026-08-31T13:15:00.000Z",
  });

  assert.equal(status.kind, "closed");
  assert.equal(status.label, "Closed");
  assert.equal(status.nextOpensLabel, "Opens at 9 AM");
});

test("supports overnight hours across local midnight", () => {
  const status = resolve({
    now: "2026-09-01T05:30:00.000Z",
    weeklyHours: [
      {
        closesAtLocal: "02:00",
        dayOfWeek: 1,
        opensAtLocal: "20:00",
      },
    ],
  });

  assert.equal(status.kind, "open");
  assert.equal(status.detail, "Closes at 2 AM");
});

test("special closure takes precedence over weekly hours", () => {
  const status = resolve({
    now: "2026-08-31T15:30:00.000Z",
    specialHours: [
      {
        closesAtLocal: null,
        id: "holiday",
        localDate: "2026-08-31",
        opensAtLocal: null,
        reason: "Labor Day",
        status: "closed",
      },
    ],
  });

  assert.equal(status.kind, "special_closure");
  assert.equal(status.label, "Closed today");
  assert.equal(status.reason, "Labor Day");
});

test("permanently closed wins over configured hours", () => {
  const status = resolve({
    lifecycleStatus: "permanently_closed",
    now: "2026-08-31T15:30:00.000Z",
  });

  assert.equal(status.kind, "permanently_closed");
  assert.equal(status.label, "Permanently closed");
  assert.equal(status.isOpen, false);
});

test("custom special hours can open on an otherwise closed day", () => {
  const status = resolve({
    now: "2026-09-01T18:00:00.000Z",
    specialHours: [
      {
        closesAtLocal: "14:00",
        id: "event",
        localDate: "2026-09-01",
        opensAtLocal: "12:00",
        reason: "Event hours",
        status: "custom_hours",
      },
    ],
    weeklyHours: [],
  });

  assert.equal(status.kind, "open");
  assert.equal(status.source, "special_hours");
  assert.equal(status.reason, "Event hours");
});
