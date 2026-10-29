import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("subscription lifecycle fails closed and permits provider-verified cancellation", async () => {
  await build({
    entryPoints: ["lib/check-writer-subscription.ts"],
    outfile: "work/check-writer-audit-20261028/subscription.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    plugins: [
      {
        name: "server",
        setup(b) {
          b.onResolve({ filter: /^server-only$/ }, () => ({
            path: "empty",
            namespace: "empty",
          }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
            contents: "",
          }));
        },
      },
    ],
  });
  const {
    checkWriterSubscription,
  } = require("../work/check-writer-audit-20261028/subscription.cjs");
  for (const status of [
    "active",
    "past_due",
    "refunded",
    "canceled",
    "unknown",
  ]) {
    const service = {
      from(table) {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          order() {
            return q;
          },
          limit() {
            return q;
          },
          async maybeSingle() {
            return {
              data:
                table === "check_writer_subscriptions"
                  ? {
                      stripe_subscription: "sub_demo",
                      payment_owner: "owner",
                      paid_until: "2020-01-01",
                    }
                  : { status, synced_at: "2026-10-28" },
              error: null,
            };
          },
        };
        return q;
      },
    };
    const state = await checkWriterSubscription(service, "salon", "owner");
    assert.equal(state.active, false);
    assert.equal(state.subscribed, status !== "canceled");
  }
});
test("real Market card panel uses $4.90, blocks unavailable/active sales and checks verified return on iOS/Windows", async () => {
  const r = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CardCheckoutPanel} from './app/market/card-checkout-panel';import {CheckWriterPanel} from './app/market/check-writer-panel';const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<><CheckWriterPanel state={{active:q.has('active'),subscribed:q.has('active'),operationalReady:!q.has('unready')}}/><CardCheckoutPanel pluginId="print-check" pluginName="Check Writer" ready={!q.has('unready')} hasActiveSubscription={q.has('active')} onStateChange={()=>{}} billingState={{salon_id:'demo',catalog:[{plugin_id:'print-check',price_cents:490,published:true,fulfillment_ready:true}],settings:{tax_bps:0,fee_bps:0,fixed_fee_cents:0}} as any}/></>);`,
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    plugins: [
      {
        name: "mock",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^next\/|^@\/components\/workspace-language$|^\.\/card-payment-actions$|^\.\/check-writer-actions$/,
            },
            (a) => ({ path: a.path, namespace: "mock" }),
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
            resolveDir: process.cwd(),
            loader: "js",
            contents:
              a.path === "next/link"
                ? `import React from 'react';export default p=>React.createElement('a',p);`
                : a.path === "next/navigation"
                  ? `const router={refresh(){window.refreshes=(window.refreshes||0)+1}};export const useRouter=()=>router;`
                  : a.path.includes("workspace-language")
                    ? `export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;`
                    : a.path.includes("check-writer-actions")
                      ? `export async function manageCheckWriterSubscription(){return {url:'https://billing.stripe.com/p/session/demo'}}`
                      : `export async function startCardCheckout(id,external){window.started={id,external};return {checkoutUrl:'https://checkout.stripe.com/c/pay/demo'}};export async function refreshCardPurchase(){window.checked=(window.checked||0)+1;return {message:'Payment still pending verification.'}}`,
          }));
        },
      },
    ],
  });
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script>' +
        r.outputFiles[0].text +
        "</script></html>",
    );
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: mobile ? 390 : 1440, height: 900 },
        userAgent: mobile
          ? "Mozilla/5.0 (iPhone) ReylumiIOS/1.0"
          : "Mozilla/5.0 Windows",
      });
      const url = `http://127.0.0.1:${server.address().port}`;
      await page.goto(url + "?unready");
      await page
        .getByRole("button", { name: "Card payments not available yet" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Card payments not available yet" })
          .isDisabled(),
        true,
      );
      await page.goto(url + "?active");
      await page.getByRole("link", { name: "Open Check Writer" }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Buy with card" }).count(),
        0,
      );
      await page.goto(url);
      await page.getByText("$4.90 / month", { exact: true }).waitFor();
      await page.screenshot({
        path: `work/check-writer-audit-20261028/market-${mobile ? "ios" : "windows"}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Buy with card" }).click();
      await page
        .getByRole("link", { name: "Continue to secure checkout" })
        .waitFor();
      assert.equal(
        (await page.evaluate(() => window.started)).id,
        "print-check",
      );
      assert.equal(
        (await page.evaluate(() => window.started)).external,
        mobile,
      );
      await page.getByRole("button", { name: "Check payment status" }).click();
      await page.getByText("Payment still pending verification.").waitFor();
      assert.equal(await page.evaluate(() => window.checked), 1);
      assert.equal(
        await page.getByRole("link", { name: "Open Check Writer" }).count(),
        0,
      );
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((ok) => server.close(ok));
  }
});
