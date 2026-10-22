import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

// Real React/Chrome/IndexedDB integration with deliberately held LOCAL fixtures.
// This proves ordering and durable storage, not production auth or latency.
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ServicesCatalogPilot } from "./app/services/services-catalog-pilot";
import { ServicesCatalogCacheLifecycle } from "./components/services-catalog-cache-lifecycle";
import { invalidateServicesCatalog } from "./lib/services-catalog-runtime";
import { SERVICES_CATALOG_DATABASE, SERVICES_CATALOG_STORE } from "./lib/services-catalog-cache";
import { servicesCatalogPilotEnabled } from "./lib/services-catalog-pilot-flag";
window.__catalogDatabase = SERVICES_CATALOG_DATABASE;
window.__catalogStore = SERVICES_CATALOG_STORE;
window.__catalogInvalidate = invalidateServicesCatalog;
window.__catalogFlag = servicesCatalogPilotEnabled;
function Harness() {
  const [config, setConfig] = useState(null);
  window.__catalogMount = setConfig;
  if (!config) return <p>Harness outside services</p>;
  return <>
    <ServicesCatalogCacheLifecycle enabled={config.enabled} viewerId={config.viewerId} accountId={config.accountId} scope={config.scope}/>
    {config.enabled ? <ServicesCatalogPilot key={config.visit} scope={config.scope} serviceId={null}/> : <p>Pilot disabled</p>}
  </>;
}
createRoot(document.getElementById("root")).render(<Harness/>);
`;
const partition = (salon, overrides = {}) => ({ viewerId: "fixture-viewer-one", accountId: "fixture-account-one", salonId: `fixture-salon-${salon}`, scope: `v3:${salon.repeat(64)}`, permissionRevision: "fixture-owner:services.view", ...overrides });
const a = partition("a"), b = partition("b"), other = partition("c", { viewerId: "fixture-viewer-two", accountId: "fixture-account-two" });
const revised = partition("d", { salonId: a.salonId, permissionRevision: "fixture-manager:services.view:v2" });
// Named catalog reads already return the server's narrow six-field projection.
// Server tests separately verify that manager/staff/payment fields cannot enter it.
const dto = label => ({ services: [{ id: "fixture-service", name: label, category: "Nails", description: "Synthetic local fixture", basePrice: 25, durationMinutes: 30 }] });

test("browser catalog pilot: real IndexedDB, admission, A-B-A, restart and withdrawal", { timeout: 120_000 }, async t => {
  const built = await build({ stdin: { contents: source, resolveDir: process.cwd(), sourcefile: "services-catalog-browser-harness.tsx", loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", target: "chrome120", define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent" });
  const styles = await postcss([tailwindcss({ base: process.cwd() })]).process(await readFile("app/globals.css", "utf8") + "\n" + await readFile("app/services/services.css", "utf8"), { from: path.resolve("app/globals.css"), map: false });
  const events = new EventEmitter(), requests = [], behavior = new Map(), pending = new Set(), scenarios = [], timings = [];
  const errors = [], externalRequests = [], screenshots = [];
  let context, page, visit = 0;
  const profile = await mkdtemp(path.join(tmpdir(), "reylumi-services-catalog-browser-"));
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/bundle.js") { response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" }); response.end(built.outputFiles[0].contents); return; }
    if (url.pathname === "/style.css") { response.writeHead(200, { "Content-Type": "text/css", "Cache-Control": "no-store" }); response.end(styles.css); return; }
    if (url.pathname === "/") { response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end('<!doctype html><html><head><meta charset="utf-8"><title>Local catalog test</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); return; }
    if (url.pathname !== "/api/app-local/read") { response.writeHead(404); response.end(); return; }
    assert.equal(request.method, "GET", "The pilot must issue no writes");
    const name = url.searchParams.get("name");
    assert.ok(["page.services-catalog-admission", "page.services-catalog"].includes(name), "Only narrow catalog named reads are allowed");
    assert.equal(url.searchParams.get("args"), "{}");
    const scope = url.searchParams.get("scope"), kind = name === "page.services-catalog-admission" ? "admission" : "fresh";
    const settings = { ...behavior.get(scope) };
    let released = false;
    const item = { kind, name, scope, release() {
      if (released) return; released = true; pending.delete(item);
      if (kind === "fresh" && settings.networkFailure) { response.destroy(); return; }
      const status = (kind === "admission" ? settings.admissionStatus : settings.freshStatus) ?? 200;
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(status !== 200 ? { error: "Synthetic refusal" } : { schemaVersion: 1, status: 200, scope, updatedAt: Date.now(), etag: '"fixture"', data: kind === "admission" ? { schemaVersion: 1, partition: settings.partition } : dto(settings.label) }));
    } };
    requests.push(item); pending.add(item); events.emit("request");
    if (kind === "admission" ? !settings.holdAdmission : !settings.holdFresh) item.release();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const nextRequest = (kind, scope, after) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { events.off("request", check); reject(new Error(`Missing ${kind} request for ${scope}`)); }, 8_000);
    function check() { const value = requests.slice(after).find(item => item.kind === kind && item.scope === scope); if (value) { clearTimeout(timer); events.off("request", check); resolve(value); } }
    events.on("request", check); check();
  });
  async function launch() {
    context = await chromium.launchPersistentContext(profile, { executablePath: process.env.SERVICES_CATALOG_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, viewport: { width: 1100, height: 800 }, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
    await context.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); externalRequests.push(route.request().url()); return route.abort(); });
    page = context.pages()[0] ?? await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin); await page.waitForFunction(() => typeof window.__catalogMount === "function");
  }
  async function mount(part, options = {}) {
    const after = requests.length;
    behavior.set(part.scope, { partition: part, label: options.label ?? "Fresh catalog", holdFresh: true, ...options });
    await page.evaluate(config => { performance.clearMeasures(); window.__catalogMount(config); }, { ...part, enabled: true, visit: ++visit });
    const admission = await nextRequest("admission", part.scope, after);
    return { admission, fresh: () => nextRequest("fresh", part.scope, after), after };
  }
  async function rows() {
    return page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open(window.__catalogDatabase, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(window.__catalogStore, { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction(window.__catalogStore), get = tx.objectStore(window.__catalogStore).getAll(); get.onsuccess = () => { resolve(get.result); db.close(); }; get.onerror = () => { reject(get.error); db.close(); }; };
    }));
  }
  async function waitRows(predicate, message) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) { const value = await rows(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.fail(message);
  }
  const catalogRows = values => values.filter(value => value.id.startsWith("catalog:"));
  async function fresh(item, label) { (await item.fresh()).release(); await page.getByRole("heading", { name: label, exact: true }).waitFor(); await page.getByRole("status").filter({ hasText: "Service catalog" }).waitFor(); await waitRows(values => catalogRows(values).some(value => value.data.services[0].name === label), "Fresh data was not persisted"); }
  async function capture(label, item, part, expectedLabel, { expectFresh = true } = {}) {
    const measurements = await page.evaluate(() => performance.getEntriesByType("measure").filter(value => value.name.startsWith("reylumi:services-pilot:")).map(value => ({ name: value.name, durationMs: value.duration, run: value.detail?.run })));
    const renders = measurements.filter(value => /:(cache|fresh)-render$/.test(value.name));
    const ready = measurements.find(value => value.name.endsWith(":fresh-data-ready"));
    const visibleServiceNames = await page.locator("li h2").allTextContents();
    const scenarioRequests = requests.slice(item.after);
    assert.deepEqual(visibleServiceNames, expectedLabel ? [expectedLabel] : [], `${label}: no other account, salon or permission revision may render`);
    assert.ok(scenarioRequests.every(value => value.scope === part.scope), `${label}: requests must stay in the selected scope`);
    if (expectedLabel) assert.ok(renders.length > 0 && renders.every(value => Number.isFinite(value.durationMs) && value.durationMs >= 0), `${label}: first data render must be measured`);
    if (expectFresh) assert.ok(ready && Number.isFinite(ready.durationMs), `${label}: fresh readiness must be measured separately`);
    timings.push({ scenario: label, firstDataMs: renders.length ? Math.min(...renders.map(value => value.durationMs)) : null,
      firstDataSource: renders.length ? renders.reduce((first, next) => next.durationMs < first.durationMs ? next : first).name.split(":").at(-1) : null,
      freshDataReadyMs: ready?.durationMs ?? null, requestCounts: { admission: scenarioRequests.filter(value => value.kind === "admission").length, fresh: scenarioRequests.filter(value => value.kind === "fresh").length },
      leakageAssertion: { result: "PASS", expectedPartition: part, visibleServiceNames, allRequestScopesMatch: true }, measurements });
  }
  async function screenshot(filename) { const target = path.resolve("artifacts", filename); await mkdir(path.dirname(target), { recursive: true }); await page.screenshot({ path: target, fullPage: true }); screenshots.push({ path: target, source: "Actual ServicesCatalogPilot with current app/services CSS and compiled global Tailwind; local synthetic data; no Next shell" }); }
  async function cached(label) { await page.getByRole("heading", { name: label, exact: true }).waitFor(); await page.getByRole("status").filter({ hasText: "Updating services" }).waitFor(); }
  const absent = async label => assert.equal(await page.getByRole("heading", { name: label, exact: true }).count(), 0);
  t.after(async () => {
    for (const item of pending) item.release();
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(profile), allowed = path.resolve(tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(allowed) && path.basename(resolved).startsWith("reylumi-services-catalog-browser-"));
    await rm(resolved, { recursive: true, force: true });
  });
  await launch();

  await t.test("cold named-read fetch and narrow persisted catalog", async () => {
    const item = await mount(a, { holdAdmission: true, label: "Salon A first" });
    assert.equal(await page.locator("li").count(), 0); assert.equal(requests.slice(item.after).some(value => value.kind === "fresh"), false);
    item.admission.release(); await item.fresh(); assert.equal(await page.locator("li").count(), 0);
    await fresh(item, "Salon A first");
    const saved = catalogRows(await rows()); assert.equal(saved.length, 1);
    assert.deepEqual(Object.keys(saved[0].data.services[0]).sort(), ["id", "name", "category", "description", "basePrice", "durationMinutes"].sort());
    assert.doesNotMatch(JSON.stringify(saved), /never-persist|canManage|payroll|payment/);
    await capture("cold-first-fetch", item, a, "Salon A first"); scenarios.push("cold-first-fetch");
  });
  await t.test("warm return renders cache after admission and separately finishes fresh data", async () => {
    const item = await mount(a, { holdAdmission: true, label: "Salon A updated" });
    await absent("Salon A first"); item.admission.release(); await item.fresh(); await cached("Salon A first");
    await screenshot("services-catalog-cache-preview.png");
    await fresh(item, "Salon A updated"); await capture("warm-return", item, a, "Salon A updated");
    await screenshot("services-catalog-fresh-preview.png");
    const measures = timings.at(-1).measurements; assert.ok(measures.some(value => value.name.endsWith(":cache-render"))); assert.ok(measures.some(value => value.name.endsWith(":fresh-data-ready")));
    scenarios.push("warm-return");
  });
  await t.test("same-account salon A-B-A partitions survive context return", async () => {
    const toB = await mount(b, { label: "Salon B" }); await toB.fresh(); await absent("Salon A updated"); await fresh(toB, "Salon B");
    await capture("salon-switch-A-to-B", toB, b, "Salon B");
    const backA = await mount(a, { label: "Salon A after return" }); await backA.fresh(); await cached("Salon A updated"); await absent("Salon B"); await fresh(backA, "Salon A after return");
    assert.deepEqual(catalogRows(await rows()).map(value => value.partition.salonId).sort(), [a.salonId, b.salonId].sort()); await capture("A-B-A", backA, a, "Salon A after return"); scenarios.push("A-B-A");
  });
  await t.test("full Chrome restart preserves rows but requires new admission", async () => {
    await context.close(); context = undefined; await launch();
    const item = await mount(a, { holdAdmission: true, label: "Salon A after restart" }); await absent("Salon A after return");
    item.admission.release(); await item.fresh(); await cached("Salon A after return"); await fresh(item, "Salon A after restart");
    await capture("browser-process-restart", item, a, "Salon A after restart"); scenarios.push("browser-process-restart");
  });
  await t.test("logout purges before a different account signs in", async () => {
    await page.evaluate(() => { window.__catalogInvalidate("logout"); window.__catalogMount(null); });
    await waitRows(values => values.length === 0, "Logout retained rows");
    const item = await mount(other, { label: "Different account catalog" }); await item.fresh(); await absent("Salon A after restart"); await fresh(item, "Different account catalog");
    const saved = await rows(); assert.equal(catalogRows(saved).length, 1); assert.ok(saved.every(value => value.id === "account" ? value.accountId === other.accountId : value.partition.accountId === other.accountId)); scenarios.push("logout-different-account");
    await capture("logout-different-account", item, other, "Different account catalog");
  });
  await t.test("account change without logout purges and permission change cannot reuse old data", async () => {
    const first = await mount(a, { label: "Before permission change" }); await fresh(first, "Before permission change");
    assert.equal(catalogRows(await rows()).length, 1);
    await capture("account-change-without-logout", first, a, "Before permission change");
    const changed = await mount(revised, { label: "After permission change" }); await changed.fresh(); await absent("Before permission change"); await fresh(changed, "After permission change");
    assert.deepEqual(catalogRows(await rows()).map(value => value.partition.scope), [revised.scope]); await capture("account-change-permission-revision", changed, revised, "After permission change"); scenarios.push("account-change-permission-revision");
  });
  await t.test("403 admission hides cached data and purges", async () => {
    const denied = await mount(revised, { holdAdmission: true, admissionStatus: 403 }); await absent("After permission change"); denied.admission.release();
    await page.getByRole("alert").waitFor(); await waitRows(values => catalogRows(values).length === 0, "Revocation retained catalog");
    assert.equal(requests.slice(denied.after).some(value => value.kind === "fresh"), false); await capture("permission-revoked-403", denied, revised, null, { expectFresh: false }); scenarios.push("permission-revoked-403");
  });
  await t.test("network loss retains an admitted unexpired catalog with stale status", async () => {
    const seed = await mount(a, { label: "Before network loss" }); await fresh(seed, "Before network loss");
    const failure = await mount(a, { networkFailure: true }); await failure.fresh(); await cached("Before network loss");
    (await failure.fresh()).release(); await page.getByRole("status").filter({ hasText: "Showing previously loaded details" }).waitFor();
    await page.getByRole("heading", { name: "Before network loss", exact: true }).waitFor(); assert.equal(catalogRows(await rows()).length, 1);
    assert.equal(requests.slice(failure.after).filter(value => value.kind === "admission").length, 1); scenarios.push("network-retains-valid-admission");
  });
  await t.test("ambiguous 503 requires matching re-admission before stale retention", async () => {
    const failure = await mount(a, { freshStatus: 503 }); await failure.fresh(); await cached("Before network loss");
    const after = requests.length;
    behavior.set(a.scope, { partition: Object.fromEntries(Object.entries(a).reverse()), holdAdmission: true });
    (await failure.fresh()).release(); const readmission = await nextRequest("admission", a.scope, after);
    assert.equal(await page.locator("li").count(), 0, "Ambiguous authority must hide while re-admission is pending");
    readmission.release(); await page.getByRole("status").filter({ hasText: "Showing previously loaded details" }).waitFor();
    assert.equal(requests.slice(failure.after).filter(value => value.kind === "admission").length, 2); assert.equal(catalogRows(await rows()).length, 1);
    scenarios.push("503-matching-readmission-retains");
  });
  await t.test("503 followed by denied re-admission withdraws and removes scope", async () => {
    const failure = await mount(a, { freshStatus: 503 }); await failure.fresh(); await cached("Before network loss");
    behavior.set(a.scope, { partition: a, admissionStatus: 403 }); (await failure.fresh()).release();
    await page.getByRole("alert").waitFor(); assert.equal(await page.locator("li").count(), 0); await waitRows(values => catalogRows(values).length === 0, "Known denied scope remained cached");
    scenarios.push("503-denied-readmission-withdraws");
  });
  await t.test("uncertain re-admission hides while preserving durable data", async () => {
    const seed = await mount(a, { label: "Before uncertain admission" }); await fresh(seed, "Before uncertain admission");
    const failure = await mount(a, { freshStatus: 503 }); await failure.fresh(); await cached("Before uncertain admission");
    behavior.set(a.scope, { partition: a, admissionStatus: 503 }); (await failure.fresh()).release();
    await page.getByRole("alert").waitFor(); assert.equal(await page.locator("li").count(), 0); assert.equal(catalogRows(await rows()).length, 1);
    const deniedAtEntry = await mount(a, { admissionStatus: 503 }); await page.getByRole("alert").waitFor();
    assert.equal(requests.slice(deniedAtEntry.after).some(value => value.kind === "fresh"), false); assert.equal(await page.locator("li").count(), 0); assert.equal(catalogRows(await rows()).length, 1);
    scenarios.push("uncertain-readmission-hides-preserves", "uncertain-entry-no-display");
  });
  await t.test("corrupt or expanded stored DTO is discarded and fresh fetch recovers", async () => {
    const seed = await mount(a, { label: "Before corruption" }); await fresh(seed, "Before corruption");
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open(window.__catalogDatabase, 1); request.onerror = () => reject(request.error);
      request.onsuccess = () => { const db = request.result, tx = db.transaction(window.__catalogStore, "readwrite"), store = tx.objectStore(window.__catalogStore), get = store.getAll(); get.onsuccess = () => { for (const row of get.result) if (row.id.startsWith("catalog:")) store.put({ ...row, data: { ...row.data, credentials: "forbidden-fixture-field" } }); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    }));
    const item = await mount(a, { label: "Recovered from corrupt cache" }); await item.fresh(); await absent("Before corruption");
    await waitRows(values => catalogRows(values).length === 0, "Corrupt row was not removed"); await fresh(item, "Recovered from corrupt cache"); await capture("corrupt-cache-recovery", item, a, "Recovered from corrupt cache"); scenarios.push("corrupt-cache-recovery");
  });
  await t.test("browser storage eviction is a safe miss followed by fresh authorization and fetch", async () => {
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(window.__catalogDatabase);
      request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Catalog connection did not release the evicted database"));
    }));
    const item = await mount(a, { holdAdmission: true, label: "Recovered after browser eviction" });
    await absent("Recovered from corrupt cache"); assert.equal(await page.locator("li").count(), 0);
    item.admission.release(); await item.fresh(); assert.equal(await page.locator("li").count(), 0);
    assert.equal(catalogRows(await rows()).length, 0, "Evicted catalog must be a miss");
    await fresh(item, "Recovered after browser eviction"); await capture("storage-eviction-refetch", item, a, "Recovered after browser eviction");
    assert.equal(timings.at(-1).measurements.some(value => value.name.endsWith(":cache-render")), false, "Eviction must not render a memory or disk catalog");
    scenarios.push("storage-eviction-refetch");
  });
  await t.test("flag off cleans pilot storage and production override remains disabled", async () => {
    const after = requests.length;
    await page.evaluate(config => window.__catalogMount(config), { ...a, enabled: false, visit: ++visit }); await page.getByText("Pilot disabled", { exact: true }).waitFor();
    await waitRows(values => values.length === 0, "Disabled pilot retained storage"); assert.equal(requests.length, after);
    assert.deepEqual(await page.evaluate(() => [window.__catalogFlag({}), window.__catalogFlag({ NODE_ENV: "production", REYLUMI_SERVICES_CACHE_PILOT: "1" }), window.__catalogFlag({ NODE_ENV: "development", VERCEL_ENV: "production", REYLUMI_SERVICES_CACHE_PILOT: "1" }), window.__catalogFlag({ NODE_ENV: "development", REYLUMI_SERVICES_CACHE_PILOT: "1" })]), [false, false, false, true]); scenarios.push("flag-off-cleanup");
  });
  await t.test("storage unavailable still renders freshly authorized network data", async () => {
    await page.addInitScript(() => Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined }));
    await page.reload(); await page.waitForFunction(() => typeof window.__catalogMount === "function");
    const item = await mount(a, { label: "Live with unavailable storage" }); (await item.fresh()).release();
    await page.getByRole("heading", { name: "Live with unavailable storage", exact: true }).waitFor(); await page.getByRole("status").filter({ hasText: "Service catalog" }).waitFor();
    assert.equal(await page.evaluate(() => typeof indexedDB), "undefined"); await capture("storage-unavailable", item, a, "Live with unavailable storage"); scenarios.push("storage-unavailable");
  });
  assert.deepEqual(errors, [], "Unexpected browser errors"); assert.deepEqual(externalRequests, [], "Only local fixture traffic is allowed");
  const evidence = { at: new Date().toISOString(), status: scenarios.length === 16 ? "PASS" : "FAIL", environment: "Headless Chrome with actual React components, webHost named-read transport and IndexedDB; local synthetic HTTP fixture only", browser: context.browser().version(), scenarios, scenarioResults: Object.fromEntries(timings.map(value => [value.scenario, value])), timings, screenshots, requests: requests.map(({ kind, name, scope }) => ({ kind, name, scope })), errors, externalRequests, limitations: ["No real server identity, Supabase/RLS, or production network exercised.", "First data is the component render effect from refresh start; fresh readiness is recorded separately. Held local fixtures determine these timings; no physical-device or production latency claim.", "WKWebView/native restart, real login, physical iPhone WiFi and app-level slow-network checks are separate gates not tested by this harness."] };
  const evidenceFile = path.resolve(process.env.SERVICES_CATALOG_BROWSER_EVIDENCE ?? "artifacts/services-catalog-browser-evidence.json");
  await mkdir(path.dirname(evidenceFile), { recursive: true }); await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
  t.diagnostic(`Browser fixture evidence: ${evidenceFile}`);
  assert.equal(evidence.status, "PASS", "One or more browser scenarios failed");
});
