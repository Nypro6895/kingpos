import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const source = readFileSync(join(root, "lib/salon-business-hours.ts"), "utf8");
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
    if (
      specifier === "server-only" ||
      specifier === "@/lib/supabase/server"
    ) {
      return {};
    }

    throw new Error(`Unexpected require: ${specifier}`);
  },
  console,
  Date,
  Intl,
  Math,
  Number,
  RegExp,
  Set,
};

moduleContext.exports = moduleContext.module.exports;
vm.runInNewContext(transpiled, moduleContext);

const {
  buildSalonActivityBuckets,
  buildSalonBusinessHourBuckets,
  getLocalDateHour,
} = moduleContext.module.exports;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function businessHours(input = {}) {
  return {
    buckets: buildSalonBusinessHourBuckets({
      closesAtMinutes: input.closesAtMinutes ?? 17 * 60,
      opensAtMinutes: input.opensAtMinutes ?? 9 * 60,
    }),
    closesAtLocal: "17:00",
    date: "2026-08-15",
    fallbackReason: null,
    isClosed: false,
    isFallback: false,
    opensAtLocal: "09:00",
    source: "staff_availability_rules",
    spansOvernight: Boolean(input.spansOvernight),
    timeZone: "America/Chicago",
  };
}

test("activity buckets zero-fill open hours and aggregate before/after exceptions", () => {
  const buckets = buildSalonActivityBuckets({
    activeHours: [0, 10, 22],
    businessHours: businessHours(),
    date: "2026-08-15",
    timeZone: "America/Chicago",
  });

  assert.deepEqual(plain(buckets.map((bucket) => bucket.label)), [
    "Before open",
    "9 AM",
    "10 AM",
    "11 AM",
    "12 PM",
    "1 PM",
    "2 PM",
    "3 PM",
    "4 PM",
    "5 PM",
    "After hours",
  ]);
  assert.deepEqual(plain(buckets[0]), {
    exceptional: true,
    hour: null,
    hours: [0],
    label: "Before open",
    source: "before_open",
  });
  assert.deepEqual(plain(buckets.at(-1)), {
    exceptional: true,
    hour: null,
    hours: [22],
    label: "After hours",
    source: "after_hours",
  });
});

test("multiple outside operating-hour transactions are summarized", () => {
  const buckets = buildSalonActivityBuckets({
    activeHours: [0, 7, 8, 9, 18, 23],
    businessHours: businessHours(),
    date: "2026-08-15",
    timeZone: "America/Chicago",
  });

  assert.deepEqual(plain(buckets[0].hours), [0, 7, 8]);
  assert.equal(buckets[0].label, "Before open");
  assert.deepEqual(plain(buckets.at(-1).hours), [18, 23]);
  assert.equal(buckets.at(-1).label, "After hours");
  assert.equal(
    buckets.filter((bucket) => bucket.source === "before_open").length,
    1,
  );
  assert.equal(
    buckets.filter((bucket) => bucket.source === "after_hours").length,
    1,
  );
});

test("midnight activity remains on the selected salon-local business date", () => {
  const local = getLocalDateHour(
    "2026-08-15T05:35:00.000Z",
    "America/Chicago",
  );

  assert.deepEqual(plain(local), {
    date: "2026-08-15",
    hour: 0,
  });
});

test("activity fallback only spans observed activity when hours are unavailable", () => {
  const buckets = buildSalonActivityBuckets({
    activeHours: [10, 12],
    businessHours: null,
    date: "2026-08-14",
    timeZone: "America/Chicago",
  });

  assert.deepEqual(
    plain(buckets.map((bucket) => [bucket.label, bucket.source])),
    [
      ["10 AM", "activity_hours_fallback"],
      ["11 AM", "activity_hours_fallback"],
      ["12 PM", "activity_hours_fallback"],
    ],
  );
});
