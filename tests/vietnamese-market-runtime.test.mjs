import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import fs from "node:fs";
const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("Market Vietnamese listing opens, installs and keeps options on mobile and desktop", { skip: !fs.existsSync(executablePath) }, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MarketClient}from'./app/market/market-client';createRoot(document.getElementById('root')).render(<MarketClient/>);` }, outfile: "bundle.js", bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": process.cwd() }, plugins: [{ name: "stubs", setup(b) {
    b.onResolve({ filter: /^(next\/navigation|next\/image|.*vietnamese-actions|.*checkin-receipt-actions|.*plugin-actions|.*credit-actions|.*contact-form)$/ }, a => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ resolveDir: process.cwd(), contents: a.path.includes("navigation") ? "export const usePathname=()=>location.pathname;export const useRouter=()=>({refresh(){}});" : a.path.includes("image") ? `import React from 'react';export default function Image({priority,...props}){return React.createElement('img',props)}` : a.path.includes("vietnamese-actions") ? `export async function setVietnamesePlugin(installed,staff,portable){return {state:{installed,active:installed,staff_enabled:staff,portable_enabled:portable,trial_ends_at:'2099-01-01T00:00:00Z',paid_until:null,has_subscription:false}}}export async function vietnamesePaymentAction(){return {error:'Not connected'}};` : a.path.includes("checkin-receipt-actions") ? "export async function checkinReceiptPaymentAction(){return{error:'Not connected'}}" : a.path.includes("credit-actions") ? "export async function setCampaignPluginAction(){return{installed:true}}" : a.path.includes("plugin-actions") ? "export async function setPayrollDataPlugin(){return{installed:true}}" : "export function ContactSupportForm(){return null}", loader: "js" }));
  } }] });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js")).text, css = bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
  const server = createServer((req, res) => {
    const file = "public" + (req.url ?? "");
    if (req.url?.startsWith("/market/") && fs.existsSync(file) && fs.statSync(file).isFile()) { res.setHeader("Content-Type", file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : "image/webp"); res.end(fs.readFileSync(file)); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(`<html><head><style>*{box-sizing:border-box}body{margin:0;font-family:Arial;--brand-orange:#d86232;--text-primary:#222;--text-secondary:#666;--border-subtle:#eee}button,input{font:inherit}${css}</style></head><body><div id="root"></div><script>${javascript}</script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true });
  fs.mkdirSync("artifacts/vietnamese-market", { recursive: true });
  try {
    for (const [name, width, height] of [["mobile", 390, 844], ["desktop", 1440, 1000]]) {
      const page = await browser.newPage({ viewport: { width, height } }), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.getByRole("button", { name: "Tiếng Việt", exact: true }).click();
      await page.getByRole("dialog").waitFor();
      assert.ok((await page.getByRole("dialog").innerText()).includes("$3.99"));
      for (const name of ["Hôm nay (Today)", "Quản lý dịch vụ", "Cài đặt dịch vụ", "Hồ sơ khách hàng"]) {
        await page.getByRole("tab", { name, exact: true }).click();
        await page.getByRole("tabpanel").getByRole("img").evaluate(img => img.decode());
        assert.equal(await page.getByRole("tab", { name, exact: true }).getAttribute("aria-selected"), "true");
        assert.ok((await page.getByRole("link", { name: "Mở ảnh lớn ↗" }).getAttribute("href")).endsWith("-v1.png"));
      }
      await page.getByRole("tab", { name: "Quản lý dịch vụ", exact: true }).click();
      await page.getByRole("tabpanel").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/vietnamese-market/${name}-gallery.png` });
      await page.getByLabel(/Áp dụng cho nhân viên/).check(); await page.getByLabel(/Áp dụng cho Portable/).check();
      await page.screenshot({ path: `artifacts/vietnamese-market/${name}-plugin.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole("button", { name: "Dùng thử miễn phí 5 ngày" }).click();
      await page.getByRole("button", { name: "Lưu tùy chọn" }).waitFor();
      await page.getByRole("button", { name: "Close details" }).click();
      await page.getByRole("button", { name: /^My features/ }).click();
      await page.getByRole("button", { name: "Tiếng Việt", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
