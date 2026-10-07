import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("artifacts/explore-continuation-qa", { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const results = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://localhost:3000/explore", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `artifacts/explore-continuation-qa/${viewport.width}-initial.png` });
    const heights = [];
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(900);
      heights.push(await page.evaluate(() => document.documentElement.scrollHeight));
      if (await page.locator('[data-testid="explore-discovery-continuation"]:visible').count() && (await page.getByText("You've explored the available results.", { exact: false }).isVisible().catch(() => false))) break;
    }
    await page.screenshot({ path: `artifacts/explore-continuation-qa/${viewport.width}-continued.png` });
    results.push({ viewport, url: page.url(), heights, horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), duplicateKeys: await page.locator("[data-feed-key]:visible").evaluateAll(nodes => { const keys = nodes.map(node => node.dataset.feedKey); return keys.length - new Set(keys).size; }), cards: await page.locator('[data-feed-key]:visible').count(), continuation: await page.locator('[data-testid="explore-discovery-continuation"]:visible').count(), errors, tail: (await page.locator("body").innerText()).slice(-800) });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile("artifacts/explore-continuation-qa/results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
