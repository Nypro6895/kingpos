import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("checkout stays closed without explicit sales release and valid crypto; no provider or DB call", async () => {
  await build({
    entryPoints: ["app/market/card-payment-actions.ts"],
    outfile: "work/check-writer-readiness/sales.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    plugins: [
      {
        name: "no-live-services",
        setup(b) {
          const mocks = {
            "server-only": "",
            "@/lib/market-plugins": `export async function marketPluginContext(){globalThis.cwGateCalls++;throw Error('LOCAL_GATE_PASSED')}`,
            "@/lib/market-payments": `export function marketServiceClient(){throw Error('Unexpected database access')}`,
            "@/lib/platform-payment": `export function paymentConfig(){throw Error('Unexpected provider access')}export const paymentStripe=paymentConfig;`,
            "@/lib/market-card": `export function syncCardSubscription(){throw Error('Unexpected sync')}`,
            "@/lib/market-tax": `export function applyMarketTaxToCheckout(){throw Error('Unexpected tax')}`,
            "next/cache": `export function revalidatePath(){}`,
          };
          b.onResolve({ filter: /.*/ }, (a) =>
            Object.hasOwn(mocks, a.path)
              ? { path: a.path, namespace: "mock" }
              : null,
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            contents: mocks[a.path],
          }));
        },
      },
    ],
  });
  const {
    startCardCheckout,
  } = require("../work/check-writer-readiness/sales.cjs");
  const names = [
    "CHECK_WRITER_SALES_ENABLED",
    "CHECK_WRITER_ENCRYPTION_KEY",
    "CHECK_WRITER_ENCRYPTION_KEYS",
    "CHECK_WRITER_ACTIVE_KEY_ID",
  ];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  globalThis.cwGateCalls = 0;
  try {
    for (const n of names) delete process.env[n];
    for (const flag of [undefined, "false", "TRUE", "1"]) {
      if (flag === undefined) delete process.env.CHECK_WRITER_SALES_ENABLED;
      else process.env.CHECK_WRITER_SALES_ENABLED = flag;
      process.env.CHECK_WRITER_ENCRYPTION_KEY = "ab".repeat(32);
      assert.match(
        (await startCardCheckout("print-check")).message,
        /being configured/,
      );
    }
    process.env.CHECK_WRITER_SALES_ENABLED = "true";
    delete process.env.CHECK_WRITER_ENCRYPTION_KEY;
    assert.match(
      (await startCardCheckout("print-check")).message,
      /being configured/,
    );
    assert.equal(globalThis.cwGateCalls, 0);
    process.env.CHECK_WRITER_ENCRYPTION_KEY = "ab".repeat(32);
    assert.equal(
      (await startCardCheckout("print-check")).message,
      "LOCAL_GATE_PASSED",
    );
    assert.equal(globalThis.cwGateCalls, 1);
    delete process.env.CHECK_WRITER_SALES_ENABLED;
    await startCardCheckout("booking-policy");
    assert.equal(globalThis.cwGateCalls, 2);
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
    delete globalThis.cwGateCalls;
  }
});
