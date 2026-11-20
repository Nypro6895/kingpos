import { MARKET_PRICE_DEFAULTS } from "@/lib/market-commerce";
import type { MarketApp } from "@/app/market/sample-apps";

type CatalogPrice = {
  plugin_id: string; name?: string; publisher?: string; price_cents: number;
  published: boolean; fulfillment_ready: boolean; monthly_sms_limit?:number;
};
const PREVIEW_TRIAL = "Preview · Paid sales are not available yet";
const SEPARATE_BILLING_PLUGINS = new Set(["payroll-data-download", "campaigns", "service-relay"]);
function validPlan(plan: CatalogPrice) {
  return !SEPARATE_BILLING_PLUGINS.has(plan.plugin_id)
    && /^[a-z][a-z0-9-]{1,79}$/.test(plan.plugin_id) && Number.isSafeInteger(plan.price_cents)
    && plan.price_cents >= 0 && plan.price_cents <= 100_000_000;
}
function monthlyPrice(plan: CatalogPrice) {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(plan.price_cents / 100);
  return `${amount} / ${plan.plugin_id === "vietnamese-language" ? "tháng" : "month"}`;
}
function previewPlan(name: string, price: string) {
  return { name, price, detail: "Proposed monthly price · USD per salon · Paid sales are not available yet. Permissions and activation must be approved before purchase." };
}

export function marketAppsWithBankPricing(apps: MarketApp[], catalog: CatalogPrice[]): MarketApp[] {
  const plans = new Map(catalog.filter(validPlan).map(plan => [plan.plugin_id, plan]));
  const projected = apps.map(app => {
    const plan = plans.get(app.id);
    const old = MARKET_PRICE_DEFAULTS[app.id];
    if (!plan) return app;
    const name = plan.name?.trim() || app.name, publisher = plan.publisher?.trim() || app.publisher;
    if (app.id === "print-check" && (!plan.fulfillment_ready || plan.price_cents === 0)) return {...app, name, publisher, price:plan.price_cents>0?monthlyPrice(plan):"$4.90 / month", available:false, trial:"Paid sales are not available yet", plans:[]};
    const price = monthlyPrice(plan);
    if (app.id === "booksms") return {...app,available:plan.published && plan.fulfillment_ready,price:plan.fulfillment_ready?monthlyPrice(plan):"Price pending",trial:plan.fulfillment_ready?`Monthly paid access · ${plan.monthly_sms_limit??0} SMS per calendar month (UTC)`:"Price and SMS allowance are being prepared; purchases are closed"};
    if (old === undefined) {
      // A published proposal is visible, but cannot activate or accept payment.
      return { ...app, name, publisher, price, available: false,
        trial: PREVIEW_TRIAL, plans: [previewPlan(name, price)] };
    }
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(plan.price_cents / 100);
    const replacePrice = (text: string) => text.replaceAll(`$${(old / 100).toFixed(2)}`, amount);
    const ready = plan.published && plan.fulfillment_ready;
    return { ...app, name, publisher, price, available: ready, description: replacePrice(app.description),
      trial: ready ? app.id === "vietnamese-language" ? "5-day free trial · Optional monthly subscription" : "Monthly subscription · Cancel future renewal anytime" : PREVIEW_TRIAL,
      features: app.features.map(replacePrice), workflow: app.workflow?.map(replacePrice),
      plans: ready ? app.plans?.map(item => ({ ...item, price, detail: `${replacePrice(item.detail)} · Card subscription; total tax and fees are shown before payment.` })) : [previewPlan(name, price)] };
  });
  const existingIds = new Set(apps.map(app => app.id));
  for (const plan of plans.values()) {
    if (existingIds.has(plan.plugin_id) || !plan.published) continue;
    const name = plan.name?.trim() || plan.plugin_id;
    const publisher = plan.publisher?.trim() || "External publisher";
    const price = monthlyPrice(plan);
    projected.push({
      id: plan.plugin_id, name, publisher, category: "Commerce", color: "blue",
      symbol: name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase() || "P",
      available: false, price, trial: PREVIEW_TRIAL,
      summary: `A plugin preview from ${publisher}. Paid sales are not available yet.`,
      description: "This proposed plugin is being prepared. The listed monthly price is a preview. Integration, permissions and activation must be reviewed before customers can purchase it.",
      features: ["Publisher proposal and monthly price", "Integration and activation review before paid sales"],
      permissions: ["Permissions will be reviewed before this plugin becomes available", "No installation or payment is available for this preview"],
      workflow: ["Review the publisher proposal", "Check back when integration and activation are ready"],
      plans: [previewPlan(name, price)],
    });
  }
  return projected;
}
