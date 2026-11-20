import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await build({
  entryPoints: ["lib/check-writer-server.ts"],
  outfile: "work/check-writer-tests/read.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "read-only-payroll-fixture",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^server-only$|^next\/headers$|^@\/lib\/(market-plugins|market-payments|current-context|supabase\/server|salon-business-clock|payroll)$/,
          },
          (a) => ({ path: a.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents: {
            "server-only": "",
            "next/headers": `export async function cookies(){return {get:()=>({value:'session'})}}`,
            "@/lib/market-plugins": `export async function marketPluginContext(){return {client:{},salonId:'salon-a'}}`,
            "@/lib/market-payments": `export function marketServiceClient(){return globalThis.cwRead.service}`,
            "@/lib/current-context": `export async function getCurrentBusinessContext(){return {user:{id:'owner-a'},currentSalon:{id:'salon-a',name:'Demo Salon',address_line1:'100 Sample Ave',city:'Sample City',state:'WI',postal_code:'53000'}}}`,
            "@/lib/supabase/server": `export const ACCESS_TOKEN_COOKIE='access-token'`,
            "@/lib/salon-business-clock": `export async function getContextBusinessDate(){return '2026-10-27'}`,
            "@/lib/payroll": `export async function getPayrollPageData(input){globalThis.cwRead.calls.push(input);return globalThis.cwRead.live}`,
          }[a.path],
        }));
      },
    },
  ],
});
const { checkWriterState } = require("../work/check-writer-tests/read.cjs");
test("live payroll integration reads the existing calculator, fingerprints meaningful changes and never saves a payroll statement", async () => {
  const calls = [],
    writes = [];
  const line = {
    id: "live-staff-a",
    staff_id: "staff-a",
    staff_display_name_snapshot: "Demo Payee",
    staff_legal_name_snapshot: "Demo Legal Payee",
    final_check_amount: 100,
    final_cash_amount: 20,
    tip_amount: 10,
    bonus_amount: 5,
    gross_sales: 200,
    check_number: null,
    created_at: "unstable-clock",
  };
  const live = {
    period: { startDate: "2026-10-12", endDate: "2026-10-25" },
    live: { lines: [line] },
  };
  const service = {
    rpc: async (name) => {
      assert.equal(name, "check_writer_assert");
      return { error: null };
    },
    from: (table) => {
      const data =
        table === "check_writer_settings"
          ? { public_config: {}, version: 0, next_number: 1001 }
          : table === "check_writer_subscriptions"
            ? { paid_until: "2030-01-01", payment_owner: "owner-a" }
            : [];
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: () => q,
        insert: () => {
          writes.push(table);
          throw Error("Unexpected write");
        },
        update: () => {
          writes.push(table);
          throw Error("Unexpected write");
        },
        then: (resolve) => resolve({ data, error: null }),
      };
      return q;
    },
  };
  globalThis.cwRead = { service, live, calls };
  try {
    const one = await checkWriterState("live:2026-10-12:2026-10-25");
    assert.equal(one.selectedRun.status, "live");
    assert.equal(one.lines[0].final_check_amount, 100);
    assert.equal(one.lines[0].updated_at.length, 64);
    assert.equal(one.active, true);
    assert.deepEqual(calls[0], {
      startDate: "2026-10-12",
      endDate: "2026-10-25",
      includeAnalytics: false,
    });
    line.created_at = "new-calculation-time";
    assert.equal(
      (await checkWriterState()).lines[0].updated_at,
      one.lines[0].updated_at,
    );
    line.tip_amount = 11;
    assert.notEqual(
      (await checkWriterState()).lines[0].updated_at,
      one.lines[0].updated_at,
    );
    const invalid = await checkWriterState("live:2026-10-25:2026-10-12");
    assert.ok(invalid.payrollError);
    assert.deepEqual(invalid.lines, []);
    const count = calls.length;
    assert.deepEqual(
      (await checkWriterState(undefined, { payroll: false })).lines,
      [],
    );
    assert.equal(calls.length, count);
    assert.deepEqual(writes, []);
  } finally {
    delete globalThis.cwRead;
  }
});
