import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Render actual components with inert navigation/translation boundaries.
// No effects, auth, payment, database, native printing or provider acceptance.
const fences = {
  "next/link": 'import React from "react"; export default function Link({href,children,...props}) {return React.createElement("a",{...props,href},children);}',
  "@/components/workspace-language": "export const useWorkspaceTranslation=()=>value=>value;export const WorkspaceText=({text})=>text;",
  "@/components/use-overlay-viewport": "export const useOverlayViewport=()=>({});",
  "./check-writer-actions": "export function manageCheckWriterSubscription(){throw Error('Unexpected billing action');}",
  "@/lib/open-market-payment": "export function openMarketPayment(){throw Error('Unexpected payment navigation');}",
  "./scoped-market-client": "export const useScopedMarketActions=()=>({startCardCheckout(){throw Error('Unexpected checkout');},refreshCardPurchase(){throw Error('Unexpected refresh');},manageCardSubscription(){throw Error('Unexpected billing');}});",
  "@/lib/refresh-market-experience": "export function refreshMarketExperience(){throw Error('Unexpected refresh');}",
  "next/navigation": "export const useRouter=()=>({refresh(){throw Error('Unexpected navigation');}});",
};
const result = await build({
  stdin: { contents: 'export {CheckWriter} from "@/app/check-writer/check-writer";export {CheckWriterPanel} from "@/app/market/check-writer-panel";export {CardCheckoutPanel} from "@/app/market/card-checkout-panel";export {sampleApps} from "@/app/market/sample-apps";export {marketAppsWithBankPricing} from "@/lib/market-catalog-view";', loader: "tsx", resolveDir: root },
  absWorkingDir: root, bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", packages: "external",
  plugins: [{ name: "unavailable-render-boundaries", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === "react" || args.path.startsWith("react/") || args.path.startsWith("react-dom/")) return { path: args.path, external: true };
      if (Object.hasOwn(fences, args.path)) return { path: args.path, namespace: "inert" };
      if (args.path.endsWith(".css")) return { path: args.path, namespace: "styles" };
    });
    builder.onLoad({ filter: /.*/, namespace: "inert" }, args => ({ contents: fences[args.path], loader: "tsx" }));
    builder.onLoad({ filter: /.*/, namespace: "styles" }, () => ({ contents: 'export default new Proxy({}, {get:(_target,key)=>String(key)});' }));
  } }],
});
const module = { exports: {} };
new Function("module", "exports", "require", result.outputFiles[0].text)(module, module.exports, require);
const { CheckWriter, CheckWriterPanel, CardCheckoutPanel, sampleApps, marketAppsWithBankPricing } = module.exports;
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test("direct Check Writer initial render reports unavailable without creation or print controls", () => {
  const html = render(CheckWriter, {});
  assert.equal((html.match(/Print Check is not available\./g) ?? []).length, 1);
  assert.doesNotMatch(html, /Review checks|Confirm &amp; create checks|Unlock Check Writer|<iframe|Prepare PDF/);
});

for (const [name, state] of [
  ["paid", { active: true, subscribed: true, installed: true }],
  ["trial", { active: true, subscribed: false, installed: true }],
  ["expired", { active: false, subscribed: true, installed: true }],
  ["uninstalled", { active: false, subscribed: false, installed: false }],
]) test(`Market ${name} state stays unavailable even with stale readiness=true; billing/history remain scoped`, () => {
  const html = render(CheckWriterPanel, { state: { ...state, operationalReady: true, trialReady: true } });
  assert.match(html, /Print Check is not available\./);
  assert.doesNotMatch(html, /Open Check Writer|Start the free trial|Free trial available|Check Writer is active/);
  assert.equal(html.includes("Manage subscription"), state.subscribed);
  assert.equal(html.includes("View check history"), state.active || state.installed);
});

test("catalog or price metadata cannot reopen Print Check or advertise its trial", () => {
  const app = sampleApps.find(app => app.id === "print-check");
  assert.equal(app.available, false);
  assert.equal(app.trial, "Print Check is not available.");
  for (const catalog of [[], [{ plugin_id: "print-check", published: true, fulfillment_ready: true, price_cents: 490 }]]) {
    const projected = marketAppsWithBankPricing(sampleApps, catalog).find(app => app.id === "print-check");
    assert.equal(projected.available, false);
    assert.equal(projected.trial, "Print Check is not available.");
    assert.deepEqual(projected.plans, []);
  }
});

test("unrelated catalog publication and pricing keep their existing behavior", () => {
  const app = sampleApps.find(app => app.id === "booking-deposit");
  const [projected] = marketAppsWithBankPricing([app], [{ plugin_id: app.id, published: true, fulfillment_ready: true, price_cents: 590 }]);
  assert.equal(projected.available, true);
  assert.equal(projected.price, "$5.90 / month");
});

for (const subscribed of [false, true]) test(`card panel does not promise a Print Check trial or purchase; subscribed=${subscribed}`, () => {
  const html = render(CardCheckoutPanel, {
    pluginId: "print-check", pluginName: "Check Writer", hasActiveSubscription: subscribed, ready: false,
    onStateChange() { throw Error("Unexpected billing mutation"); },
    billingState: { salon_id: "synthetic-salon", catalog: [{ plugin_id: "print-check", price_cents: 490, published: true, fulfillment_ready: false }],
      orders: [], settings: { enabled: false, ready: false, currency: "USD", order_expiry_hours: 24, tax_bps: 0, fee_bps: 0, fixed_fee_cents: 0, tax_label: "Tax", version: 1 } },
  });
  assert.doesNotMatch(html, /Free trial|trial access remains|Buy with card/);
  // Existing Check Writer billing management belongs to CheckWriterPanel,
  // covered above; this nested checkout stays empty for active subscriptions.
  if (subscribed) assert.equal(html, "");
  else assert.match(html, /Print Check is not available\./);
});
