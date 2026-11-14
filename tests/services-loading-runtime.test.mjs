import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { Suspense } from "react";

const require = createRequire(import.meta.url);
const language = `const translate=text=>text;export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>translate;`;
const workspace = { canManage: true, addOnLinks: [], staff: [], services: [{ id: "service1", salon_id: "salon1", name: "Pedicure", category: "Nails", base_price: 45, duration_minutes: 30, description: "Foot care", is_active: true, online_booking_enabled: false, bookingStaffIds: [], addOnServiceIds: [], bookingAddOns: [], readiness: { bookingStaffCount: 0, eligibleBookingStaffCount: 0, needsSetup: false, ready: false, reasons: [] } }] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("Services leaf streams its neutral frame before authority; original view guard precedes workspace data", async () => {
  const bundle = await build({ bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", entryPoints: ["app/(app)/services/page.tsx"], plugins: [{ name: "server-boundaries", setup(b) {
    b.onResolve({ filter: /^(server-only|next\/server)$|experience-page-boundary$|workspace-language$|services-manager$|services-catalog-pilot$|route-context-guards$|permissions$|experience-context$|^@\/lib\/services$|\.css$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents: path === "server-only" || path.endsWith(".css") ? ""
      : path === "next/server" ? `export async function connection(){}`
      : path.endsWith("services-manager") ? `export function ServicesManager(){return null}export function ServicesLoading(){return null}`
      : path.endsWith("services-catalog-pilot") ? `export function ServicesCatalogPilot(){return null}`
      : path.endsWith("route-context-guards") ? `export function requireSalonManagePageContext(path){globalThis.__services.calls.push(['context',path]);return globalThis.__services.context}`
      : path.endsWith("permissions") ? `export function hasPermission(permission,context){globalThis.__services.calls.push(['permission',permission,context.currentSalon.id]);return globalThis.__services.allowed}`
      : path === "@/lib/services" ? `export const SERVICE_PERMISSIONS={view:'services.view'};export function getCurrentSalonServicesWorkspace(context){globalThis.__services.calls.push(['workspace',context.currentSalon.id]);return globalThis.__services.workspace}`
      : path.endsWith("experience-context") ? `export const getExperienceContext=()=>({scope:'scope1'})`
      : path.endsWith("experience-page-boundary") ? `export function ExperiencePageBoundary({children}){return children}` : language }));
  } }] });
  const module = { exports: {} };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, module, module.exports);
  const Page = module.exports.default, context = deferred(), allowed = deferred(), read = deferred();
  globalThis.__services = { calls: [], context: context.promise, allowed: allowed.promise, workspace: read.promise };
  try {
    const boundary = await Page({ searchParams: Promise.resolve({}) });
    assert.deepEqual(globalThis.__services.calls, []);
    assert.equal(boundary.props.children.type, Suspense);
    assert.equal(boundary.props.children.props.fallback.type.name, "ServicesLoading");
    assert.equal(boundary.props.pendingFallback.type.name, "ServicesLoading");
    const content = boundary.props.children.props.children.type(boundary.props.children.props.children.props);
    assert.deepEqual(globalThis.__services.calls, [["context", "/services"]]);
    context.resolve({ currentSalon: { id: "salon1" } });await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(globalThis.__services.calls.at(-1), ["permission", "services.view", "salon1"]);
    assert.equal(globalThis.__services.calls.some(call => call[0] === "workspace"), false);
    allowed.resolve(true);await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(globalThis.__services.calls.at(-1), ["workspace", "salon1"]);
    let ready = false;void content.then(() => { ready = true; });await new Promise(resolve => setImmediate(resolve));assert.equal(ready, false);
    read.resolve(workspace);const manager = await content;
    assert.equal(manager.props.data, workspace);assert.equal(manager.props.expectedSalonId, "salon1");
    globalThis.__services = { calls: [], context: Promise.resolve({ currentSalon: { id: "salon1" } }), allowed: false };
    const denied = (await Page({ searchParams: Promise.resolve({}) })).props.children.props.children;
    assert.equal((await denied.type(denied.props)).type, "main");
    assert.equal(globalThis.__services.calls.some(call => call[0] === "workspace"), false);
  } finally { delete globalThis.__services; }
});

test("Services actual toolbar survives held reads; dirty Save/Cancel/navigation guards and permissions stay intact", { timeout: 60000 }, async () => {
  const bundle = await build({ bundle: true, write: false, outdir: "fixture", format: "iife", jsx: "automatic", stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{Activity,useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
    import{ServicesManager}from'./app/services/services-manager';import './app/services/services.css';
    window.h={workspace:${JSON.stringify(workspace)},reads:0,writes:[],saved:0,invalidations:[],refreshes:0,failSave:false};
    window.router={refresh(){window.h.refreshes++},replace(){}};
    function Fixture(){const[data,setData]=useState(null),[error,setError]=useState(''),[visible,setVisible]=useState(true);
      const read=()=>{window.h.reads++;setError('');return new Promise(resolve=>{window.deliver=value=>{window.h.workspace=structuredClone(value);setData(value);resolve()};window.fail=()=>{setError('Read unavailable');resolve()}})};
      useEffect(()=>{void read();window.show=setVisible},[]);
      return <><a href="/away" id="leave">Leave services</a><Activity mode={visible?'visible':'hidden'}><ServicesManager data={data} pending={!data} error={error} onRetry={read} expectedSalonId="salon1" catalogScope="scope1" initialServiceId="service1" onSaved={async()=>{window.h.saved++;setData(structuredClone(window.h.workspace))}}/></Activity></>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
  ` }, plugins: [{ name: "browser-boundaries", setup(b) {
    b.onResolve({ filter: /^next\/navigation$|^next\/link$|workspace-language$|^@\/app\/services\/actions$|services-catalog-runtime$|delete-unused-button$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ loader: "tsx", resolveDir: process.cwd(), contents: path.endsWith("workspace-language") ? language
      : path === "next/navigation" ? `export const useRouter=()=>window.router;export const usePathname=()=>'/services';export const useSearchParams=()=>new URLSearchParams();`
      : path === "next/link" ? `export default function Link(props){return <a {...props}/>} `
      : path.endsWith("delete-unused-button") ? `export const DeleteUnusedButton=()=>null;`
      : path.endsWith("services-catalog-runtime") ? `export async function invalidateServicesCatalogForMutation(...args){window.h.invalidations.push(args)}`
      : `export async function createServiceAction(){throw Error('Unexpected creation')}export async function saveServiceConfigsAction(configs,salonId){window.h.writes.push({configs,salonId});if(window.h.failSave)return {ok:false,message:'Fixture save failed'};for(const config of configs){const row=window.h.workspace.services.find(row=>row.id===config.serviceId);Object.assign(row,{name:config.name,base_price:config.basePrice})}return {ok:true,message:'Services saved',serviceIds:configs.map(config=>config.serviceId)}}` }));
  } }] });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text, css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const server = createServer((request, response) => { response.setHeader("Content-Type", "text/html");response.end(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:15px Arial;--text-primary:#18181b;--text-secondary:#52525b}fieldset{margin:0;min-width:0;border:0;padding:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style><div id="root"></div><script>${js}</script></html>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });const errors = [];page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/services`);
    await page.getByText("Loading services…", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Services", exact: true }).count(), 1);
    assert.equal(await page.getByRole("searchbox", { name: "Search services" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Service filters", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "New service", exact: true }).count(), 0);
    assert.equal(await page.getByText(/No services yet|No matching services|read-only access|0 active/).count(), 0);
    await page.evaluate(() => { window.pendingSearch = document.querySelector('input[type="search"]');window.pendingHeader = document.querySelector('header'); });
    await page.setViewportSize({ width: 320, height: 844 });assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 390, height: 844 });
    fs.mkdirSync("artifacts/basic-page-loading-wave2-20261113/services", { recursive: true });
    await page.screenshot({ path: "artifacts/basic-page-loading-wave2-20261113/services/pending-390.png" });
    await page.evaluate(() => window.fail());await page.getByRole("alert").filter({ hasText: "Read unavailable" }).waitFor();
    await page.getByRole("button", { name: "Try again", exact: true }).click();assert.equal(await page.evaluate(() => window.h.reads), 2);
    await page.evaluate(() => window.deliver(window.h.workspace));
    await page.getByRole("searchbox", { name: "Search services" }).waitFor();
    await page.waitForFunction(() => !document.querySelector('input[type="search"]').disabled);
    assert.equal(await page.evaluate(() => window.pendingSearch === document.querySelector('input[type="search"]') && window.pendingHeader === document.querySelector('header')), true);
    await page.getByRole("button", { name: "Service filters", exact: true }).click();
    await page.getByRole("group", { name: "Service filters", exact: true }).getByLabel(/^Status/).selectOption("inactive");await page.getByRole("button", { name: "Close Service filters", exact: true }).click();
    await page.getByText("No matching services", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Service filters: filters applied", exact: true }).click();
    await page.getByRole("group", { name: "Service filters", exact: true }).getByLabel(/^Status/).selectOption("all");await page.getByRole("group", { name: "Service filters", exact: true }).getByLabel(/^Category/).selectOption("Nails");
    await page.getByRole("button", { name: "Close Service filters", exact: true }).click();
    const name = page.getByLabel("Name:", { exact: true });await name.waitFor();
    await name.fill("Edited Pedicure");
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true });window.dispatchEvent(event);return event.defaultPrevented; }), true);
    const dismiss = async dialog => { assert.match(dialog.message(), /Discard unsaved service changes/);await dialog.dismiss(); };
    page.on("dialog", dismiss);await page.locator("#leave").click();page.off("dialog", dismiss);
    assert.match(page.url(), /\/services$/);assert.equal(await name.inputValue(), "Edited Pedicure");
    await page.evaluate(() => window.show(false));await page.waitForFunction(() => getComputedStyle(document.querySelector('main')).display === 'none');
    await page.evaluate(() => window.show(true));await name.waitFor();assert.equal(await name.inputValue(), "Edited Pedicure");
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true });window.dispatchEvent(event);return event.defaultPrevented; }), true);
    await page.evaluate(() => window.deliver(structuredClone(window.h.workspace)));assert.equal(await name.inputValue(), "Edited Pedicure");
    await page.evaluate(() => { window.h.failSave = true; });await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByText("Fixture save failed", { exact: true }).first().waitFor();assert.equal(await name.inputValue(), "Edited Pedicure");
    await page.evaluate(() => { window.h.failSave = false; });await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.waitForFunction(() => window.h.saved === 1);
    assert.deepEqual(await page.evaluate(() => window.h.writes.map(write => write.salonId)), ["salon1", "salon1"]);
    assert.deepEqual(await page.evaluate(() => window.h.invalidations), [["scope1", "salon1"]]);
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true });window.dispatchEvent(event);return event.defaultPrevented; }), false);
    await name.fill("Discard this change");await page.locator(".service-editor__actions").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await name.inputValue(), "Edited Pedicure");assert.equal(await page.locator(".services-save-bar").count(), 0);
    await page.getByRole("searchbox", { name: "Search services" }).fill("Edited");
    await page.evaluate(() => window.deliver({ ...window.h.workspace, canManage: false }));
    assert.equal(await page.getByRole("button", { name: "New service", exact: true }).count(), 0);
    assert.equal(await name.isDisabled(), true);assert.equal(await page.getByRole("searchbox", { name: "Search services" }).inputValue(), "Edited");
    assert.equal(await page.locator(".services-save-bar").count(), 0);
    await page.screenshot({ path: "artifacts/basic-page-loading-wave2-20261113/services/read-only-390.png" });
    await page.evaluate(() => window.deliver({ ...window.h.workspace, canManage: true }));
    await name.fill("Edited pending permission");await page.evaluate(() => window.deliver({ ...window.h.workspace, canManage: false }));
    assert.equal(await page.getByRole("button", { name: "Save all changes", exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.h.writes.length), 2);
    await page.locator(".services-save-bar").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await name.inputValue(), "Edited Pedicure");
    assert.deepEqual(errors, []);
  } finally { await browser?.close();await new Promise(resolve => server.close(resolve)); }
});
