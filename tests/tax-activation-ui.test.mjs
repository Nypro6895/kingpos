import {browserServerBoundary} from './helpers/browser-server-boundary.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const salon = "00000000-0000-4000-8000-000000000010",
  other = "00000000-0000-4000-8000-000000000011";
test(
  "Tax activation follow-up: confirmed scope only, cancelled requests and explicit trial next step",
  { timeout: 60000 },
  async () => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {TaxActivationFollowup} from './app/tax/tax-activation-followup';import {MarketTrialPanel} from './app/market/trial-panel';import {TaxPaymentReturnLinks} from './app/market/tax-payment-return-links';const root=createRoot(document.getElementById('root'));window.renderView=(mode,salon,active=false)=>root.render(mode==='return'?<TaxPaymentReturnLinks/>:mode==='trial'?<MarketTrialPanel pluginId="tax-company" scope={'owner:'+salon} salonId={salon}/>:<TaxActivationFollowup salonId={salon} active={active}/>);`,
      },
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      alias: { "@": process.cwd() },
      plugins: [browserServerBoundary(),
        {
          name: "activation-boundaries",
          setup(api) {
            const stubs = {
 "./scoped-market-client": `const actions={marketTrialAction:async(plugin,start,salon)=>{window.trials.push({plugin,start,salon});return start?{state:{started:true,active:true,paid:false,endsAt:'2030-01-01'},activationHref:'/payroll/tax-company/settings?salon='+salon+'&setup=1'}:{state:{started:false,active:false,paid:false,endsAt:null}}}};export const useScopedMarketActions=()=>actions`, 
              "next/navigation": `const router={push(href){window.moves.push({kind:'push',href})},replace(href){window.moves.push({kind:'replace',href})},refresh(){window.refreshes++}};export function useRouter(){return router} export function useSearchParams(){return new URLSearchParams(window.paymentQuery??'')}`,
              "next/link": `import React from 'react';export default function Link(props){return React.createElement('a',props,props.children)}`,
              "./flow-actions": `export async function refreshTaxRenewal(){window.checks++;if(window.defer)return new Promise(resolve=>{window.resolveCheck=resolve});return window.response}`,
              "./trial-actions": `export async function marketTrialAction(plugin,start,salon){window.trials.push({plugin,start,salon});return start?{state:{started:true,active:true,paid:false,endsAt:'2030-01-01'},activationHref:'/payroll/tax-company/settings?salon='+salon+'&setup=1'}:{state:{started:false,active:false,paid:false,endsAt:null}}}`,
              "@/lib/refresh-market-experience": `export function refreshMarketExperience(){window.refreshes++}`,
            };
            api.onResolve({ filter: /.*/ }, (args) =>
              stubs[args.path]
                ? { path: args.path, namespace: "stub" }
                : undefined,
            );
            api.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
              contents: stubs[args.path],
              resolveDir: process.cwd(),
            }));
          },
        },
      ],
    });
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const p = await browser.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      await p.route("https://reylumi.test/**", (r) =>
        r.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }),
      );
      await p.goto("https://reylumi.test/market");
      await p.evaluate(() => {
        window.moves = [];
        window.refreshes = 0;
        window.checks = 0;
        window.trials = [];
        window.response = { active: false };
      });
      await p.addScriptTag({ content: bundle.outputFiles[0].text });
      await p.evaluate((s) => window.renderView("followup", s), salon);
      await p
        .getByRole("heading", { name: "Confirming Tax Company access" })
        .waitFor();
      await p.waitForFunction(() => window.checks === 1);
      assert.deepEqual(await p.evaluate(() => window.moves), []);
      // A response for another salon never opens credentials for this salon.
      await p.evaluate(
        ({ salon, other }) => {
          window.response = { active: true, salonId: other };
          window.renderView("followup", salon, true);
        },
        { salon, other },
      );
      await p
        .getByRole("heading", { name: "Next: connect your tax professional" })
        .waitFor();
      await p.evaluate((s) => window.renderView("followup", s, false), salon);
      await p.waitForFunction(() => window.checks === 2);
      assert.deepEqual(await p.evaluate(() => window.moves), []);
      // Leaving the paid salon while confirmation is in flight drops its late response.
      await p.evaluate((s) => window.renderView("followup", s, true), salon);
      await p.evaluate((s) => {
        window.defer = true;
        window.renderView("followup", s, false);
      }, other);
      await p.waitForFunction(() => typeof window.resolveCheck === "function");
      await p.evaluate((s) => window.renderView("followup", s, true), salon);
      await p
        .getByRole("heading", { name: "Next: connect your tax professional" })
        .waitFor();
      await p.evaluate(
        (s) => window.resolveCheck({ active: true, salonId: s }),
        other,
      );
      assert.deepEqual(await p.evaluate(() => window.moves), []);
      await p.evaluate((s) => {
        window.defer = false;
        window.response = { active: true, salonId: s };
        window.renderView("followup", s, false);
      }, salon);
      await p.waitForFunction(() => window.moves.length === 1);
      assert.match(
        (await p.evaluate(() => window.moves))[0].href,
        new RegExp(salon),
      );
      await p.evaluate((s) => window.renderView("trial", s), salon);
      await p.getByRole("button", { name: "Start 5-day free trial" }).click();
      await p.waitForFunction(() =>
        window.moves.some((m) => m.kind === "push"),
      );
      assert.equal(
        (await p.evaluate(() => window.trials)).filter((c) => c.start).length,
        1,
      );
      await p.evaluate((s) => {
        window.paymentQuery = "plugin=tax-company&salon=" + s;
        window.renderView("return", s);
      }, salon);
      const website = p.getByRole("link", {
        name: "Continue to Tax connection setup on the website",
        exact: true,
      });
      await website.waitFor();
      assert.equal(
        await p
          .getByRole("link", { name: "Open Reylumi app", exact: true })
          .getAttribute("href"),
        "reylumi://market?salon=" + salon,
      );
      assert.equal(
        new URL(
          await website.getAttribute("href"),
          "https://reylumi.com",
        ).searchParams.get("salon"),
        salon,
      );
      await p.evaluate(() => {
        window.paymentQuery = "plugin=tax-company&salon=https://evil.test";
        window.renderView("return", "invalid");
      });
      await p
        .getByRole("link", { name: "Continue on the website", exact: true })
        .waitFor();
      assert.equal(
        await p
          .getByRole("link", { name: "Continue on the website", exact: true })
          .getAttribute("href"),
        "/market",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
