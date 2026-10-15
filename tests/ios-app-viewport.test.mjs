import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const source = readFileSync(new URL('../ios/Reylumi/AppViewport.js', import.meta.url), 'utf8');
const fixture = `<!doctype html><html><head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; } [hidden] { display: none !important; } body { margin: 0; font: 14px Arial; }
    main { display: grid; padding: 12px; }
    fieldset { margin: 0; } input, select, textarea { font-size: 12px; width: 100%; }
    #amount { font-size: 36px; } #checkbox { width: 18px; height: 18px; }
    #scroll-region { overflow-x: auto; } #wide-table { width: 1600px; }
    #map { height: 80px; touch-action: none; }
    #dialog { width: 600px; min-width: 600px; overflow: hidden; background: white; }
    #dialog form { padding: 10px; } #dialog p { height: 60px; }
    #dialog button { min-height: 44px; } #dialog-overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 8px; }
  </style>
</head><body><main><fieldset><legend>Account</legend>
  <input id="email" type="email" aria-label="Email"><input id="amount" type="number" aria-label="Amount">
  <input id="checkbox" type="checkbox"><input id="hidden" type="hidden">
  <select id="select"><option>Service</option></select><textarea id="notes"></textarea>
  <div id="editable" contenteditable="true" style="font-size: 11px">Comment</div>
  </fieldset><p>${'VeryLongCustomerName'.repeat(15)}</p>
  <div id="scroll-region"><table id="wide-table"><tr><td>Report</td><td>Totals</td></tr></table></div>
  <div id="map">Map</div><div style="height: 1300px"></div><button id="last">Last action</button>
</main><div id="dialog-overlay" hidden><div id="dialog" role="dialog" hidden><form>
  <input id="dialog-input" aria-label="Dialog input"><p>Long form</p><p>Long form</p><p>Long form</p>
  <p>Long form</p><p>Long form</p><p>Long form</p><p>Long form</p><button type="button" id="save">Save</button>
</form></div></div></body></html>`;

test('native viewport survives navigation, focus, rotation and small screens without losing actions', {
  skip: !process.env.TEST_BROWSER_PATH,
  timeout: 60000,
}, async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
    const page = await browser.newPage({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ content: `window.webkit = { messageHandlers: { reylumi: { postMessage() {} } } }; ${source}` });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(origin);
    const fontSize = selector => page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const assertViewport = async () => {
      const values = await page.evaluate(() => ({
        content: document.querySelector('meta[name="viewport"]').content,
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        scale: visualViewport.scale,
        touchAction: getComputedStyle(document.documentElement).touchAction,
        styles: document.querySelectorAll('style[data-reylumi-app-viewport]').length,
      }));
      assert.match(values.content, /minimum-scale=1, maximum-scale=1, user-scalable=no/);
      assert.equal(values.scale, 1);
      assert.ok(values.documentWidth <= values.width, JSON.stringify(values));
      assert.equal(values.touchAction, 'pan-x pan-y');
      assert.equal(values.styles, 1);
    };
    await assertViewport();
    for (const field of ['#email', '#select', '#notes', '#editable']) assert.equal(await fontSize(field), 16);
    assert.equal(await fontSize('#amount'), 36, 'Large POS amounts keep their typography');
    assert.equal(await fontSize('#checkbox'), 12, 'Checkboxes are not treated as text inputs');
    assert.equal(await fontSize('#hidden'), 12);
    assert.equal(await page.locator('#map').evaluate(el => getComputedStyle(el).touchAction), 'none');

    // Late head styles, newly mounted editors, and Next.js metadata replacement.
    await page.evaluate(() => {
      history.pushState({}, '', '/settings');
      document.querySelector('meta[name="viewport"]').remove();
      document.querySelector('style[data-reylumi-app-viewport]').remove();
      const meta = document.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=980'; document.head.appendChild(meta);
      const input = document.createElement('input'); input.id = 'late-input'; input.style.fontSize = '10px'; document.querySelector('main').appendChild(input);
    });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#late-input')).fontSize === '16px');
    await assertViewport();
    await page.locator('#late-input').evaluate(el => { el.style.setProperty('font-size', '9px', 'important'); el.focus(); });
    assert.equal(await fontSize('#late-input'), 16, 'Focus repairs font changes immediately');
    await page.evaluate(() => {
      const meta = document.createElement('meta'); meta.name = 'VIEWPORT'; meta.content = 'width=980'; document.head.appendChild(meta);
    });
    await page.waitForFunction(() => [...document.querySelectorAll('meta[name="viewport" i]')].every(el => el.content.includes('maximum-scale=1')));

    for (const { width, height } of [
      { width: 320, height: 568 }, { width: 375, height: 667 },
      { width: 390, height: 844 }, { width: 430, height: 932 },
      { width: 667, height: 375 }, { width: 844, height: 390 },
      { width: 932, height: 430 }, { width: 390, height: 844 },
      { width: 375, height: 280 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize({ width, height });
      await assertViewport();
      assert.ok(await page.locator('#scroll-region').evaluate(el => el.scrollWidth > el.clientWidth), 'Wide reports retain their own scrolling');
      await page.locator('#scroll-region').evaluate(el => { el.scrollLeft = 200; });
      assert.ok(await page.locator('#scroll-region').evaluate(el => el.scrollLeft > 0));
      await page.locator('#last').scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => scrollY > 0), 'Long forms remain vertically scrollable');
      await page.evaluate(() => {
        scrollTo(0, 0);
        document.querySelector('#dialog-overlay').hidden = false;
        document.querySelector('#dialog').hidden = false;
        window.saved = false;
        document.querySelector('#save').onclick = () => { window.saved = true; };
      });
      const box = await page.locator('#dialog').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `Dialog fits width ${width}`);
      assert.ok(box.y >= 0 && box.y + box.height <= height + 1, `Dialog fits height ${height}`);
      await page.locator('#dialog-input').tap();
      assert.equal(await fontSize('#dialog-input'), 16);
      await assertViewport();
      await page.locator('#save').tap();
      assert.equal(await page.evaluate(() => window.saved), true, 'The last dialog action is reachable');
      await page.evaluate(() => { document.querySelector('#dialog-overlay').hidden = true; document.querySelector('#dialog').hidden = true; });
    }
    await page.goto(`${origin}/login`);
    await assertViewport();
    assert.equal(await fontSize('#email'), 16, 'Separate root layout / full navigation is covered');
    assert.deepEqual(errors, []);

    const webPage = await browser.newPage();
    await webPage.setContent(fixture);
    await webPage.addScriptTag({ content: source });
    assert.equal(await webPage.locator('style[data-reylumi-app-viewport]').count(), 0, 'Browser pages do not receive app restrictions');
    assert.equal(await webPage.locator('#email').evaluate(el => getComputedStyle(el).fontSize), '12px');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
