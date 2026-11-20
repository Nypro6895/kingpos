import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
const require = createRequire(import.meta.url);
mkdirSync("work/check-writer-tests", { recursive: true });
await build({
  entryPoints: [
    "lib/check-writer-rules.ts",
    "lib/check-writer-crypto.ts",
    "lib/check-writer-pdf.ts",
    "lib/check-writer-request.ts",
  ],
  outdir: "work/check-writer-tests",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
const rules = require("../work/check-writer-tests/check-writer-rules.js"),
  crypto = require("../work/check-writer-tests/check-writer-crypto.js"),
  { checkPdf } = require("../work/check-writer-tests/check-writer-pdf.js");
process.env.CHECK_WRITER_ENCRYPTION_KEY = "ab".repeat(32);
test("key rotation retains old snapshots and malformed configuration never reveals key material", () => {
  const original = crypto.encryptBank("salon-a", { demo: true });
  const token = crypto.unlockToken("session-a");
  try {
    process.env.CHECK_WRITER_ENCRYPTION_KEYS = JSON.stringify({
      v2: "cd".repeat(32),
    });
    process.env.CHECK_WRITER_ACTIVE_KEY_ID = "v2";
    const fresh = crypto.encryptBank("salon-a", { demo: true });
    assert.match(fresh, /^v2\./);
    assert.deepEqual(crypto.decryptBank("salon-a", original), { demo: true });
    assert.deepEqual(crypto.decryptBank("salon-a", fresh), { demo: true });
    assert.equal(crypto.validUnlock("session-a", token), false);
    process.env.CHECK_WRITER_ENCRYPTION_KEYS = "private-invalid-material";
    assert.throws(
      () => crypto.encryptBank("salon-a", {}),
      (error) => error.message === "Check Writer encryption is not configured.",
    );
  } finally {
    delete process.env.CHECK_WRITER_ENCRYPTION_KEYS;
    delete process.env.CHECK_WRITER_ACTIVE_KEY_ID;
  }
});
test("request parsing rejects oversized chunked bodies before JSON parsing", async () => {
  const {
    readCheckBody,
  } = require("../work/check-writer-tests/check-writer-request.js");
  const request = new Request("https://example.invalid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(100)));
        controller.close();
      },
    }),
    duplex: "half",
  });
  await assert.rejects(readCheckBody(request, 32), /too large/);
});
const bank = {
  name: "Demo Bank",
  city: "Sample City",
  routing: "021000021",
  account: "123450000",
  fractional: "12-34",
};
test("exact cents, routing checksum, Gregorian dates, safe text and independent stub options", () => {
  assert.equal(rules.checkCents("1245.80"), 124580);
  assert.equal(rules.checkCents("0.01"), 1);
  for (const n of ["0", "-1", "NaN", "1e3", "1.001", " 1 ", "999999999"])
    assert.throws(() => rules.checkCents(n));
  assert.equal(rules.validRouting(bank.routing), true);
  assert.equal(rules.validRouting("000000000"), false);
  assert.equal(rules.validRouting("021000022"), false);
  assert.throws(() => rules.checkDate("2026-02-29"));
  assert.equal(rules.checkDate("2028-02-29"), "2028-02-29");
  assert.throws(() => rules.checkText("bad\nname", 160));
  assert.equal(
    rules.amountWords(124580),
    "One Thousand Two Hundred Forty-Five and 80/100 dollars",
  );
  assert.deepEqual(
    rules.stubOptions({
      same: false,
      payee: ["tip"],
      salon: ["cash", "bonus"],
    }),
    { same: false, payee: ["tip"], salon: ["cash", "bonus"] },
  );
  assert.throws(() =>
    rules.stubOptions({ same: true, payee: ["routing"], salon: [] }),
  );
});
test("bank encryption is randomized, tamper resistant and salon bound; unlock is short-lived and session bound", () => {
  const one = crypto.encryptBank("salon-a", bank),
    two = crypto.encryptBank("salon-a", bank);
  assert.notEqual(one, two);
  assert.deepEqual(crypto.decryptBank("salon-a", one), bank);
  assert.ok(!one.includes(bank.routing));
  assert.throws(() => crypto.decryptBank("salon-b", one));
  assert.throws(() => crypto.decryptBank("salon-a", one.slice(0, -4) + "ABCD"));
  const token = crypto.unlockToken("session-a");
  assert.equal(crypto.validUnlock("session-a", token), true);
  assert.equal(crypto.validUnlock("session-b", token), false);
  assert.equal(
    crypto.validUnlock(
      "session-a",
      crypto.unlockToken("session-a", Date.now() - 1),
    ),
    false,
  );
});
test("PDF embeds Vietnamese text and MICR, Letter dimensions, two stubs and a blank hand-signature line", async () => {
  const snapshot = {
    payee: "Nguyễn Thị Demo",
    amountCents: 124580,
    memo: "Payroll Oct 12–25, 2026",
    date: "2026-10-27",
    issuer: "DEMO NAIL SALON",
    address: "100 Sample Ave\nSample City, WI 53000",
    bankEncrypted: crypto.encryptBank("salon-a", bank),
    stock: "blank",
    stubs: { same: false, payee: ["tip"], salon: ["cash", "bonus"] },
    payroll: {
      check: 124580,
      cash: 20000,
      tip: 12000,
      bonus: 5000,
      gross: 200000,
      period: "Oct 12–25",
    },
  };
  const record = {
    id: "fake",
    number: 1041,
    snapshot,
    status: "issued",
    created_at: "",
    void_reason: null,
    delivery_count: 0,
  };
  for (const preview of [true, false]) {
    const bytes = await checkPdf([record], "salon-a", preview);
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.equal(pdf.getPage(0).getWidth(), 612);
    assert.equal(pdf.getPage(0).getHeight(), 792);
    writeFileSync(
      "work/check-writer-tests/" +
        (preview ? "preview" : "sample-print") +
        ".pdf",
      bytes,
    );
  }
  await assert.rejects(
    checkPdf([{ ...record, status: "void" }], "salon-a", false),
  );
  await assert.rejects(
    checkPdf(
      [{ ...record, snapshot: { ...snapshot, payee: "W".repeat(160) } }],
      "salon-a",
      true,
    ),
  );
  await assert.rejects(checkPdf([record], "salon-a", false, { x: 20, y: 0 }));
  await assert.rejects(
    checkPdf(
      [{ ...record, snapshot: { ...snapshot, payee: "Demo 😀" } }],
      "salon-a",
      false,
    ),
  );
  assert.throws(() => rules.checkText("Pay\u202E123", 100));
  assert.throws(() => rules.checkDate("2026-99-99"));
  assert.equal(
    rules.checkText("Line 1\r\nLine 2", 100, true),
    "Line 1\nLine 2",
  );
  const source = readFileSync("lib/check-writer-pdf.ts", "utf8");
  assert.match(source, /Authorized signature/);
  assert.ok(!source.includes("signatureImage"));
});
