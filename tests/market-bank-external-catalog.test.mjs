import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["lib/market-catalog-view.ts"], bundle: true, write: false, format: "esm", platform: "node", alias: { "@": process.cwd() } });
const { marketAppsWithBankPricing } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const sample = {
  id: "print-check", name: "Print Check", publisher: "Old publisher", category: "Payroll", symbol: "PC", color: "peach",
  summary: "Preview payroll printing.", description: "Explore a proposed check printing workflow.", features: ["Check layout preview"], permissions: ["Read payroll totals"],
  price: "From $12 / month", trial: "14-day trial", available: false,
  plans: [{ name: "Starter", price: "$12 / month", detail: "50 checks" }, { name: "Studio", price: "$24 / month", detail: "250 checks" }],
};
const plan = (plugin_id, extra = {}) => ({ plugin_id, name: "Prepared External Plugin", publisher: "New Publisher", price_cents: 1995, published: true, fulfillment_ready: false, ...extra });

test("Configured external concepts use admin name, publisher and one proposed price without enabling purchase", () => {
  const before = JSON.stringify(sample);
  const result = marketAppsWithBankPricing([sample], [plan("print-check")]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "Prepared External Plugin"); assert.equal(result[0].publisher, "New Publisher");
  assert.equal(result[0].price, "$19.95 / month"); assert.equal(result[0].available, false);
  assert.match(result[0].trial, /Preview.*Paid sales are not available/);
  assert.equal(result[0].plans.length, 1); assert.equal(result[0].plans[0].price, "$19.95 / month");
  assert.match(result[0].plans[0].detail, /Proposed monthly price/);
  assert.equal(result[0].plans.some(item => item.price.includes("$24")), false);
  assert.equal(JSON.stringify(sample), before);
});

test("Published unknown external plugins appear as generic safe previews, even if an untrusted readiness flag is true", () => {
  const result = marketAppsWithBankPricing([sample], [plan("outside-reviews", { name: "Review Partner", publisher: "Review House", fulfillment_ready: true })]);
  assert.equal(result.length, 2);
  const external = result[1]; assert.equal(external.id, "outside-reviews"); assert.equal(external.name, "Review Partner");
  assert.equal(external.publisher, "Review House"); assert.equal(external.category, "Commerce"); assert.equal(external.color, "blue"); assert.equal(external.symbol, "RP");
  assert.equal(external.available, false); assert.equal(external.price, "$19.95 / month");
  assert.match(external.trial, /Paid sales are not available/); assert.match(external.permissions.join(" "), /No installation or payment/);
  assert.equal(external.plans.length, 1); assert.equal(external.plans[0].price, external.price);
  assert.strictEqual(result[0], sample);
});

test("Unpublished unknown drafts stay private; catalog-backed sample visibility remains available to the caller", () => {
  const hidden = plan("private-plugin", { published: false, name: "Private idea", publisher: "Private publisher" });
  const configuredHidden = plan("print-check", { published: false });
  const result = marketAppsWithBankPricing([sample], [hidden, configuredHidden]);
  assert.equal(result.length, 1); assert.equal(result[0].id, "print-check"); assert.equal(result[0].available, false);
  assert.equal(JSON.stringify(result).includes("Private idea"), false);
  assert.equal(result[0].price, "$19.95 / month");
});

test("Internal plugin prices update workflow text and honor published fulfillment readiness", () => {
  const internal = { ...sample, id: "booking-policy", name: "Booking Rules", publisher: "Reylumi", price: "$0.99 / month", available: true,
    description: "Subscribe for $0.99 per month.", features: ["$0.99 monthly access"], workflow: ["Subscribe for $0.99 per month"],
    plans: [{ name: "Booking Rules", price: "$0.99 / month", detail: "Pay $0.99 monthly." }] };
  const ready = marketAppsWithBankPricing([internal], [plan("booking-policy", { name: "Booking Rules", publisher: "Reylumi", price_cents: 250, fulfillment_ready: true })])[0];
  assert.equal(ready.available, true); assert.equal(ready.price, "$2.50 / month");
  assert.equal(JSON.stringify(ready).includes("$0.99"), false); assert.match(ready.workflow[0], /\$2\.50/);
  const unready = marketAppsWithBankPricing([internal], [plan("booking-policy", { fulfillment_ready: false })])[0];
  assert.equal(unready.available, false); assert.match(unready.trial, /Preview/);
});

test("Invalid catalog prices and IDs cannot create broken or duplicate preview listings", () => {
  const result = marketAppsWithBankPricing([sample], [plan("negative", { price_cents: -1 }), plan("fraction", { price_cents: 99.1 }),
    plan("unsafe", { price_cents: Number.MAX_SAFE_INTEGER }), plan("../outside", {}), plan("valid-plugin"), plan("valid-plugin", { name: "Updated title" })]);
  assert.equal(result.length, 2); assert.equal(result[1].id, "valid-plugin"); assert.equal(result[1].name, "Updated title");
  assert.strictEqual(result[0], sample);
});

test("Native free plugins and Campaigns credits keep their established price and behavior despite conflicting catalog data", () => {
  const nativeIds = ["payroll-data-download", "campaigns", "service-relay"];
  const apps = nativeIds.map(id => ({ ...sample, id, name: id, publisher: "Reylumi", available: true,
    price: id === "campaigns" ? "Free to add" : "Free", trial: id === "campaigns" ? "Separate ad credits" : "No paid upgrade" }));
  const catalog = nativeIds.map(id => plan(id, { published: true, fulfillment_ready: true, price_cents: 99999 }));
  const result = marketAppsWithBankPricing(apps, catalog);
  for (let index = 0; index < apps.length; index++) assert.strictEqual(result[index], apps[index]);
  assert.deepEqual(marketAppsWithBankPricing([], catalog), []);
});
