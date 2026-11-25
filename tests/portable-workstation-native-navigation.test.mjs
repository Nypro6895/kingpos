import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
  import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';
  import{WorkstationDevices}from'./app/pos/portable/workstation-devices';
  function App(){useEffect(()=>{const guard=event=>{window.fixture.trace.push({kind:'guard'});if(window.fixture.blocked){event.detail.allowed=false;event.detail.error='Pending ticket must finish first';}};window.addEventListener('kingpos:workstation-can-change',guard);return()=>window.removeEventListener('kingpos:workstation-can-change',guard)},[]);return <><label>Ticket<input defaultValue="Unsubmitted draft"/></label><WorkstationDevices/></>}
  createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", plugins: [{ name: "native-workstation-fixture", setup(builder) {
  builder.onResolve({ filter: /\.css$/ }, ({ path }) => ({ path, namespace: "fixture-css" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture-css" }, () => ({ contents: "export default {};" }));
  builder.onResolve({ filter: /^(next\/navigation|@\/components\/workspace-language|@\/components\/overlay-dismissal|@\/lib\/portable-device-storage|@\/lib\/portable-workstation-client|@\/lib\/app-local-host)$/ }, ({ path }) => ({ path, namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "next/navigation" ? `export const useRouter=()=>({refresh(){window.fixture.trace.push({kind:'router-refresh'})}});`
    : path.endsWith("workspace-language") ? `export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`
    : path.endsWith("overlay-dismissal") ? `export const useNativeDialogNavigation=()=>{};`
    : path.endsWith("portable-device-storage") ? `export const desktopDevice=()=>undefined;`
    : path.endsWith("app-local-host") ? `export const getAppLocalHost=()=>({isNative:true,async openOnline(path){window.fixture.trace.push({kind:'openOnline',path});if(window.fixture.failNavigation)throw Error('Native navigation failed')}});`
    : `export async function workstationRequest(input,role){window.fixture.trace.push({kind:'request',input,role});if(!input)return window.fixture.session;const current={id:'station',label:'Counter 1',generation:2,customerPaired:false,staffOnline:true,canHandover:true,role:'staff',topic:'synthetic',verificationKey:'synthetic'};return{role:'staff',current,workstations:[],...(input.action==='code'?{code:'12345678',expiresAt:Date.now()+300000}:{})}}export const workstationChanged=()=>window.fixture.trace.push({kind:'changed'});` }));
} }] });

async function withDevices(work, current = false) {
  const server = createServer((request, response) => { response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html"); response.end(request.url === "/bundle.js" ? built.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.addInitScript(current => { window.fixture = { trace: [], blocked: false, failNavigation: false, session: { role: "staff", current: current ? { id: "station", label: "Counter 1", generation: 1, customerPaired: false, staffOnline: true, canHandover: true, role: "staff" } : null, workstations: [] } }; }, current);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/pos/portable`);
    await page.getByRole("button", { name: "Devices for this counter", exact: true }).click();
    await page.getByRole("button", { name: "Create counter", exact: true }).waitFor();
    await work(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

test("native enrollment checks the current cart then opens fresh staff source rather than only refreshing retained context", { timeout: 30000 }, async () => {
  await withDevices(async page => {
    await page.getByLabel("Counter name").fill("Counter 1");
    await page.getByRole("button", { name: "Create counter", exact: true }).click();
    await page.waitForFunction(() => window.fixture.trace.some(item => item.kind === "openOnline"));
    const trace = await page.evaluate(() => window.fixture.trace);
    assert.deepEqual(trace.filter(item => item.kind !== "request" || item.input), [{ kind: "guard" }, { kind: "request", input: { action: "create", label: "Counter 1" }, role: undefined }, { kind: "changed" }, { kind: "openOnline", path: "/pos/portable" }]);
    assert.equal(await page.getByLabel("Ticket", { exact: true }).inputValue(), "Unsubmitted draft");
    assert.equal(trace.some(item => item.kind === "router-refresh"), false);
  });
});
test("pending draft blocks native enrollment before server mutation or navigation", { timeout: 30000 }, async () => {
  await withDevices(async page => {
    await page.evaluate(() => { window.fixture.blocked = true; });
    await page.getByLabel("Counter name").fill("Counter 1");
    await page.getByRole("button", { name: "Create counter", exact: true }).click();
    await page.getByRole("alert").waitFor();
    const trace = await page.evaluate(() => window.fixture.trace);
    assert.equal(trace.some(item => item.input || item.kind === "openOnline"), false);
    assert.equal(await page.getByLabel("Ticket", { exact: true }).inputValue(), "Unsubmitted draft");
  });
});
test("rotating a pairing code rejoins its new generation and retains the current ticket", { timeout: 30000 }, async () => {
  await withDevices(async page => {
    await page.getByRole("button", { name: "Connect customer screen", exact: true }).click();
    await page.getByText("12345678", { exact: true }).waitFor();
    const trace = await page.evaluate(() => window.fixture.trace);
    assert.equal(trace.filter(item => item.kind === "changed").length, 1);
    assert.equal(trace.some(item => item.kind === "openOnline" || item.kind === "router-refresh"), false);
    assert.equal(await page.getByLabel("Ticket", { exact: true }).inputValue(), "Unsubmitted draft");
  }, true);
});
