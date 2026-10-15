import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("Market public first frame submits real GET filters and hands unsent typing/focus to the live view", { timeout: 60000, skip: !existsSync(executablePath) }, async () => {
  const result = await build({
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents: `
      import React,{Activity,useState}from'react';import{createRoot}from'react-dom/client';
      import{MarketStartupView}from'./app/market/market-startup-view';import{MarketClient}from'./app/market/market-client';
      import{marketBrowseFromQuery}from'./app/market/market-browse';
      const nativeRAF=requestAnimationFrame,nativeCancel=cancelAnimationFrame,frames=new Map();let sequence=1000000;window.holdRememberedFrames=false;window.requestAnimationFrame=fn=>{if(!window.holdRememberedFrames||!fn.toString().includes('restoreOnVisit'))return nativeRAF(fn);const id=++sequence;frames.set(id,fn);return id};window.cancelAnimationFrame=id=>{if(frames.has(id))frames.delete(id);else nativeCancel(id)};window.releaseRememberedFrames=()=>{window.holdRememberedFrames=false;for(const fn of frames.values())nativeRAF(fn);frames.clear()};
      const query=Object.fromEntries(new URLSearchParams(location.search));const initialBrowse=marketBrowseFromQuery(query);
      function App(){const[live,setLive]=useState(false);const[visible,setVisible]=useState(true);window.resolveMarket=()=>setLive(true);window.showMarket=setVisible;return <><button id='outside'>Outside</button><Activity mode={visible?'visible':'hidden'}>{live?<MarketClient experienceScope='fixture' initialBrowse={initialBrowse}/>:<MarketStartupView initialBrowse={initialBrowse}/>}</Activity></>};createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: "fixture.js", jsx: "automatic", alias: { "@": process.cwd() },
    plugins: [{ name: "stubs", setup(builder) {
      builder.onResolve({ filter: /^(next\/(image|navigation)|@\/components\/(workspace-language|experience-scope))$|(?:^|\/)(?:[a-z-]*actions|booksms-panel|tax-company-panel|booking-deposit-panel|booking-policy-panel|card-checkout-panel|campaign-preview|vietnamese-preview|tax-company-preview|app-logo|vietnamese-plugin-panel|contact-form)$/ }, args => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        args.path === "next/navigation" ? `export function useRouter(){return{refresh(){}}}` :
        args.path === "next/image" ? `import React from'react';export default function Image({priority,unoptimized,fill,...props}){return <img {...props}/ >}` :
        args.path.endsWith("workspace-language") ? `export function WorkspaceText({text}){return text}export function useWorkspaceTranslation(){return value=>value}` :
        args.path.endsWith("experience-scope") ? `export function useExperienceScope(){return{context:{scope:'fixture'}}}` :
        /actions$/.test(args.path) ? `export async function setServiceRelayPlugin(){}export async function checkinReceiptPaymentAction(){}export async function setCampaignPluginAction(){}export async function setPayrollDataPlugin(){}` :
        `export function BookSmsPanel(){return null}export function TaxCompanyMarketPanel(){return null}export function BookingDepositPanel(){return null}export function BookingPolicyPanel(){return null}export function CardCheckoutPanel(){return null}export function CampaignPreview(){return null}export function VietnamesePreview(){return null}export function TaxCompanyPreview(){return null}export function AppLogo(){return null}export function VietnamesePluginPanel(){return null}export function ContactSupportForm(){return null}`,
      }));
    }}],
  });
  const script = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = result.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const requests = [];
  const server = createServer((request, response) => {
    if (request.url.startsWith("/fixture.js")) { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    requests.push({ method: request.method, url: request.url });
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--surface:white;--text-primary:#222;--text-secondary:#555;--border-subtle:#ddd;--brand-teal:#1d807c;--brand-orange:#cf672a;--surface-muted:#f1f2f2}*{box-sizing:border-box}body{margin:0;font-family:Arial}button{border:0;background:none}${css}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${base}/market?q=Payroll&category=Payroll`);
    assert.equal(await page.getByRole("heading", { name: "Market", exact: true }).count(), 1);
    const firstFrameText = await page.locator("[data-market-startup]").innerText();
    assert.ok(!/\$|Added to your salon|Checkout completed|Payment confirmation|My features/.test(firstFrameText));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel("Search features", { exact: true }).fill("tax");
    await page.getByLabel("Search features", { exact: true }).press("ArrowLeft");
    await page.evaluate(() => window.resolveMarket());
    await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === "tax" && !document.querySelector("[data-market-startup]"));
    assert.equal(await page.getByLabel("Search features", { exact: true }).evaluate(input => document.activeElement === input), true);
    assert.equal(await page.getByLabel("Search features", { exact: true }).evaluate(input => input.selectionStart), 2);
    await page.getByLabel("Search features", { exact: true }).fill("Warm edit");
    await page.getByRole("button", { name: "Operations", exact: true }).click();
    await page.waitForTimeout(100);
    await page.evaluate(() => window.showMarket(false));
    await page.locator("#outside").click();
    await page.evaluate(() => window.showMarket(true));
    await page.waitForFunction(() => document.querySelector('input[aria-label="Search features"]')?.value === "Warm edit");
    assert.equal(await page.getByRole("button", { name: "Operations", exact: true }).getAttribute("aria-pressed"), "true");
    await page.goto(`${base}/market?q=Payroll&category=Payroll`);
    await page.getByLabel("Search features", { exact: true }).fill("Book");
    await page.getByRole("button", { name: "Payments", exact: true }).click();
    await page.waitForURL(url => url.searchParams.get("q") === "Book" && url.searchParams.get("category") === "Payments");
    assert.equal(requests.findLast(request => request.url.startsWith("/market")).method, "GET");
    await page.evaluate(() => window.resolveMarket());
    await page.waitForFunction(() => !document.querySelector("[data-market-startup]"));
    assert.equal(await page.getByLabel("Search features", { exact: true }).inputValue(), "Book");
    assert.equal(await page.getByRole("button", { name: "Payments", exact: true }).getAttribute("aria-pressed"), "true");
    await page.goto(`${base}/market`);
    await page.evaluate(() => { window.holdRememberedFrames = true; window.resolveMarket(); });
    await page.waitForFunction(() => !document.querySelector("[data-market-startup]"));
    await page.getByLabel("Search features", { exact: true }).fill("Payroll");
    await page.evaluate(() => { window.retainedMarketInput = document.querySelector('input[aria-label="Search features"]'); window.showMarket(false); });
    await page.locator("#outside").click();
    await page.evaluate(() => window.showMarket(true));
    await page.getByLabel("Search features", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Search features", { exact: true }).inputValue(), "Payroll", "missing snapshot before two paint frames must not clear retained React input");
    assert.equal(await page.getByLabel("Search features", { exact: true }).evaluate(input => input === window.retainedMarketInput), true);
    await page.evaluate(() => window.releaseRememberedFrames());
    await page.waitForTimeout(100);
    assert.equal(await page.getByLabel("Search features", { exact: true }).inputValue(), "Payroll");
    await page.goto(`${base}/market`);
    await page.getByLabel("Search features", { exact: true }).fill("Unsent before navigation");
    await page.evaluate(() => { history.pushState({}, "", "/privacy"); window.showMarket(false); window.resolveMarket(); });
    await page.locator("#outside").click();
    await page.evaluate(() => { history.replaceState({}, "", "/market"); window.showMarket(true); });
    await page.getByLabel("Search features", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Search features", { exact: true }).inputValue(), "Unsent before navigation", "a hidden shell replacement restores draft before its first visible paint");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
