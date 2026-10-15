import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { createServer } from "node:http";
import test from "node:test";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToPipeableStream } from "react-dom/server";
import ts from "typescript";
import { build } from "esbuild";
import { chromium } from "playwright-core";

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}
function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "exports", code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  return exports;
}

test("verified navigation and its language stream before optional campaign wallet and settings, each loaded once", async () => {
  const wallet = deferred(), settings = deferred(), language = deferred();
  let walletCalls = 0, settingsCalls = 0, languageCalls = 0;
  const deadlines = [];
  const context = { workspaceType: "salon", salonMode: "manage", currentMembership: {}, user: { id: "owner" }, currentSalon: { id: "salon", city: "Chicago", country: "US" } };
  const passthrough = ({ children }) => children;
  const nothing = () => null;
  const imports = {
    react: React, "react/jsx-runtime": jsxRuntime, "../layout": { metadata: {} },
    "@/lib/request-business-context": { getRequestBusinessContext: async () => context },
    "@/lib/current-context": { isSalonManageContext: () => true, isOwnerMembership: () => true },
    "@/lib/experience-context": { getExperienceContext: () => ({ scope: "owner-scope", viewerId: "owner", workspaceId: "manage:salon", permissionRevision: "grants" }) },
    "@/lib/bounded-get": { runReadWithDeadline: (read, timeout) => { deadlines.push(timeout); return read; } },
    "@/lib/vietnamese-plugin": { vietnamesePluginState: () => { languageCalls++; return language.promise; } },
    "@/app/campaigns/credit-actions": { campaignWalletAction: () => { walletCalls++; return wallet.promise; } },
    "@/lib/owner-campaigns": { ownerCampaignSettings: () => { settingsCalls++; return settings.promise; } },
    "@/components/campaign-plugin-context": { CampaignPluginProvider: passthrough, CampaignPluginConfiguration: ({ installed, scope }) => React.createElement("span", { "data-campaign-config": String(installed), "data-scope": scope }) },
    "@/components/workspace-language": { WorkspaceLanguageProvider: ({ enabled, children }) => React.createElement("div", { "data-language-ready": enabled ? "vi" : "en" }, children) },
    "@/app/salon-switcher": { SalonSwitcher: ({ children }) => React.createElement("div", { "data-navigation": "ready" }, React.createElement("nav", null, "Salon navigation"), children) },
    "@/components/startup-ready": { StartupReady: () => React.createElement("span", { "data-startup-marker": "ready" }) },
    "@/components/owner-campaign-runtime": { OwnerCampaignRuntime: () => React.createElement("span", { "data-campaign-runtime": "ready" }) },
  };
  for (const [module, symbol] of Object.entries({
    "@/components/abuse-notice": "AbuseNotice", "@/components/overlay-dismissal": "OverlayDismissal", "@/components/windows-pos-download": "WindowsPosDownloadPrompt", "@/app/pos/owner-queue-runtime": "OwnerQueueRuntime", "@/components/quick-booking": "QuickBooking", "@/components/session-expiry-prompt": "SessionExpiryPrompt", "@/components/explore-advertising": "ExploreAdvertising", "@/components/explore-account-actions": "ExploreAccountActionsProvider", "@/components/experience-cache-lifecycle": "ExperienceCacheLifecycle", "@/components/experience-navigation": "ExperienceNavigation", "@/components/experience-scope": "ExperienceScopeProvider",
  })) imports[module] = { [symbol]: ["ExploreAdvertising", "ExploreAccountActionsProvider", "ExperienceScopeProvider"].includes(symbol) ? passthrough : nothing };
  const layout = load("app/(app)/layout.tsx", imports).default;
  let resolved = false;
  const elementPromise = layout({ children: React.createElement("main", null, "Current page") }).then(element => { resolved = true; return element; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resolved, false, "language entitlement is established before rendering, avoiding a language switch");
  assert.equal(walletCalls, 0, "wallet is not part of the layout's initial await chain");
  language.resolve({ active: true, staff_enabled: true, portable_enabled: true });
  const element = await elementPromise;
  let html = "";
  const errors = [];
  const writable = new Writable({ write(chunk, _, complete) { html += chunk.toString(); complete(); } });
  const completed = new Promise(resolve => writable.on("finish", resolve));
  const renderer = renderToPipeableStream(element, { onShellReady() { renderer.pipe(writable); }, onError(error) { errors.push(error); } });
  const until = async predicate => {
    const deadline = Date.now() + 2000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate());
  };
  try {
    await until(() => html.includes('data-navigation="ready"'));
    assert.ok(html.includes('data-language-ready="vi"'));
    assert.ok(html.includes('data-startup-marker="ready"'));
    assert.equal(walletCalls, 1);
    assert.equal(settingsCalls, 0);
    wallet.resolve({ installed: true, available_credits: 50 });
    await until(() => html.includes('data-campaign-config="true"'));
    assert.equal(settingsCalls, 1, "wallet configuration streams while optional runtime settings are still pending");
    settings.resolve({ enabled: true });
    await completed;
    assert.ok(html.includes('data-campaign-runtime="ready"'));
    assert.equal(walletCalls, 1);
    assert.equal(languageCalls, 1);
    assert.deepEqual(deadlines, [8_000, 12_000, 12_000]);
    assert.deepEqual(errors, []);
    const bounded = load("lib/bounded-get.ts", {});
    imports["@/lib/vietnamese-plugin"].vietnamesePluginState = () => new Promise(() => {});
    imports["@/lib/bounded-get"].runReadWithDeadline = read => bounded.runReadWithDeadline(read, 10);
    await assert.rejects(layout({ children: React.createElement("main", null, "Current page") }), bounded.ReadConnectionError, "an initial language timeout propagates to the retry shell instead of rendering an assumed English entitlement");
    assert.equal(walletCalls, 1, "failed initial entitlement never starts a second optional wallet read");
  } finally { renderer.abort(); }
});

test("streamed campaign configuration cannot enable a different account's optional navigation", { timeout: 60_000 }, async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{CampaignPluginProvider,CampaignPluginConfiguration,useCampaignPlugin}from'./components/campaign-plugin-context';
    function Menu(){const installed=useCampaignPlugin();return <nav><a>Today</a>{installed?<a>Campaigns</a>:null}</nav>}
    function App(){const[scope,setScope]=useState('account-a'),[configuration,setConfiguration]=useState(null),[installed,setInstalled]=useState(false);
      window.setScope=setScope;window.setConfiguration=setConfiguration;window.setInstalled=setInstalled;
      return <CampaignPluginProvider key={scope} scope={scope} installed={installed}><Menu/>{configuration?<CampaignPluginConfiguration {...configuration}/>:null}</CampaignPluginProvider>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, outfile: "bundle.js", bundle: true, write: false, jsx: "automatic", format: "iife" });
  const js = result.outputFiles[0].text;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "application/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? js : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, channel: process.env.TEST_BROWSER_PATH ? undefined : "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText("Today", { exact: true }).waitFor();
    assert.equal(await page.getByText("Campaigns", { exact: true }).count(), 0);
    await page.evaluate(() => window.setConfiguration({ scope: "account-a", installed: true }));
    await page.getByText("Campaigns", { exact: true }).waitFor();
    await page.evaluate(() => window.setScope("account-b"));
    await page.waitForFunction(() => !document.querySelector("nav").textContent.includes("Campaigns"));
    await page.evaluate(() => window.setConfiguration({ scope: "account-a", installed: true }));
    assert.equal(await page.getByText("Campaigns", { exact: true }).count(), 0);
    await page.evaluate(() => window.setConfiguration({ scope: "account-b", installed: true }));
    await page.getByText("Campaigns", { exact: true }).waitFor();
    await page.evaluate(() => window.setConfiguration({ scope: "account-b", installed: false }));
    await page.waitForFunction(() => !document.querySelector("nav").textContent.includes("Campaigns"));
    await page.evaluate(() => { window.setConfiguration(null); window.setInstalled(true); });
    await page.getByText("Campaigns", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
