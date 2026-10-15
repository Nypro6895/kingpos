import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import vm from "node:vm";
import ts from "typescript";
import { chromium } from "playwright-core";

const source = readFileSync("public/experience-sw.js", "utf8");
const origin = "https://reylumi.example";
const mediaOrigin = "https://database.example";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const publicImage = (n, bucket = "salon-profile-media") => `${mediaOrigin}/storage/v1/object/public/${bucket}/${id(900)}/profile/cover/${id(n)}.webp`;
const optimized = (n) => `${origin}/_next/image?url=${encodeURIComponent(publicImage(n))}&w=640&q=75`;

function harness(options = {}) {
  const handlers = {}, entries = new Map();
  let now = 1_800_000_000_000, networkCalls = 0, clientPath = "/explore";
  const cache = {
    async match(key) { return entries.get(typeof key === "string" ? key : key.url)?.clone(); },
    async put(key, response) {
      const url = typeof key === "string" ? key : key.url;
      if (options.failIndex && url.endsWith("/index")) throw Error("Quota full");
      entries.set(url, response.clone());
    },
    async delete(key) { return entries.delete(typeof key === "string" ? key : key.url); },
    async keys() { return [...entries.keys()].map((url) => new Request(url)); },
  };
  const context = vm.createContext({
    Request, Response, URL, Blob, Set, Promise, Number,
    Date: class extends Date { static now() { return now; } },
    self: {
      location: { origin, href: `${origin}/experience-sw.js?mediaOrigin=${encodeURIComponent(mediaOrigin)}` },
      clients: { async get() { if (options.failClient) throw Error("Client gone"); return { url: origin + clientPath }; } },
      addEventListener(name, handler) { handlers[name] = handler; },
    },
    caches: { async open() { if (options.failStorage) throw Error("Storage denied"); return cache; } },
    fetch: async (request) => {
      networkCalls += 1;
      if (options.fetch) return options.fetch(request);
      return new Response(options.body ?? new Uint8Array([1, 2, 3]), {
        status: options.status ?? 200,
        headers: { "Content-Type": "image/webp", "Cache-Control": "public,max-age=31536000,immutable", ...options.headers },
      });
    },
  });
  vm.runInContext(source, context, { filename: "experience-sw.js" });
  return {
    entries,
    get calls() { return networkCalls; },
    set clientPath(value) { clientPath = value; },
    advance(ms) { now += ms; },
    async activate() { const waits = []; handlers.activate({ waitUntil(value) { waits.push(value); } }); await Promise.all(waits); },
    async request(url, { destination = "image", method = "GET", accept = "image/webp", clientId = "client", ...rest } = {}) {
      const request = new Request(url, { method, headers: { Accept: accept }, ...rest });
      Object.defineProperty(request, "destination", { value: destination });
      const waits = [];
      let response;
      handlers.fetch({ request, clientId, respondWith(value) { response = value; }, waitUntil(value) { waits.push(value); } });
      if (!response) return null;
      const result = await response;
      await Promise.all(waits);
      return result;
    },
    async rows() { const value = entries.get(`${origin}/__experience-media__/index`); return value ? value.clone().json() : []; },
  };
}

test("visited UUID images reuse the fetched response and keep optimized formats separate", async () => {
  const worker = harness();
  for (const url of [optimized(1), publicImage(2, "account-avatars"), publicImage(3, "beauty-profile-media")]) {
    assert.equal(await (await worker.request(url)).arrayBuffer().then((body) => body.byteLength), 3);
    await worker.request(url);
  }
  assert.equal(worker.calls, 3, "each first request downloads exactly once; repeats use storage");
  await worker.request(optimized(1), { accept: "image/avif,image/webp" });
  assert.equal(worker.calls, 4);
  assert.equal((await worker.rows()).length, 4);
});

test("documents, API/RSC requests, mutations, signed and unversioned media stay untouched", async () => {
  const worker = harness();
  const denied = [
    [origin + "/explore", { destination: "document" }],
    [origin + "/api/explore/feed", { destination: "" }],
    [origin + "/explore?_rsc=abc", { destination: "" }],
    [optimized(1), { method: "POST" }],
    [optimized(1), { headers: { Authorization: "Bearer credential" } }],
    [optimized(1), { headers: { Range: "bytes=0-200" } }],
    [optimized(1), { cache: "no-store" }],
    [optimized(1), { cache: "reload" }],
    [publicImage(1).replace("/public/", "/sign/") + "?token=secret", {}],
    [publicImage(1).replace(id(1) + ".webp", "current.webp"), {}],
    [publicImage(1, "support-attachments"), {}],
    [publicImage(1).replace(mediaOrigin, "https://other.example"), {}],
    [publicImage(1) + "?download=1", {}],
    [optimized(1) + "&token=secret", {}],
    [optimized(1).replace("w=640", "w=640&w=1280"), {}],
    [origin + "/_next/image?url=%2Fapi%2Fpayments&w=640&q=75", {}],
  ];
  for (const [url, options] of denied) assert.equal(await worker.request(url, options), null, url);
  assert.equal(worker.calls, 0);
  assert.equal(worker.entries.size, 0);
});

test("POS, tax company, account, booking and other operational clients bypass the image cache", async () => {
  const worker = harness();
  await worker.request(optimized(1));
  const paths = ["/pos/portable", "/tax-company/install", "/account", "/book/123", "/booking/manage/token", "/booking-payment/token", "/admin/post-safety", "/staff/today", "/market/orders/123", "/support/123"];
  for (const path of paths) { worker.clientPath = path; await worker.request(optimized(1)); }
  assert.equal(worker.calls, 1 + paths.length);
  assert.equal((await worker.rows()).length, 1);
  await worker.request(optimized(1), { clientId: "" });
  assert.equal(worker.calls, 2 + paths.length);
});

test("cache response policies, errors and opaque bodies are never persisted", async () => {
  for (const options of [
    { headers: { "Cache-Control": "private,max-age=31536000" } },
    { headers: { "Cache-Control": "public,no-store" } },
    { headers: { "Cache-Control": "no-cache" } },
    { headers: { "Cache-Control": "max-age=0" } },
    { headers: { "Content-Type": "text/html" } },
    { headers: { Vary: "*" } },
    { headers: { "Set-Cookie": "session=secret" } },
    { headers: { "Content-Length": String(9 * 1024 * 1024) } },
    { status: 404 },
    { status: 500 },
    { fetch: () => { const opaque = () => { const response = new Response("opaque"); Object.defineProperty(response, "type", { value: "opaque" }); response.clone = opaque; return response; }; return opaque(); } },
  ]) {
    const worker = harness(options);
    await worker.request(optimized(1));
    await worker.request(optimized(1));
    assert.equal(worker.calls, 2);
    assert.equal((await worker.rows()).length, 0);
  }
});

test("cache obeys response freshness and the seven-day maximum", async () => {
  const short = harness({ headers: { "Cache-Control": "public,max-age=100", Age: "50" } });
  await short.request(optimized(1));
  short.advance(49_000);
  await short.request(optimized(1));
  assert.equal(short.calls, 1);
  short.advance(1_001);
  await short.request(optimized(1));
  assert.equal(short.calls, 2);
  const long = harness();
  await long.request(optimized(1));
  long.advance(7 * 24 * 60 * 60 * 1000 + 1);
  await long.request(optimized(1));
  assert.equal(long.calls, 2);
});

test("least recently used eviction bounds entry count, and activation removes expired and orphaned images", async () => {
  const worker = harness();
  for (let n = 1; n <= 160; n++) { worker.advance(1); await worker.request(optimized(n)); }
  worker.advance(1);
  await worker.request(optimized(1));
  worker.advance(1);
  await worker.request(optimized(161));
  assert.equal((await worker.rows()).length, 160);
  await worker.request(optimized(1));
  assert.equal(worker.calls, 161, "recently viewed first image survives");
  await worker.request(optimized(2));
  assert.equal(worker.calls, 162, "least recently used image was evicted");
  worker.entries.set(`${origin}/__experience-media__/image?orphan=1`, new Response("orphan"));
  worker.advance(7 * 24 * 60 * 60 * 1000 + 1);
  await worker.activate();
  assert.equal((await worker.rows()).length, 0);
  assert.equal(worker.entries.size, 1, "only the empty index remains");
});

test("total byte limit and per-image limit apply even without content-length", async () => {
  const worker = harness({ body: new Uint8Array(7 * 1024 * 1024) });
  for (let n = 1; n <= 7; n++) { worker.advance(1); await worker.request(optimized(n)); }
  const rows = await worker.rows();
  assert.equal(rows.length, 6);
  assert.ok(rows.reduce((total, row) => total + row.bytes, 0) <= 48 * 1024 * 1024);
  const oversized = harness({ body: new Uint8Array(8 * 1024 * 1024 + 1) });
  await oversized.request(optimized(1));
  assert.equal((await oversized.rows()).length, 0);
});

test("only two images persist concurrently, while a third image still loads without another download", async () => {
  const pendingBodies = [];
  const worker = harness({ fetch(request) {
    const url = new URL(request.url);
    if (url.searchParams.get("url") === publicImage(3)) return new Response(new Uint8Array([3]), { headers: { "Content-Type": "image/webp" } });
    return new Response(new ReadableStream({ start(controller) { pendingBodies.push(controller); } }), {
      headers: { "Content-Type": "image/webp" },
    });
  } });
  const first = worker.request(optimized(1)), second = worker.request(optimized(2));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingBodies.length, 2);
  const third = await worker.request(optimized(3));
  assert.equal(new Uint8Array(await third.arrayBuffer())[0], 3);
  assert.equal(worker.calls, 3);
  assert.equal((await worker.rows()).length, 0);
  for (const controller of pendingBodies) { controller.enqueue(new Uint8Array([1])); controller.close(); }
  await Promise.all([first, second]);
  assert.equal((await worker.rows()).length, 2, "busy cache skipped only the third image");
  await worker.request(optimized(3));
  assert.equal(worker.calls, 4);
  assert.equal((await worker.rows()).length, 3, "a later visit can persist the skipped image");
});

test("uncacheable responses are returned without cloning their image stream", async () => {
  let clones = 0;
  const worker = harness({ fetch() {
    const response = new Response(new Uint8Array([1]), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "no-store" },
    });
    response.clone = () => { clones += 1; throw Error("Unexpected clone"); };
    return response;
  } });
  assert.equal((await worker.request(optimized(1))).status, 200);
  assert.equal(clones, 0);
});

test("storage, index and client lookup failures preserve successful image requests", async () => {
  for (const options of [{ failStorage: true }, { failIndex: true }, { failClient: true }]) {
    const worker = harness(options);
    assert.equal((await worker.request(optimized(1))).status, 200);
    assert.equal(worker.calls, 1);
    assert.equal(worker.entries.size, 0);
  }
});

function componentHarness({ pathname = "/explore", existing = [], readyState = "complete" } = {}) {
  let effect;
  const registrations = [], listeners = new Map(), exports = {};
  const context = {
    exports, URL,
    window: {
      isSecureContext: true, location: { origin },
      addEventListener(name, handler) { listeners.set(name, handler); },
      removeEventListener(name) { listeners.delete(name); },
    },
    document: { readyState },
    navigator: { serviceWorker: {
      async getRegistrations() { return existing; },
      async register(url, options) { registrations.push({ url, options }); },
    } },
    require(name) {
      if (name === "react") return { useEffect(callback) { effect = callback; } };
      if (name === "next/navigation") return { usePathname: () => pathname };
      throw Error("Unexpected import: " + name);
    },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync("components/experience-media-cache.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  exports.default({ supabaseUrl: mediaOrigin });
  const cleanup = effect();
  return { registrations, listeners, cleanup, async settle() { await new Promise((resolve) => setImmediate(resolve)); } };
}

test("registration waits for load, has no UI or takeover, and preserves scoped/foreign workers", async () => {
  const delayed = componentHarness({ readyState: "loading" });
  assert.equal(delayed.registrations.length, 0);
  delayed.listeners.get("load")();
  await delayed.settle();
  assert.equal(delayed.registrations.length, 1);
  assert.equal(new URL(delayed.registrations[0].url, origin).searchParams.get("mediaOrigin"), mediaOrigin);
  assert.equal(delayed.registrations[0].options.scope, "/");
  const scoped = componentHarness({ existing: [{ scope: origin + "/pos/", active: { scriptURL: origin + "/portable-sw.js" } }, { scope: origin + "/tax-company/", active: { scriptURL: origin + "/tax-company/sw.js" } }] });
  await scoped.settle();
  assert.equal(scoped.registrations.length, 1);
  const foreign = componentHarness({ existing: [{ scope: origin + "/", active: { scriptURL: origin + "/another-sw.js" } }] });
  await foreign.settle();
  assert.equal(foreign.registrations.length, 0);
  const operational = componentHarness({ pathname: "/pos/portable" });
  await operational.settle();
  assert.equal(operational.registrations.length, 0);
  const cancelled = componentHarness({ readyState: "loading" });
  cancelled.cleanup();
  assert.equal(cancelled.listeners.size, 0);
  assert.doesNotMatch(source, /clients\.claim\(|skipWaiting\(/);
});

test("browser renders an image from the visited cache while offline, with live APIs untouched", {
  skip: !process.env.TEST_BROWSER_PATH, timeout: 90000,
}, async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/experience-sw.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(source);
    } else if (path === "/_next/image") {
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public,max-age=3600" });
      response.end(png);
    } else if (path === "/api/explore/feed") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end('{"fresh":true}');
    } else {
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end("<main>Explore</main>");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const base = `http://127.0.0.1:${server.address().port}`;
    await page.goto(base + "/explore");
    await page.evaluate(async (mediaOrigin) => {
      await navigator.serviceWorker.register("/experience-sw.js?mediaOrigin=" + encodeURIComponent(mediaOrigin), { scope: "/" });
      await navigator.serviceWorker.ready;
    }, mediaOrigin);
    assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null, "worker does not seize its initial page");
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    const imagePath = "/_next/image?url=" + encodeURIComponent(publicImage(1)) + "&w=640&q=75";
    const loadImage = (url) => page.evaluate((url) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = url;
      document.body.append(image);
    }), url);
    assert.deepEqual(await loadImage(imagePath), { width: 1, height: 1 });
    await page.waitForFunction(async () => {
      const cache = await caches.open("reylumi-experience-media-v1");
      const index = await cache.match("/__experience-media__/index");
      return index && (await index.json()).length === 1;
    });
    await context.setOffline(true);
    assert.deepEqual(await loadImage(imagePath), { width: 1, height: 1 });
    assert.equal(await page.evaluate(() => fetch("/api/explore/feed").then(() => true, () => false)), false);
    assert.equal(await page.evaluate(async () => {
      const cache = await caches.open("reylumi-experience-media-v1");
      return !!await cache.match("/api/explore/feed");
    }), false);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
