import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const salonId = "11111111-1111-4111-8111-111111111111";
const catalog = [
  ["booking-deposit", "Booking Deposit", 1100], ["booking-policy", "Booking Rules", 250],
  ["checkin-receipt", "Check-in Receipt", 700], ["vietnamese-language", "Tiếng Việt", 600],
].map(([plugin_id, name, price_cents]) => ({ plugin_id, name, price_cents, publisher: "Reylumi", interval: "month", published: true, fulfillment_ready: true, commission_bps: 0, version: 2 }));
const state = { available: true, salon_id: salonId, reason: null, unavailable_reason: null,
  settings: { enabled: true, ready: true, currency: "USD", order_expiry_hours: 72, tax_bps: 800, fee_bps: 200, fixed_fee_cents: 30, tax_label: "Sales tax", version: 2 }, catalog, orders: [] };
const order = { id: "22222222-2222-4222-8222-222222222222", reference: "RYL-INTEGRATION-001", salon_id: salonId,
  plugin_id: "booking-deposit", plugin_name: "Booking Deposit", publisher: "Reylumi", bank_account_id: "33333333-3333-4333-8333-333333333333",
  snapshot: { bank: { id: "33333333-3333-4333-8333-333333333333", label: "USD", bank_name: "Test Bank", beneficiary: "Reylumi", account_number: "123456789", routing: "TESTUS33", instructions: "Include the reference.", version: 2 }, currency: "USD", interval: "month", tax_bps: 800, fee_bps: 200, fixed_fee_cents: 30, tax_label: "Sales tax", settings_version: 2, catalog_version: 2, commission_bps: 0 },
  base_cents: 1100, tax_cents: 88, fee_cents: 54, total_cents: 1242, received_cents: 0, unapplied_cents: 0,
  refunded_cents: 0, refunded_applied_cents: 0, currency: "USD", status: "awaiting_payment", created_at: "2026-10-09T12:00:00Z", expires_at: "2099-10-12T12:00:00Z", paid_at: null, service_start: null, service_end: null };

test("Market uses published catalog prices, refreshes paid plugin access and retains legacy portal access", { timeout: 90_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MarketClient}from'./app/market/market-client';
    const params=new URLSearchParams(location.search);
    const bank=${JSON.stringify(state)},order=${JSON.stringify(order)};
    const deposit={enabled:false,mode:'fixed',value:20,checkout:'both',active:false,subscribed:false,connected:true,installed:true,testMode:false};
    const vietnamese={installed:true,active:false,staff_enabled:true,portable_enabled:false,trial_ends_at:'2025-10-09T12:00:00Z',paid_until:null,has_subscription:false};
    if(params.has('public')){bank.salon_id=null;bank.catalog=bank.catalog.filter(item=>item.plugin_id==='booking-policy');deposit.installed=false;vietnamese.installed=false;}
    if(params.has('empty')){bank.salon_id=null;bank.catalog=[];deposit.installed=false;vietnamese.installed=false;}
    const props={bankBillingState:bank,bookingDeposit:deposit,vietnameseState:vietnamese,paymentsAvailable:false,bookingPolicy:{content:'Please arrive on time.',published:false,active:false,subscribed:false},checkinReceipt:{active:false,subscribed:false},vietnamesePublished:false};
    if(params.has('hiddeninstalled')){bank.catalog=[];props.bookingPolicy.active=true;props.checkinReceipt.subscribed=true;}
    if(params.has('external')){bank.catalog.push({plugin_id:'print-check',name:'Configured Print Preview',publisher:'Published Partner',price_cents:3333,published:true,fulfillment_ready:false,interval:'month',commission_bps:1500,version:1},{plugin_id:'partner-reception',name:'Partner Reception',publisher:'Outside Partner',price_cents:1299,published:true,fulfillment_ready:false,interval:'month',commission_bps:1500,version:1});}
    if(params.has('hiddenexternal')){bank.hidden_plugin_ids=['print-check','partner-reception'];}
    if(params.has('legacytest')){deposit.testMode=true;deposit.subscribed=true;deposit.active=true;}
    window.testOrder=order;window.latestBilling=bank;
    function App(){const[value,setValue]=useState(props);window.marketProps=value;window.updateServerProps=setValue;
      window.stagePaidRefresh=(plugin)=>{const original=window.testOrder;const paid={...original,plugin_id:plugin,plugin_name:plugin==='vietnamese-language'?'Tiếng Việt':'Booking Deposit',status:'paid',received_cents:original.total_cents,paid_at:'2026-10-09T14:00:00Z',service_start:'2026-10-09T14:00:00Z',service_end:'2099-11-09T14:00:00Z'};
        window.latestBilling={...window.latestBilling,orders:[paid]};window.pendingAuthoritativeProps={...window.marketProps,bankBillingState:window.latestBilling,bookingDeposit:{...window.marketProps.bookingDeposit,active:true},vietnameseState:{...window.marketProps.vietnameseState,active:true,paid_until:paid.service_end}};};
      return <MarketClient {...value}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: "bundle.js", bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, plugins: [{ name: "mock-market-boundaries", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|next\/image|@\/components\/workspace-language|.*(?:bank-payment-actions|booking-deposit-actions|booking-policy-actions|vietnamese-actions|checkin-receipt-actions|plugin-actions|credit-actions|service-relay\/actions|contact-form))$/ }, args => ({ path: args.path, namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/image" ? `import React from'react';export default function Image({src,alt,width,height,className}){return <img src={src} alt={alt} width={width} height={height} className={className}/>} ` : args.path === "next/navigation" ? `export function useRouter(){return{refresh(){window.refreshes=(window.refreshes||0)+1;if(window.pendingAuthoritativeProps){window.updateServerProps(window.pendingAuthoritativeProps);window.pendingAuthoritativeProps=null;}},push(){}}}` : args.path.includes("workspace-language") ? `export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return text=>text}` : args.path.includes("contact-form") ? `export function ContactSupportForm(){return null}` : `
      export async function createMarketBankOrder(plugin,request){window.testOrder={...window.testOrder,plugin_id:plugin};window.latestBilling={...window.latestBilling,orders:[window.testOrder]};return{order:window.testOrder,state:window.latestBilling}}
      export async function refreshMarketBankBilling(){return window.latestBilling}
      export async function cancelMarketBankOrder(){return{error:'Not used'}}
      export async function bookingDepositBillingAction(portal){window.portal=portal;if(window.recordPortalArgument)await window.recordPortalArgument(portal);return{url:'https://billing.stripe.com/integration-test'}}
      export async function bookingPolicyPaymentAction(portal){window.portal=portal;return{url:'https://billing.stripe.com/integration-test'}}
      export async function vietnamesePaymentAction(portal){window.portal=portal;return{url:'https://billing.stripe.com/integration-test'}}
      export async function checkinReceiptPaymentAction(portal){window.portal=portal;return{url:'https://billing.stripe.com/integration-test'}}
      export async function loadBookingDepositAction(){return{state:window.marketProps.bookingDeposit}}
      export async function saveBookingDepositAction(state){return{state}}
      export async function installBookingDepositAction(installed){return{state:{...window.marketProps.bookingDeposit,installed}}}
      export async function connectBookingStripeAction(){return{error:'Not used'}}
      export async function saveBookingPolicy(){return{saved:true}}
      export async function setVietnamesePlugin(){return{state:window.marketProps.vietnameseState}}
      export async function setPayrollDataPlugin(installed){return{installed}}
      export async function setCampaignPluginAction(installed){return{installed}}
      export async function setServiceRelayPlugin(installed){return{installed}}
    ` }));
  } }] });
  const js = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  const moduleCss = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const cssPath = ".next/static/css";
  const css = fs.existsSync(cssPath) ? fs.readdirSync(cssPath).filter(file => file.endsWith(".css")).map(file => fs.readFileSync(`${cssPath}/${file}`, "utf8")).join("\n") : "";
  const server = createServer((request, response) => {
    if (request.url.startsWith("/market/")) { response.setHeader("Content-Type", "image/svg+xml"); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><rect width="100" height="30" fill="#f3f5f3"/></svg>'); return; }
    response.setHeader("Content-Type", request.url.startsWith("/bundle.js") ? "application/javascript" : "text/html");
    response.end(request.url.startsWith("/bundle.js") ? js : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${moduleCss}\n:root{--text-primary:#262626;--text-secondary:#595959;--text-muted:#747474;--surface:#fff;--surface-muted:#faf8f5;--border-subtle:#e6e0da;--brand-orange:#d86232;--brand-orange-hover:#be5429;--brand-teal:#285d4c;--brand-teal-soft:#eef5ef}body{margin:0;background:#fafafa}*{box-sizing:border-box}img{max-width:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
    let portalArgument;
    await page.exposeFunction("recordPortalArgument", value => { portalArgument = value; });
    const artifactPath = "artifacts/market-bank-integration-qa"; fs.mkdirSync(artifactPath, { recursive: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 950 }); await page.goto(base);
      for (const item of catalog) {
        const card = page.getByRole("article").filter({ has: page.getByRole("button", { name: item.name, exact: true }) });
        await card.getByText(`$${(item.price_cents / 100).toFixed(2)} / ${item.plugin_id === "vietnamese-language" ? "tháng" : "month"}`, { exact: true }).waitFor();
      }
      await page.getByRole("button", { name: "View Booking Deposit", exact: true }).click();
      const dialog = page.getByRole("dialog"), payment = dialog.getByLabel("Booking Deposit bank payment"), deposit = dialog.getByLabel("Booking deposit settings");
      await payment.getByLabel("Purchase total").getByText("$12.42 USD", { exact: true }).waitFor();
      assert.equal(await deposit.getByRole("switch").isDisabled(), true);
      await payment.getByRole("button", { name: "Create bank payment invoice" }).click();
      await payment.getByText("RYL-INTEGRATION-001", { exact: true }).waitFor();
      await page.evaluate(() => window.stagePaidRefresh("booking-deposit"));
      await payment.getByRole("button", { name: "Refresh payment status" }).click();
      await payment.getByText("Payment confirmed", { exact: true }).waitFor();
      await deposit.getByText("Subscribed", { exact: true }).waitFor();
      assert.equal(await deposit.getByRole("switch").isEnabled(), true);
      assert.equal(await payment.getByRole("button", { name: "Create bank payment invoice" }).count(), 0);
      await page.evaluate(() => {
        const current = window.marketProps;
        const updated = { ...current.bankBillingState, settings: { ...current.bankBillingState.settings, version: 3 },
          catalog: current.bankBillingState.catalog.map(item => item.plugin_id === "booking-deposit" ? { ...item, price_cents: 1400, version: 3 } : item) };
        window.latestBilling = updated; window.updateServerProps({ ...current, bankBillingState: updated });
      });
      await dialog.getByText("$14.00 / month", { exact: true }).waitFor();
      await payment.getByLabel("Payment invoice").getByText("$12.42 USD", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `${artifactPath}/paid-dialog-${width}.png`, fullPage: false });
      await dialog.getByRole("button", { name: "Close details" }).click();
      await page.getByRole("button", { name: "My features" }).click();
      await page.getByRole("button", { name: "View Booking Deposit", exact: true }).waitFor();
    }
    await page.goto(base + "?public");
    await page.getByRole("button", { name: "View Booking Rules", exact: true }).waitFor();
    for (const name of ["Booking Deposit", "Check-in Receipt", "Tiếng Việt"]) assert.equal(await page.getByRole("button", { name: `View ${name}`, exact: true }).count(), 0);
    await page.getByRole("button", { name: "View Booking Rules", exact: true }).click();
    assert.equal(await page.getByRole("dialog").getByRole("button", { name: "Create bank payment invoice" }).isDisabled(), true);
    await page.goto(base + "?empty"); await page.getByRole("heading", { name: "Market", exact: true }).waitFor();
    for (const item of catalog) assert.equal(await page.getByRole("button", { name: `View ${item.name}`, exact: true }).count(), 0);
    await page.goto(base + "?hiddeninstalled");
    for (const item of catalog) await page.getByRole("button", { name: `View ${item.name}`, exact: true }).waitFor();
    await page.getByRole("button", { name: "My features" }).click();
    for (const item of catalog) await page.getByRole("button", { name: `View ${item.name}`, exact: true }).waitFor();
    await page.goto(base); await page.getByRole("button", { name: "View Tiếng Việt", exact: true }).click();
    const vi = page.getByRole("dialog").getByLabel("Tùy chọn plugin tiếng Việt");
    await vi.getByText("Dùng thử đã kết thúc. Đăng ký để tiếp tục sử dụng.", { exact: true }).waitFor();
    await page.evaluate(() => { window.stagePaidRefresh("vietnamese-language"); window.updateServerProps(window.pendingAuthoritativeProps); window.pendingAuthoritativeProps = null; });
    await vi.getByText("Plugin đang hoạt động.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("dialog").getByRole("button", { name: "Create bank payment invoice" }).count(), 0);
    await page.goto(base + "?external");
    for (const [name, price] of [["Configured Print Preview", "$33.33 / month"], ["Partner Reception", "$12.99 / month"]]) {
      const card = page.getByRole("article").filter({ has: page.getByRole("button", { name, exact: true }) });
      await card.getByText(price, { exact: true }).waitFor();
      await card.getByText("Preview · Paid sales are not available yet", { exact: true }).waitFor();
      await page.getByRole("button", { name: `View ${name}`, exact: true }).click();
      const preview = page.getByRole("dialog"); await preview.getByText(price, { exact: true }).waitFor();
      assert.equal(await preview.getByRole("button", { name: "Create bank payment invoice" }).count(), 0);
      assert.equal(await preview.getByRole("button", { name: "Add to Reylumi", exact: true }).count(), 0);
      await preview.getByRole("button", { name: "View availability", exact: true }).click();
      await preview.getByRole("heading", { name: "Thanks for your interest!" }).waitFor();
      await preview.getByRole("button", { name: "Got it", exact: true }).click();
    }
    await page.goto(base + "?hiddenexternal"); await page.getByRole("heading", { name: "Market", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "View Print Check", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "View Partner Reception", exact: true }).count(), 0);
    await page.getByRole("button", { name: "View Inventory Sync", exact: true }).waitFor();
    await page.route("https://billing.stripe.com/**", route => route.fulfill({ contentType: "text/html", body: "Legacy billing portal" }));
    await page.goto(base + "?legacytest"); await page.getByRole("button", { name: "View Booking Deposit", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Booking deposit settings").getByRole("button", { name: "Manage subscription", exact: true }).click();
    await page.waitForURL("https://billing.stripe.com/integration-test"); assert.equal(portalArgument, true);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
