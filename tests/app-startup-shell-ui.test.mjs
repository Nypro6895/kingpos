import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

test("public app startup is painted, interactive and free of private state while data and images remain unresolved", { timeout: 90000, skip: !existsSync(executablePath) }, async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{Suspense,useState}from'react';import{createRoot}from'react-dom/client';
      import{AppStartupShell}from'./components/app-startup-shell';
      const pending=new Promise(()=>{});
      function PendingAccountData(){throw pending;return <div>PRIVATE_OWNER_SECRET $91234.56 PRIVATE_SALON_SECRET</div>}
      function App(){const[retries,setRetries]=useState(0);const recovery=new URLSearchParams(location.search).has('retry');return <><output id='retry-count' hidden>{retries}</output><Suspense fallback={<AppStartupShell retry={recovery?()=>setRetries(value=>value+1):undefined}/>}><PendingAccountData/></Suspense></>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outfile: "fixture.js", jsx: "automatic", alias: { "@": process.cwd() }, define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "next-link-adapter", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "tsx", resolveDir: process.cwd(), contents: `import React from'react';export default function Link({prefetch,children,...props}){return <a {...props}>{children}</a>}` }));
    }}],
  });
  const script = result.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = result.outputFiles.find(file => file.path.endsWith(".css")).text;
  let releaseImage;
  const slowImage = new Promise(resolve => { releaseImage = resolve; });
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.test");
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(script); return; }
    if (url.pathname === "/blocked-first-image.png") {
      await slowImage;
      if (!response.destroyed) { response.setHeader("Content-Type", "image/png"); response.end(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9kAAAAASUVORK5CYII=", "base64")); }
      return;
    }
    requests.push({ method: request.method, url: request.url });
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style></head><body><div id="root"></div><img src="/blocked-first-image.png" loading="eager" width="1" height="1" alt="" style="position:absolute;left:0;top:0;opacity:0"><script src="/fixture.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
  const paintOrdering = [];
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const width of [320, 390, 412]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        window.startupEvents = [];
        window.fullWindowLoaded = false;
        window.addEventListener("load", () => { window.fullWindowLoaded = true; });
        window.addEventListener("reylumi:screen-ready", () => {
          const shell = document.querySelector("[data-startup-shell]");
          window.startupEvents.push({ at: performance.now(), height: shell?.getBoundingClientRect().height, windowLoaded: window.fullWindowLoaded });
        });
      });
      await page.goto(`${base}/explore?z=last&category=Nails&a=first`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.startupEvents.length === 1 && document.querySelector('[data-reylumi-shell-ready="true"]'));
      // Paint entries are delivered asynchronously after the rendering callback.
      await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint").length > 0, undefined, { timeout: 5000 });
      const frame = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth, viewport: innerWidth, ready: window.startupEvents[0],
        paint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime, loaded: window.fullWindowLoaded,
        shell: document.querySelector("[data-startup-shell]").textContent,
      }));
      assert.ok(frame.width <= frame.viewport, `${width}px viewport must not overflow`);
      assert.ok(frame.ready.height >= 844, "bundled public frame uses the actual shell CSS");
      assert.equal(frame.loaded, false, "core UI readiness cannot wait for the blocked image or window load");
      assert.equal(frame.ready.windowLoaded, false);
      paintOrdering.push({ width, paint: frame.paint, ready: frame.ready.at });
      assert.ok(!/PRIVATE_OWNER_SECRET|PRIVATE_SALON_SECRET|91234|cache|cached|saved temporarily|new content|dữ liệu đã lưu tạm/i.test(frame.shell));
      await page.getByRole("heading", { name: "Find a little inspiration.", exact: true }).waitFor();
      assert.equal(await page.getByRole("search").getAttribute("method"), "get");
      assert.equal(await page.getByRole("search").getAttribute("action"), "/explore");
      const search = page.getByRole("searchbox", { name: "Search salons, services, or locations" });
      await search.fill("Nails in Chicago");
      const draft = await page.evaluate(() => window.__reylumiStartupSearch);
      assert.equal(draft.query, "Nails in Chicago");
      assert.equal(draft.focused, true);
      assert.equal(draft.route, "/explore?a=first&category=Nails&z=last", "draft key normalizes parameter ordering");
      assert.ok(Number.isFinite(draft.at) && Date.now() - draft.at < 5000);
      await search.press("Tab");
      assert.equal(await page.evaluate(() => window.__reylumiStartupSearch.focused), false);
      await Promise.all([
        page.waitForURL(url => url.pathname === "/explore" && url.searchParams.get("q") === "Nails in Chicago", { waitUntil: "domcontentloaded" }),
        page.getByRole("button", { name: "Search", exact: true }).click({ noWaitAfter: true }),
      ]);
      assert.equal(requests.findLast(request => request.url.includes("q=Nails")).method, "GET");
      await page.getByRole("navigation", { name: "Discover Reylumi" }).getByRole("link", { name: "Nails", exact: true }).waitFor();
      await Promise.all([
        page.waitForURL(url => url.pathname === "/market", { waitUntil: "domcontentloaded" }),
        page.getByRole("navigation", { name: "Discover Reylumi" }).getByRole("link", { name: "Market", exact: true }).click({ noWaitAfter: true }),
      ]);
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "About Reylumi", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
    await page.goto(`${base}/explore?retry=1`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    assert.equal(await page.locator("#retry-count").textContent(), "1");
    assert.equal(await page.getByRole("searchbox", { name: "Search salons, services, or locations" }).isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.close();
    for (const frame of paintOrdering) assert.ok(frame.paint > 0 && frame.paint <= frame.ready, `screen-ready follows painted content at ${frame.width}px (FCP=${frame.paint}, ready=${frame.ready})`);
  } finally {
    releaseImage(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
