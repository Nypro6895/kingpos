import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { chromium } from "playwright-core";

test("production Market retains fast edits when Activity hides before the remembered snapshot is ready", { skip: !process.env.TEST_APP_URL || !process.env.TEST_BROWSER_PATH, timeout: 60000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true, args: ["--no-proxy-server"] });
  const measurements = [];
  try {
    for (const width of [390, 412, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      await page.addInitScript(() => {
        const nativeRAF = requestAnimationFrame, nativeCancel = cancelAnimationFrame;
        const frames = new Map(); let sequence = 1000000;
        window.holdMarketMemoryFrames = true;
        window.requestAnimationFrame = callback => {
          // Pause only the optional snapshot's two-frame setup; keep layout/auth/router rendering live.
          if (!window.holdMarketMemoryFrames || !callback.toString().includes("restoreOnVisit")) return nativeRAF(callback);
          const id = ++sequence; frames.set(id, callback); return id;
        };
        window.cancelAnimationFrame = id => { if (frames.has(id)) frames.delete(id); else nativeCancel(id); };
        window.releaseMarketMemoryFrames = () => { window.holdMarketMemoryFrames = false; for (const callback of frames.values()) nativeRAF(callback); frames.clear(); };
      });
      const errors = [], paymentScripts = []; let documents = 0;
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
        if (request.resourceType() === "script" && new URL(request.url()).hostname === "js.stripe.com") paymentScripts.push(request.url());
      });
      await page.goto(`${process.env.TEST_APP_URL}/market`);
      await page.waitForFunction(() => !document.querySelector("[data-market-startup]") && document.querySelector('input[aria-label="Search features"]')?.getClientRects().length);
      await page.getByRole("textbox", { name: "Search features", exact: true }).fill("Payroll");
      await page.evaluate(() => { window.retainedMarketInput = document.querySelector('input[aria-label="Search features"]'); });
      await page.getByRole("link", { name: "Privacy", exact: true }).click();
      await page.getByRole("heading", { name: "Privacy Policy", exact: true }).waitFor();
      await page.goBack();
      await page.getByRole("textbox", { name: "Search features", exact: true }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "Search features", exact: true }).inputValue(), "Payroll");
      assert.equal(await page.getByRole("textbox", { name: "Search features", exact: true }).evaluate(input => input === window.retainedMarketInput), true);
      await page.evaluate(() => window.releaseMarketMemoryFrames());
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole("textbox", { name: "Search features", exact: true }).inputValue(), "Payroll");
      assert.equal(documents, 1);
      assert.deepEqual(paymentScripts, [], "fast navigation must not initialize an unused payment SDK");
      assert.deepEqual(errors, []);
      measurements.push({ width, documentRequests: documents, queryRetainedBeforeAndAfterSnapshotResume: true });
      await page.close();
    }
    mkdirSync("artifacts/startup-progressive", { recursive: true });
    writeFileSync("artifacts/startup-progressive/market-navigation-race.json", JSON.stringify(measurements, null, 2));
  } finally { await browser.close(); }
});
