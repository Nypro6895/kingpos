import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const version = JSON.parse(readFileSync("node_modules/maplibre-gl/package.json", "utf8")).version;
assert.equal(version, "5.24.1", "Only the supplier-confirmed patched 5.x revision is covered by this regression");
const scriptPath = `/api/vendor/maplibre-gl/${version}.js`;
const counts = { legacy: 0, patched: 0 };
const server = createServer((request, response) => {
  if (request.url === "/api/vendor/maplibre-gl") {
    counts.legacy += 1;
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "public,max-age=31536000,immutable" });
    response.end("window.__legacyMapLibreLoaded=true"); return;
  }
  if (request.url === scriptPath) {
    counts.patched += 1;
    response.writeHead(200, { "content-type": "text/javascript", "cache-control": "public,max-age=31536000,immutable", "x-content-type-options": "nosniff" });
    response.end(readFileSync("node_modules/maplibre-gl/dist/maplibre-gl.js")); return;
  }
  if (request.url === "/seed" || request.url === "/patched") {
    response.setHeader("content-type", "text/html");
    response.end(`<html><body><script src="${request.url === "/seed" ? "/api/vendor/maplibre-gl" : scriptPath}"></script></body></html>`); return;
  }
  response.writeHead(404); response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const executablePath = process.env.REYLUMI_CHROMIUM_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync);
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/seed`);
  assert.equal(await page.evaluate(() => window.__legacyMapLibreLoaded), true);
  await page.goto(`${origin}/patched`);
  assert.equal(await page.evaluate(() => window.maplibregl.getVersion()), version);
  assert.equal(await page.evaluate(() => window.__legacyMapLibreLoaded), undefined);
  const result = await page.evaluate(async () => {
    window.__xssExecuted = 0;
    const payload = `<details open onload="window.__xssExecuted++" ontoggle="window.__xssExecuted++">bad</details><img src="/missing" onload="window.__xssExecuted++" onerror="window.__xssExecuted++"><a href="javascript:window.__xssExecuted++" onclick="window.__xssExecuted++">bad URL</a><a href="https://maplibre.org/" target="_blank">Safe credit</a><svg onload="window.__xssExecuted++"></svg>`;
    const fakeMap = { style: { stylesheet: {}, tileManagers: { fixture: { used: true, getSource: () => ({ attribution: payload }) } } }, on() {}, off() {}, _getUIString: value => value, getCanvasContainer: () => document.body };
    const control = new window.maplibregl.AttributionControl({ compact: false });
    const element = control.onAdd(fakeMap);
    document.body.append(element);
    await new Promise(resolve => setTimeout(resolve, 200));
    const nodes = [...element.querySelectorAll("*")];
    const eventAttributes = nodes.flatMap(node => [...node.attributes].filter(attribute => /^on/i.test(attribute.name)).map(attribute => attribute.name));
    return { executed: window.__xssExecuted, eventAttributes, unsafe: element.querySelectorAll('script,svg,details details,a[href^="javascript:"]').length, credit: element.querySelector('a[href="https://maplibre.org/"]')?.textContent };
  });
  assert.deepEqual(result, { executed: 0, eventAttributes: [], unsafe: 0, credit: "Safe credit" });
  assert.deepEqual(counts, { legacy: 1, patched: 1 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, version, checks: ["actual vendor attribution rejects adjacent event attributes and javascript URLs", "benign attribution survives", "old immutable URL seeded, fresh versioned URL fetched", "no script execution or browser errors"], counts }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
