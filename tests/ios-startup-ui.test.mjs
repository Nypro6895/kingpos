import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const bridge = readFileSync("ios/Reylumi/NativeBridge.js", "utf8");

test("iOS readiness bridge reveals interactive first screen while a slow image still blocks window load", { timeout: 45000, skip: !existsSync(executablePath) }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-proxy-server"] });
  let releaseImage;
  const imageGate = new Promise(resolve => { releaseImage = resolve; });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failures = [];
    page.on("pageerror", error => failures.push(error.message));
    await page.addInitScript({ content: `
      window.nativeMessages=[];window.loadCompleted=false;
      window.addEventListener('load',()=>{window.loadCompleted=true});
      window.webkit={messageHandlers:{reylumi:{postMessage:message=>{
        window.nativeMessages.push(message);
        if(message.action==='screen-ready'&&message.generation===1&&message.nonce==='12345678-1234-4234-8234-123456789abc')document.getElementById('launch').hidden=true;
      }}}};
      ${bridge}
    ` });
    await page.route("https://reylumi.com/**", async route => {
      if (new URL(route.request().url()).pathname === "/slow.png") {
        await imageGate;
        await route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR9kAAAAASUVORK5CYII=", "base64") });
      } else {
        await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body><div id="launch" style="position:fixed;inset:0;background:white;z-index:9">Native public shell</div><main id="core"><h1>Explore</h1><button id="core-action" onclick="document.getElementById('clicked').textContent='Opened'">Find services</button><output id="clicked"></output><img src="/slow.png" width="300" height="300" loading="eager" alt="Slow first image"></main><script>setTimeout(()=>{document.getElementById('core').setAttribute('data-reylumi-shell-ready','true');window.dispatchEvent(new Event('reylumi:screen-ready'))},30)</script></body></html>` });
      }
    });
    await page.goto("https://reylumi.com/explore", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.__reylumiStartup.setNavigationContext({ origin: location.origin, generation: 1, nonce: "12345678-1234-4234-8234-123456789abc" }));
    await page.waitForFunction(() => document.getElementById("launch").hidden);
    assert.equal(await page.evaluate(() => window.loadCompleted), false, "ready must not wait for slow load-blocking media");
    assert.equal(await page.evaluate(() => window.nativeMessages.filter(message => message.action === "screen-ready").length), 1);
    await page.locator("#core-action").click();
    assert.equal(await page.locator("#clicked").innerText(), "Opened");
    releaseImage();
    await page.waitForFunction(() => window.loadCompleted);
    assert.equal(await page.evaluate(() => window.nativeMessages.filter(message => message.action === "screen-ready").length), 1);
    assert.deepEqual(failures, []);
  } finally { releaseImage(); await browser.close(); }
});
