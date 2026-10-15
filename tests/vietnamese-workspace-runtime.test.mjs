import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import fs from "node:fs";
const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("Vietnamese React labels switch safely across owner, Portable and excluded routes", { skip: !fs.existsSync(executablePath) }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{WorkspaceLanguageProvider,WorkspaceText}from'./components/workspace-language';import{VietnamesePluginPanel}from'./app/market/vietnamese-plugin-panel';function App(){const[on,setOn]=useState(true);return <><button id="toggle" onClick={()=>setOn(!on)}>Toggle</button><WorkspaceLanguageProvider enabled={on} portableEnabled={false} expiresAt={null}><h1><WorkspaceText text="Payroll"/></h1><button><WorkspaceText text="Save changes"/></button><span id="customer">Payroll</span><input defaultValue="Today"/><VietnamesePluginPanel initialState={{installed:false,active:false,staff_enabled:false,portable_enabled:false,trial_ends_at:null,paid_until:null,has_subscription:false}} onChange={s=>window.saved=s}/></WorkspaceLanguageProvider></>};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|.*vietnamese-actions|.*\.module\.css)$/ }, a => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: a.path.includes("navigation") ? "export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){}});" : a.path.includes("vietnamese-actions") ? `export async function setVietnamesePlugin(installed,staff,portable){return {state:{installed,active:installed,staff_enabled:staff,portable_enabled:portable,trial_ends_at:'2099-01-01T00:00:00Z',paid_until:null,has_subscription:false}}}export async function vietnamesePaymentAction(){return {error:'Not connected'}};` : "export default {};", loader: "js" }));
  } }] });
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<html><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + "/payroll");
    await page.getByRole("heading", { name: "Lương", exact: true }).waitFor();
    assert.equal(await page.locator("#customer").textContent(), "Payroll");
    assert.equal(await page.locator("input[type=text],input:not([type])").inputValue(), "Today");
    await page.getByLabel(/Áp dụng cho nhân viên/).check(); await page.getByLabel(/Áp dụng cho Portable/).check();
    await page.getByRole("button", { name: "Dùng thử miễn phí 5 ngày" }).click();
    await page.getByRole("button", { name: "Lưu tùy chọn" }).waitFor();
    assert.equal(await page.evaluate(() => window.saved.staff_enabled && window.saved.portable_enabled), true);
    await page.getByRole("button", { name: "Gỡ plugin" }).click();
    await page.getByRole("button", { name: "Thêm lại plugin" }).waitFor();
    await page.locator("#toggle").click();
    await page.getByRole("heading", { name: "Payroll", exact: true }).waitFor();
    for (const path of ["/admin/market", "/explore", "/pos/portable"]) {
      await page.goto(base + path);
      await page.getByRole("heading", { name: "Payroll", exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
