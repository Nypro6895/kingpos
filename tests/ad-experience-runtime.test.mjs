import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import fs from "node:fs";
import { chromium, webkit } from "playwright-core";

const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {ExploreAdvertising} from './components/explore-advertising';
import {OwnerSponsoredPost} from './components/owner-sponsored-post';
import {compressImageCanvas} from './lib/image-upload-client';
window.compressImageCanvas=compressImageCanvas;
const owner=location.pathname.includes('owner');
createRoot(document.getElementById('root')).render(owner?<OwnerSponsoredPost location="Chicago"/>:<ExploreAdvertising><input aria-label="Your message"/><button onClick={()=>window.underlyingClicks=(window.underlyingClicks||0)+1}>Underlying action</button><div style={{height:3000}}>Page content</div></ExploreAdvertising>);
` }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": '{}' },
plugins: [{ name: "fixture", setup(b) {
  b.onResolve({ filter: /^(next\/(navigation|image|link)|@\/components\/workspace-language)$/ }, a => ({ path: a.path, namespace: "stub" }));
  b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ loader: "js", resolveDir: process.cwd(), contents: a.path === "next/navigation" ? "export const usePathname=()=>location.pathname" : a.path === "next/image" ? "import React from 'react';export default function Image({unoptimized,sizes,...props}){return React.createElement('img',props)}" : a.path === "next/link" ? "import React from 'react';export default function Link({prefetch,children,...props}){return React.createElement('a',props,children)}export const useLinkStatus=()=>({pending:false});" : "export const useWorkspaceTranslation=()=>text=>text;export const WorkspaceText=({text})=>text;" }));
} }] });
const popup = { id: "10000000-0000-0000-0000-000000000001", name: "Summer offer", kind: "popup", enabled: true,
  href: "/offer", imageUrl: "/ad.png", text: "", background: "white", color: "black", delaySeconds: .05,
  durationSeconds: 0, closeButton: false, repeat: "daily", position: "bottom", speedSeconds: 10, startsAt: null, endsAt: null };

async function fixture(engine, run, options = {}) {
  const events = []; const errors = [];
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js" || req.url === "/fixture.css") {
      const ext = req.url.endsWith(".js") ? ".js" : ".css"; res.setHeader("Content-Type", ext === ".js" ? "text/javascript" : "text/css");
      res.end(bundle.outputFiles.find(f => f.path.endsWith(ext))?.text ?? "");
    } else if (req.url === "/ad.png") {
      if (options.brokenImage) { res.writeHead(404); res.end(); }
      else { res.setHeader("Content-Type", "image/png"); res.end(fs.readFileSync("public/brand/reylumi-favicon.png")); }
    } else { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await engine.launch(engine === chromium ? { executablePath: process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true } : { headless: true });
  try {
    const context = await browser.newContext({ viewport: options.desktop ? { width: 1440, height: 1000 } : { width: 390, height: 844 }, ...(engine === webkit ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/explore/advertising**", async route => {
      const req = route.request();
      if (req.method() === "GET") return route.fulfill({ json: { campaigns: [popup] } });
      const event = req.postDataJSON(); events.push(event);
      if (options.slowConfirm && event.phase === "confirm") await new Promise(r => setTimeout(r, 1800));
      await route.fulfill({ json: { allowed: true, ...(event.phase === "reserve" ? { reservation: "20000000-0000-0000-0000-000000000001" } : {}) } }).catch(() => {});
    });
    await page.route("**/api/campaigns/delivery**", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { title: "Salon offer", caption: "Welcome", image: "/ad.png", href: "/offer", ticket: "signed-ticket" } });
      const event = route.request().postDataJSON(); events.push(event);
      if (options.slowConfirm) await new Promise(r => setTimeout(r, 1800));
      await route.fulfill({ json: { ok: true } }).catch(() => {});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/${options.owner ? "owner" : "explore"}`);
    await run(page, events); assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
for (const [name, engine] of [["Chrome", chromium], ["WebKit mobile", webkit]]) {
  test(`${name}: nonmodal popup preserves clicks, scrolling and focus while confirmation is slow`, async () => {
    await fixture(engine, async (page, events) => {
      await page.waitForSelector("[data-ad-popup]");
      await page.waitForTimeout(350);
      fs.mkdirSync("artifacts/ad-media-performance-20261017/screenshots", { recursive: true });
      await page.screenshot({ path: `artifacts/ad-media-performance-20261017/screenshots/${name.replaceAll(" ", "-")}.png` });
      assert.equal(await page.locator("[data-ad-popup]").getAttribute("aria-modal"), "false");
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
      await page.getByRole("button", { name: "Underlying action" }).click({ timeout: 1000 });
      assert.equal(await page.evaluate(() => window.underlyingClicks), 1);
      await page.getByRole("textbox").fill("Typing continues");
      await page.evaluate(() => window.scrollTo(0, 500));
      assert.ok(await page.evaluate(() => scrollY) > 0);
      await page.getByRole("button", { name: "Close promotion" }).click({ timeout: 1000 });
      await page.waitForSelector("[data-ad-popup]", { state: "detached" });
      assert.equal(events.filter(e => e.phase === "reserve").length, 1);
      assert.ok(events.filter(e => e.phase === "confirm").length <= 1);
    }, { slowConfirm: true });
  });
  test(`${name}: broken popup image cannot reserve or record a view`, async () => {
    await fixture(engine, async (page, events) => {
      await page.waitForTimeout(450); assert.equal(events.length, 0); assert.equal(await page.locator("[data-ad-popup]").count(), 0);
    }, { brokenImage: true });
  });
  test(`${name}: customer ad navigates immediately even before its view is eligible`, async () => {
    await fixture(engine, async (page, events) => {
      const link = page.getByRole("link", { name: "Discover this post" }); await link.waitFor();
      assert.equal(await link.getAttribute("href"), "/offer"); assert.equal(await link.getAttribute("aria-disabled"), null);
      await link.click(); await page.waitForURL("**/offer");
      assert.equal(events.length, 0, "early navigation must not force a chargeable view");
    }, { owner: true, slowConfirm: true });
  });
  test(`${name}: customer view requires loaded image plus one second of exposure; no repeat request`, async () => {
    await fixture(engine, async (page, events) => {
      await page.getByRole("link", { name: "Discover this post" }).waitFor();
      await page.waitForTimeout(500); assert.equal(events.length, 0);
      await page.waitForFunction(() => document.querySelector('article img')?.complete);
      await page.waitForTimeout(900); assert.equal(events.filter(e => e.kind === "view").length, 1);
      await page.waitForTimeout(700); assert.equal(events.filter(e => e.kind === "view").length, 1);
    }, { owner: true });
  });
  test(`${name}: customer broken image never causes a billable view`, async () => {
    await fixture(engine, async (page, events) => {
      await page.waitForTimeout(1400); assert.equal(events.length, 0); assert.equal(await page.locator("article").count(), 0);
    }, { owner: true, brokenImage: true });
  });
  test(`${name}: hidden tab resets customer exposure timer without charging a view`, async () => {
    await fixture(engine, async (page, events) => {
      await page.getByRole("link", { name: "Discover this post" }).waitFor();
      await page.waitForTimeout(300);
      await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForTimeout(1200); assert.equal(events.length, 0);
      await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
      await page.waitForTimeout(500); assert.equal(events.length, 0);
      await page.waitForTimeout(700); assert.equal(events.filter(e => e.kind === "view").length, 1);
    }, { owner: true });
  });
  test(`${name}: shared browser compressor enforces byte ceiling and max edge`, async () => {
    await fixture(engine, async page => {
      await page.waitForFunction(() => window.compressImageCanvas);
      const result = await page.evaluate(async () => {
        const canvas = document.createElement("canvas"); canvas.width = 2200; canvas.height = 1800;
        const ctx = canvas.getContext("2d"); const data = ctx.createImageData(canvas.width, canvas.height);
        for (let i = 0; i < data.data.length; i += 4) { data.data[i] = Math.random() * 256; data.data[i + 1] = Math.random() * 256; data.data[i + 2] = Math.random() * 256; data.data[i + 3] = 255; }
        ctx.putImageData(data, 0, 0); const output = await window.compressImageCanvas(canvas);
        return { bytes: output.blob.size, type: output.blob.type, width: output.width, height: output.height };
      });
      assert.equal(result.type, "image/webp"); assert.ok(result.bytes <= 500 * 1024); assert.ok(Math.max(result.width, result.height) <= 1600);
    });
  });
}
