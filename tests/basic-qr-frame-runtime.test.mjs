import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const language = `export const WorkspaceText=({text})=>text;`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("Personal QR streams only neutral chrome before the unchanged user and capability reads", async () => {
  const bundle = await build({ entryPoints: ["app/(app)/qr/page.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    plugins: [{ name: "qr-server-transport", setup(b) {
      b.onResolve({ filter: /^(server-only|next\/server|next\/navigation)$|users\/current-user$|qr\/actions$|personal-qr-client$|experience-page-boundary$|workspace-language$|\.module\.css$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: p }) => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        p === "server-only" ? "" : p === "next/server" ? `export async function connection(){}`
        : p.endsWith(".css") ? `export default {}`
        : p === "next/navigation" ? `export function redirect(url){throw Error('REDIRECT:'+url)}`
        : p.endsWith("users/current-user") ? `export function getCurrentKingUser(){globalThis.__qr.users++;return globalThis.__qr.user}`
        : p.endsWith("qr/actions") ? `export function loadPersonalQr(id){globalThis.__qr.reads.push(id);return globalThis.__qr.workspace} export async function loadPersonalQrCatalog(id,entry){globalThis.__qr.catalogs.push({id,entry});return {catalog:{entry}}}`
        : p.endsWith("personal-qr-client") ? `export function PersonalQrClient(){return null}`
        : p.endsWith("experience-page-boundary") ? `export function ExperiencePageBoundary(){return null}` : language }));
    } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  const Page = module.exports.default;
  const user = deferred(), workspace = deferred();
  globalThis.__qr = { users: 0, reads: [], catalogs: [], user: user.promise, workspace: workspace.promise };
  try {
    const props = { searchParams: Promise.resolve({ entry: "entry1", visit: "visit1", scan: "1" }) };
    const boundary = await Page(props), shell = boundary.props.children;
    assert.equal(shell.type, Suspense);
    assert.equal(globalThis.__qr.users, 0);
    for (const fallback of [shell.props.fallback, boundary.props.pendingFallback]) {
      const html = renderToStaticMarkup(fallback);
      assert.match(html, /My QR/); assert.match(html, /Scan salon QR/); assert.match(html, /disabled/);
      assert.doesNotMatch(html, /entry1|visit1|<video|<canvas|reylumi:personal|data-viewer/);
    }
    const protectedContent = shell.props.children.type(shell.props.children.props);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(globalThis.__qr.reads, []);
    user.resolve({ id: "viewer-a", display_name: "Synthetic viewer" });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(globalThis.__qr.reads, ["viewer-a"]);
    assert.deepEqual(globalThis.__qr.catalogs, [{ id: "viewer-a", entry: "entry1" }]);
    const data = { userId: "viewer-a", code: "fresh-private-code" };
    workspace.resolve({ data });
    const client = await protectedContent;
    assert.equal(client.props.initial, data);
    assert.equal(client.props.initialVisitId, "visit1"); assert.equal(client.props.initialScan, true);
    assert.equal(client.key, "viewer-a:entry1:visit1:true");
    globalThis.__qr = { users: 0, reads: [], catalogs: [], user: Promise.resolve(null) };
    const guest = (await Page(props)).props.children.props.children;
    await assert.rejects(guest.type(guest.props), /REDIRECT:\/login\?next=.*entry1.*visit1/);
    assert.deepEqual(globalThis.__qr.reads, []); assert.deepEqual(globalThis.__qr.catalogs, []);
  } finally { delete globalThis.__qr; }
});

test("Neutral QR/Scan pending frames preserve private reset and auth gates; Scan owns its data refresh", { timeout: 60000 }, async () => {
  const output = path.resolve("artifacts/basic-qr-frame-runtime");
  await fs.mkdir(output, { recursive: true });
  const bundle = await build({ bundle: true, write: false, outdir: output, format: "iife", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{Activity}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
      import{ExperiencePageBoundary}from'./components/experience-page-boundary';
      import{PersonalQrLoading}from'./app/qr/personal-qr-loading';import{StaffScanLoading}from'./app/staff/scan/staff-scan-loading';
      const qa=window.qa={visible:true,revision:'render1',scopeId:'viewer-a',checked:Date.now(),validationRevision:1,refreshes:0,validations:0,value:'old-private-code'};
      qa.router={refresh(){qa.refreshes++}};qa.checkedAt=()=>qa.checked;qa.getValidationRevision=()=>qa.validationRevision;
      qa.validate=()=>{qa.validations++;return new Promise(resolve=>qa.resolveValidation=resolve)};
      qa.scope=()=>({context:{scope:qa.scopeId,authenticated:true},validationRevision:qa.validationRevision,validate:qa.validate,checkedAt:qa.checkedAt,getValidationRevision:qa.getValidationRevision});
      const root=createRoot(document.getElementById('root'));function Private(){return <p data-private>{qa.value}</p>}
      function App(){return <Activity mode={qa.visible?'visible':'hidden'}><ExperiencePageBoundary renderRevision={qa.revision} pendingFallback={location.pathname==='/qr'?<PersonalQrLoading/>:<StaffScanLoading/>}><Private/></ExperiencePageBoundary></Activity>}
      qa.render=()=>flushSync(()=>root.render(<App/>));qa.hide=()=>{qa.visible=false;qa.render()};qa.show=()=>{qa.visible=true;qa.render()};
      qa.ack=()=>{qa.value='fresh-private-code';qa.revision+='-ack';qa.render()};
      qa.resolve=answer=>{if(answer){qa.checked=Date.now();qa.validationRevision++;qa.render()}qa.resolveValidation(answer)};
      qa.render();qa.ready=true;
    ` }, plugins: [{ name: "qr-browser-transport", setup(b) {
      b.onResolve({ filter: /^next\/navigation$|experience-scope$|loading-feedback$|workspace-language$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path: p }) => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        p === "next/navigation" ? `export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useRouter=()=>window.qa.router;`
        : p.endsWith("experience-scope") ? `export const useExperienceScope=()=>window.qa.scope();`
        : p.endsWith("loading-feedback") ? `export const PageLoadingSkeleton=()=> <p data-global-loading>Loading whole page</p>;` : language }));
    } }] });
  const js = bundle.outputFiles.find(f => f.path.endsWith(".js")).text, css = bundle.outputFiles.find(f => f.path.endsWith(".css"))?.text ?? "";
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : req.url === "/fixture.css" ? "text/css" : "text/html; charset=utf-8");
    res.end(req.url === "/fixture.js" ? js : req.url === "/fixture.css" ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(5000); page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + "/qr"); await page.locator("[data-private]").waitFor();
    await page.evaluate(() => { qa.hide(); qa.show(); });
    await page.locator("[data-personal-qr-pending]").waitFor();
    assert.equal(await page.locator("[data-private]").isVisible(), false);
    assert.equal(await page.locator("[data-global-loading]").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Scan salon QR" }).isDisabled(), true);
    assert.equal(await page.evaluate(() => qa.refreshes), 1);
    await page.screenshot({ path: path.join(output, "qr-reset-safe-frame.png") });
    await page.evaluate(() => qa.ack());
    await page.getByText("fresh-private-code", { exact: true }).waitFor();
    assert.equal(await page.getByText("old-private-code", { exact: true }).count(), 0);
    await page.goto(origin + "/staff/scan"); await page.locator("[data-private]").waitFor();
    await page.evaluate(() => { qa.checked = Date.now() - 31000; qa.hide(); qa.show(); });
    await page.locator("[data-staff-scan][aria-busy=true]").waitFor();
    assert.equal(await page.locator("[data-private]").isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "Scan QR", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => qa.refreshes), 0);
    await page.evaluate(() => qa.resolve(true)); await page.locator("[data-private]").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => qa.refreshes), 0, "Scan's existing client owns reveal reads");
    await page.evaluate(() => { qa.checked = Date.now() - 31000; qa.hide(); qa.show(); });
    await page.locator("[data-staff-scan][aria-busy=true]").waitFor(); await page.evaluate(() => qa.resolve(false));
    assert.equal(await page.locator("[data-private]").isVisible(), false, "denied validation must not reveal the retained private pane");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ evidence: "Actual boundary and pending-frame components; synthetic authority and router transports, not native/device acceptance", checks: ["QR retains fresh reset and hides private code", "disabled camera in safe fallback", "Scan auth validation and denial remain gated", "Scan reveal has zero duplicate RSC refresh"], errors }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
