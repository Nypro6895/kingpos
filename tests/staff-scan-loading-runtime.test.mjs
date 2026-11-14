import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const workspace = { enabled: true, staffId: "staff1", current: [], waiting: [], services: [] };
const language = `export const WorkspaceText=({text})=>text; export const useWorkspaceTranslation=()=>text=>text;`;

test("Scan leaf returns its public frame before identity/data; original authority still precedes the client", async () => {
  const bundle = await build({ bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
    entryPoints: ["app/(app)/staff/scan/page.tsx"], plugins: [{ name: "server-boundaries", setup(b) {
      b.onResolve({ filter: /^(server-only|next\/server|next\/navigation)$|staff-portal-identity$|staff\/scan\/actions$|staff-scan-client$|staff\/my-work\/staff-my-work-view$|experience-page-boundary$|workspace-language$|\.module\.css$/ }, args => ({ path: args.path, namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents:
        path === "server-only" ? "" : path === "next/server" ? `export async function connection(){}`
        : path.endsWith(".css") ? `export default {page:'page',scanButton:'scanButton',muted:'muted'}`
        : path === "next/navigation" ? `export function redirect(path){throw Error('REDIRECT:'+path)}`
        : path.endsWith("staff-portal-identity") ? `export function getStaffPortalIdentity(){globalThis.__scanPage.identities++;return globalThis.__scanPage.identity}`
        : path.endsWith("scan/actions") ? `export function loadStaffScan(scope){globalThis.__scanPage.reads.push(scope);return globalThis.__scanPage.read}`
        : path.endsWith("staff-scan-client") ? `export function StaffScanClient(){return null}`
        : path.endsWith("staff-my-work-view") ? `export function StaffPortalLoadError(){return null}`
        : path.endsWith("experience-page-boundary") ? `export function ExperiencePageBoundary({children}){return children}` : language }));
    } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  const Page = module.exports.default;
  const identity = deferred(), read = deferred();
  globalThis.__scanPage = { identities: 0, reads: [], identity: identity.promise, read: read.promise };
  try {
    const boundary = await Page();
    assert.equal(globalThis.__scanPage.identities, 0, "leaf shell is returned before protected work starts");
    const shell = boundary.props.children;
    assert.equal(shell.type, Suspense);
    for (const fallback of [shell.props.fallback, boundary.props.pendingFallback]) {
      const html = renderToStaticMarkup(fallback);
      assert.match(html, /data-scan-title/);
      assert.match(html, /Scan QR/);
      assert.match(html, /disabled/);
      assert.doesNotMatch(html, /Your current work|Waiting customers|<video/);
    }
    const content = shell.props.children.type();
    assert.equal(globalThis.__scanPage.identities, 1);
    assert.deepEqual(globalThis.__scanPage.reads, []);
    identity.resolve({ context: { user: { id: "viewer1" }, currentSalon: { id: "salon1" } }, staff: { id: "staff1" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(globalThis.__scanPage.reads, [{ salonId: "salon1", staffId: "staff1" }]);
    let ready = false;
    void content.then(() => { ready = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ready, false, "protected client waits for the original scoped read");
    read.resolve({ data: workspace });
    const client = await content;
    assert.equal(client.props.initial, workspace);
    assert.ok(Math.abs(Date.now() - client.props.initialReadAt) < 1000);
    assert.equal(client.key, "salon1:staff1");

    globalThis.__scanPage = { identities: 0, reads: [], identity: Promise.resolve({ context: { user: null } }) };
    const guest = (await Page()).props.children.props.children;
    await assert.rejects(guest.type(), /REDIRECT:\/login/);
    assert.deepEqual(globalThis.__scanPage.reads, []);
    globalThis.__scanPage = { identities: 0, reads: [], identity: Promise.resolve({ context: { user: { id: "viewer1" }, currentSalon: { id: "salon1" } }, staff: null }) };
    const unavailable = (await Page()).props.children.props.children;
    assert.equal((await unavailable.type()).props.label, "Staff Scan");
    assert.deepEqual(globalThis.__scanPage.reads, []);
  } finally { delete globalThis.__scanPage; }
});

test("Scan reuses the server seed once, keeps live reconciliation, and blocks late/reset camera access", { timeout: 60000 }, async () => {
  const bundle = await build({ bundle: true, write: false, outdir: "fixture", format: "iife", jsx: "automatic", stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{Activity} from 'react';import{createRoot}from'react-dom/client';
    import{StaffScanClient}from'./app/staff/scan/staff-scan-client';
    import{StaffScanLoading}from'./app/staff/scan/staff-scan-loading';
    window.h={reads:[],pending:[],connects:0,camera:0,hold:false,workspace:${JSON.stringify(workspace)}};
    const draft={lines:[],revision:1,at:Date.now()};
    localStorage.setItem('reylumi:staff-scan:salon1:staff1:settled',JSON.stringify(draft));
    localStorage.setItem('reylumi:staff-scan:other:staff1:keep',JSON.stringify(draft));
    const root=createRoot(document.getElementById('root'));
    let seed=window.h.workspace,readAt=Date.now(),key=0,visible=true;
    const paint=()=>root.render(<><header>Shared shell fixture</header><Activity mode={visible?'visible':'hidden'}><StaffScanClient key={key} salonId="salon1" staffId="staff1" initial={seed} initialReadAt={readAt}/></Activity></>);
    window.show=value=>{visible=value;paint()};window.mount=(value,age=0)=>{seed=value;readAt=age===null?undefined:Date.now()-age;key++;visible=true;paint()};
    window.pendingFrame=()=>root.render(<StaffScanLoading/>);
    window.resolveRead=data=>window.h.pending.shift()?.({data});
    window.publish=()=>window.listener?.({resource:'tickets'});
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.h.camera++;throw Error('denied')}}});
    paint();
  ` }, plugins: [{ name: "browser-boundaries", setup(b) {
    b.onResolve({ filter: /^\.\/actions$|staff\/scan\/actions$/ }, () => ({ path: "actions", namespace: "fixture" }));
    b.onResolve({ filter: /pos-workspace-sync$|workspace-language$|^next\/link$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents: path.endsWith("workspace-language") ? language
      : path === "next/link" ? `import React from'react';export default function Link({href,children}){return <a href={href}>{children}</a>}`
      : path.endsWith("pos-workspace-sync") ? `export function subscribePosChanges(id,callback){window.listener=callback;return()=>{window.listener=null}};`
      : `export async function loadStaffScan(scope){window.h.reads.push(scope);if(window.h.hold)return await new Promise(resolve=>window.h.pending.push(resolve));return {data:structuredClone(window.h.workspace)}}
         export async function connectStaffScan(){window.h.connects++;return {error:'not used'}}
         export async function saveStaffScan(){throw Error('Unexpected write')}
         export async function cancelStaffScan(){throw Error('Unexpected write')}` }));
  } }] });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const server = createServer((request, response) => { response.setHeader("Content-Type", "text/html"); response.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:15px Arial}${css}</style><div id="root"></div><script>${js}</script></html>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Scan QR", exact: true }).waitFor();
    await page.waitForFunction(() => localStorage.getItem("reylumi:staff-scan:salon1:staff1:settled") === null);
    assert.equal(await page.evaluate(() => window.h.reads.length), 0, "fresh server seed does not immediately reread the full workspace");
    assert.ok(await page.evaluate(() => localStorage.getItem("reylumi:staff-scan:other:staff1:keep")), "seed reconciliation stays within its salon/staff");
    assert.equal(await page.getByRole("button", { name: "Scan QR", exact: true }).isDisabled(), false);
    fs.mkdirSync("artifacts/basic-page-loading-20261113/staff-scan", { recursive: true });
    await page.screenshot({ path: "artifacts/basic-page-loading-20261113/staff-scan/accepted-seed-390.png" });
    await page.evaluate(() => window.show(false));await page.waitForFunction(() => !window.listener);
    await page.evaluate(() => window.show(true));await page.waitForFunction(() => window.h.reads.length === 1);
    await page.evaluate(() => window.publish());await page.waitForFunction(() => window.h.reads.length === 2);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));await page.waitForFunction(() => window.h.reads.length === 3);
    await page.evaluate(() => window.mount(window.h.workspace, 16_000));await page.waitForFunction(() => window.h.reads.length === 4);
    await page.evaluate(() => window.mount(window.h.workspace, -60_000));await page.waitForFunction(() => window.h.reads.length === 5);
    await page.evaluate(() => window.mount(window.h.workspace, null));await page.waitForFunction(() => window.h.reads.length === 6);

    await page.evaluate(() => { window.h.hold = true;window.publish(); });await page.waitForFunction(() => window.h.pending.length === 1);
    await page.evaluate(() => window.show(false));await page.waitForFunction(() => !window.listener);
    await page.evaluate(() => window.show(true));await page.waitForFunction(() => window.h.pending.length === 2, undefined, { timeout: 1500 });
    await page.evaluate(() => window.resolveRead({ ...window.h.workspace, waiting: [{ visitId: "hidden-late", customerName: "Hidden late row", queueNumber: 1, requestedServices: [] }] }));
    assert.equal(await page.getByText("Hidden late row", { exact: false }).count(), 0);
    await page.evaluate(() => window.resolveRead(window.h.workspace));

    await page.evaluate(() => { window.h.hold = true;window.mount(null); });
    await page.waitForFunction(() => window.h.pending.length === 1);
    assert.equal(await page.getByRole("heading", { name: "Scan", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Scan QR", exact: true }).isDisabled(), true);
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(await page.evaluate(() => window.h.camera), 0);
    await page.evaluate(() => window.resolveRead(window.h.workspace));
    await page.waitForFunction(() => !document.querySelector('button[class*="scanButton"]').disabled);
    await page.getByRole("button", { name: "Scan QR", exact: true }).click();
    await page.getByText("Allow camera access, or select a customer from Waiting.", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.h.camera), 1);
    await page.getByRole("button", { name: "Close camera", exact: true }).click();
    await page.evaluate(() => window.publish());await page.waitForFunction(() => window.h.pending.length === 1);
    await page.evaluate(() => window.dispatchEvent(new Event("reylumi:experience-reset")));
    await page.evaluate(() => window.resolveRead({ ...window.h.workspace, waiting: [{ visitId: "late", customerName: "Private late row", queueNumber: 1, requestedServices: [] }] }));
    await page.waitForFunction(() => document.querySelector('button[class*="scanButton"]').disabled);
    assert.equal(await page.getByText("Private late row", { exact: false }).count(), 0);
    assert.equal(await page.locator("video").count(), 0);
    assert.equal(await page.evaluate(() => window.h.connects), 0);

    await page.evaluate(() => window.pendingFrame());
    assert.equal(await page.getByRole("heading", { name: "Scan", exact: true }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Scan QR", exact: true }).isDisabled(), true);
    assert.equal(await page.locator("main[aria-busy=true]").count(), 1);
    await page.screenshot({ path: "artifacts/basic-page-loading-20261113/staff-scan/pending-frame-390.png" });
    assert.deepEqual(errors, []);
  } finally { await browser?.close();await new Promise(resolve => server.close(resolve)); }
});
