// Real retained-page CSS; horizontal wheel input reproduces the page drift.
// This is browser evidence, separate from UIKit/simulator/device acceptance.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const out = process.env.IOS_SCROLL_EVIDENCE || 'artifacts/ios-scroll-all-pages';
fs.mkdirSync(out, { recursive: true });
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(file => fs.existsSync(file));
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const css = fs.readFileSync('app/local-app/app.css', 'utf8');
const results = [];
try {
  for (const [width, height] of [[320, 667], [390, 844], [430, 932], [844, 390], [768, 1024], [1024, 768]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    // Both fresh and retained (hidden/revealed) pages use this same root.
    await page.setContent(`<style>html,body{margin:0;overflow-x:clip}.app-local-body{height:300px}.app-local-page{box-sizing:border-box}.wide{width:2400px;height:50px}.rail{width:100%;overflow-x:auto;overscroll-behavior-x:contain}.tail{height:2400px}${css}</style><div id="app"><div class="app-local-body"><div class="app-local-page"><div class="wide">Overflowing page content</div><div class="rail"><div class="wide">Payroll periods / wide table</div></div><div class="tail">Vertical page content</div></div></div></div>`);
    const root = page.locator('.app-local-page');
    const rail = page.locator('.rail');
    await page.mouse.move(120, 25);
    await page.mouse.wheel(450, 0);
    await page.waitForTimeout(120);
    let state = await root.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop, mode: getComputedStyle(el).overflowX }));
    assert.equal(state.mode, 'hidden');
    assert.equal(await root.evaluate(el => getComputedStyle(el).scrollbarWidth), 'none');
    assert.equal(state.x, 0, 'Horizontal input must not move the whole retained page');
    await page.mouse.move(120, 75);
    await page.mouse.wheel(450, 0);
    await page.waitForTimeout(120);
    assert.ok(await rail.evaluate(el => el.scrollLeft) > 0, 'Nested horizontal regions remain usable');
    await page.mouse.move(120, 150);
    await page.mouse.wheel(0, 350);
    await page.waitForTimeout(120);
    assert.ok(await root.evaluate(el => el.scrollTop) > 0, 'Vertical user scrolling remains usable');
    await root.evaluate(el => { el.hidden = true; });
    await root.evaluate(el => { el.hidden = false; el.scrollTop = 0; });
    await page.mouse.move(120, 25);
    await page.mouse.wheel(-450, 0);
    await page.waitForTimeout(120);
    assert.equal(await root.evaluate(el => el.scrollLeft), 0);
    // Negative control: the previous overflow:auto reproduces the bug using
    // exactly the same DOM and input. This detects a non-effective fixture.
    // A fresh document prevents Chromium wheel-gesture latching to the earlier
    // vertical/hidden-page gesture from hiding a failing negative control.
    await page.setContent(`<style>html,body{margin:0;overflow-x:clip}.app-local-body{height:300px}.wide{width:2400px;height:50px}${css}.app-local-page{overflow-x:auto!important}</style><div id="app"><div class="app-local-body"><div class="app-local-page"><div class="wide">Previous page behavior</div></div></div></div>`);
    await page.mouse.move(100, 25);
    await page.mouse.wheel(450, 0);
    await page.waitForTimeout(120);
    const previousX = await root.evaluate(el => el.scrollLeft);
    assert.ok(previousX > 0, 'The old horizontal-auto page must reproduce the drift');
    results.push({ width, height, horizontalRootBlocked: true, verticalScroll: true, nestedHorizontalScroll: true, retainedPage: true, previousAutoOffset: previousX });
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'page-scroll-browser.json'), JSON.stringify({ engine: 'Chromium', scope: 'Real shared CSS; synthetic overflowing page fixture; not individual authenticated pages or physical iPhone', results }, null, 2));
  console.log(JSON.stringify({ configurations: results.length, passed: true, negativeControl: 'old overflow:auto reproduced horizontal drift at every size' }));
} finally { await browser.close(); }
