import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const result = await build({
  entryPoints: ["app/api/check-writer/route.ts"],
  outfile: "work/check-writer-tests/api.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: true,
  plugins: [
    {
      name: "isolated-auth-and-storage",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^@\/lib\/check-writer-server$|^next\/headers$|^@supabase\/supabase-js$/,
          },
          (a) => ({ path: a.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          contents:
            a.path === "next/headers"
              ? `export async function cookies(){return {set:(...v)=>globalThis.cw.cookies.push(v),delete:()=>{}}}`
              : a.path === "@supabase/supabase-js"
                ? `export function createClient(){return globalThis.cw.auth}`
                : `export const UNLOCK_COOKIE='test-unlock';export async function checkWriterContext(paid=false,unlocked=false){const f=globalThis.cw;f.guards.push({paid,unlocked});if(!f.owner)throw Error('Owner required.');if(paid&&!f.paid)throw Error('Activate Check Writer for this salon in Market.');if(unlocked&&!f.unlocked)throw Error('Unlock Check Writer to continue.');return f.ctx;}export async function checkWriterState(){return globalThis.cw.state;}`,
        }));
      },
    },
  ],
});
const { POST } = require("../work/check-writer-tests/api.cjs");
process.env.CHECK_WRITER_ENCRYPTION_KEY = "ab".repeat(32);
await build({
  entryPoints: ["lib/check-writer-crypto.ts"],
  outfile: "work/check-writer-tests/api-crypto.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const {
  encryptBank,
  decryptBank,
} = require("../work/check-writer-tests/api-crypto.cjs");
function fixture() {
  const f = {
    owner: true,
    paid: true,
    unlocked: true,
    cookies: [],
    guards: [],
    rpc: [],
    rate: true,
    prior: null,
    credentials: 0,
  };
  const line = {
    id: id(2),
    payroll_run_id: id(1),
    staff_id: id(3),
    staff_legal_name_snapshot: "Canonical Payee",
    final_check_amount: 1245.8,
    final_cash_amount: 200,
    tip_amount: 120,
    bonus_amount: 50,
    gross_sales: 2000,
    updated_at: "2026-10-27T12:00:00Z",
  };
  f.state = {
    selectedRun: {
      id: id(1),
      version: 3,
      period_start: "2026-10-12",
      period_end: "2026-10-25",
    },
    lines: [line],
    settings: {
      version: 1,
      nextNumber: 1001,
      issuer: "Demo Salon",
      address: "100 Sample Ave",
      stock: "blank",
    },
  };
  const cipher = encryptBank(id(90), {
    name: "Demo Bank",
    city: "Sample City",
    routing: "021000021",
    account: "123450000",
    fractional: "",
  });
  f.auth = {
    auth: {
      signInWithPassword: async () => {
        f.credentials++;
        return { data: { user: { id: id(99) } }, error: null };
      },
      signOut: async () => ({ error: null }),
    },
  };
  f.ctx = {
    salonId: id(90),
    user: { id: id(99) },
    binding: "session-fixture",
    client: {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: id(99),
              email: "demo@example.invalid",
              factors: f.factors ?? [],
            },
          },
          error: null,
        }),
        mfa: {
          challenge: async () => ({ data: { id: "challenge" }, error: null }),
          verify: async () => ({ error: f.mfaError ? {} : null }),
        },
      },
    },
    service: {
      rpc: async (name, args) => {
        f.rpc.push({ name, args });
        return {
          data:
            name === "check_writer_unlock_attempt"
              ? f.rate
              : name === "check_writer_issue"
                ? [id(50)]
                : null,
          error: null,
        };
      },
      from: (table) => {
        const q = {
          select: () => q,
          eq: () => q,
          order: () => q,
          maybeSingle: async () => ({
            data:
              table === "check_writer_batches"
                ? f.prior
                : {
                    bank_encrypted: cipher,
                    public_config: { bankName: "Demo Bank", last4: "0000" },
                  },
            error: null,
          }),
          single: async () => ({
            data: { bank_encrypted: cipher },
            error: null,
          }),
          then: (resolve) => resolve({ data: [{ id: id(50) }], error: null }),
        };
        return q;
      },
    },
  };
  globalThis.cw = f;
  return f;
}
const body = () => ({
  action: "issue",
  requestId: id(40),
  mode: "payroll",
  settingsVersion: 1,
  runId: id(1),
  runVersion: 3,
  date: "2026-10-27",
  memo: "Payroll example",
  stubs: { same: false, payee: ["tip"], salon: ["cash"] },
  lines: [
    {
      id: id(2),
      updatedAt: "2026-10-27T12:00:00Z",
      amount: 1245.8,
      payee: "Forged nickname",
    },
  ],
});
const post = (payload, origin = "https://example.invalid") =>
  POST(
    new Request("https://example.invalid/api/check-writer", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ salonId: id(90), ...payload }),
    }),
  );
test(
  "Check Writer API: origin, tenant context, unlock, payroll tampering, encrypted settings and MFA",
  { timeout: 30000 },
  async (t) => {
    await t.test(
      "cross-origin rejected before authentication or storage",
      async () => {
        const f = fixture();
        assert.equal(
          (await post(body(), "https://attacker.invalid")).status,
          403,
        );
        assert.equal(f.guards.length, 0);
      },
    );
    await t.test("owner and short-lived unlock are required", async () => {
      const f = fixture();
      f.owner = false;
      assert.equal((await post(body())).status, 400);
      assert.equal(f.rpc.length, 0);
      f.owner = true;
      f.unlocked = false;
      assert.equal((await post(body())).status, 400);
      assert.equal(f.rpc.length, 0);
    });
    await t.test(
      "stale salon UI cannot issue into the newly selected salon",
      async () => {
        const f = fixture();
        assert.equal((await post({ ...body(), salonId: id(91) })).status, 400);
        assert.equal(f.rpc.length, 0);
      },
    );
    await t.test("tampered or foreign payroll lines cannot issue", async () => {
      const f = fixture();
      const p = body();
      p.lines[0].amount = 1;
      assert.equal((await post(p)).status, 400);
      p.lines[0].id = id(777);
      assert.equal((await post(p)).status, 400);
      assert.equal(
        f.rpc.filter((x) => x.name === "check_writer_issue").length,
        0,
      );
    });
    await t.test(
      "payroll canonical name, amount and selected details survive preview/issuance",
      async () => {
        const f = fixture();
        const r = await post(body());
        assert.equal(r.status, 200);
        const p = f.rpc.find((r) => r.name === "check_writer_issue").args;
        assert.equal(p.p_items[0].payee, "Canonical Payee");
        assert.equal(p.p_items[0].amountCents, 124580);
        assert.equal(p.p_items[0].payroll.tip, 12000);
        assert.deepEqual(p.p_items[0].stubs.salon, ["cash"]);
        assert.equal(p.p_salon, id(90));
      },
    );
    await t.test(
      "settings store ciphertext, return no bank secret and enforce routing checksum",
      async () => {
        const f = fixture();
        const p = {
          action: "settings",
          settings: {
            issuer: "Demo Salon",
            address: "100 Sample Ave",
            useSalon: false,
            nextNumber: 1001,
            version: 0,
            stock: "blank",
            offsetX: 0,
            offsetY: 0,
            stubs: { same: true, payee: [], salon: [] },
          },
          bank: {
            name: "Demo Bank",
            city: "Sample City",
            routing: "021000021",
            account: "123450000",
            fractional: "",
          },
        };
        const r = await post(p);
        assert.equal(r.status, 200);
        assert.ok(!(await r.text()).includes(p.bank.account));
        const saved = f.rpc.find(
          (r) => r.name === "check_writer_save_settings",
        ).args;
        assert.ok(!saved.p_bank.includes(p.bank.account));
        assert.equal(decryptBank(id(90), saved.p_bank).account, p.bank.account);
        p.bank.routing = "021000022";
        assert.equal((await post(p)).status, 400);
      },
    );
    await t.test(
      "rate limit rejects before credential verification",
      async () => {
        const f = fixture();
        f.rate = false;
        assert.equal(
          (await post({ action: "unlock", password: "fixture-password" }))
            .status,
          400,
        );
        assert.equal(f.credentials, 0);
        assert.equal(f.cookies.length, 0);
      },
    );
    await t.test(
      "password unlock produces HttpOnly five-minute cookie",
      async () => {
        const f = fixture();
        assert.equal(
          (await post({ action: "unlock", password: "fixture-password" }))
            .status,
          200,
        );
        assert.equal(f.cookies[0][2].httpOnly, true);
        assert.equal(f.cookies[0][2].maxAge, 300);
        assert.equal(f.cookies[0][2].sameSite, "strict");
      },
    );
    await t.test(
      "MFA cannot fall back to password and failed OTP never grants cookie",
      async () => {
        const f = fixture();
        f.factors = [{ id: "factor", status: "verified", factor_type: "totp" }];
        f.mfaError = true;
        assert.equal(
          (
            await post({
              action: "unlock",
              password: "fixture-password",
              code: "123456",
            })
          ).status,
          400,
        );
        assert.equal(f.credentials, 0);
        assert.equal(f.cookies.length, 0);
      },
    );
    await t.test(
      "expired paid access still allows verified safety void",
      async () => {
        const f = fixture();
        f.paid = false;
        assert.equal(
          (
            await post({
              action: "void",
              id: id(50),
              reason: "Wrong recipient",
            })
          ).status,
          200,
        );
        assert.equal(f.guards[0].paid, false);
        assert.equal(f.guards[0].unlocked, true);
      },
    );
    delete globalThis.cw;
  },
);
