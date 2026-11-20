import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

test('Android Back respects native dialog guards and closes the front dialog before More', async () => {
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `
      <details open data-dismissible-popover><summary>More</summary>Menu</details>
      <dialog><button aria-label="Close panel">Close</button><input value="Draft"></dialog>
      <script>window.reylumiAndroid={postMessage(){}};window.busy=true;
      const dialog=document.querySelector('dialog');dialog.addEventListener('cancel',e=>{if(window.busy)e.preventDefault()});dialog.showModal();</script>` }));
    await page.goto('https://reylumi.com/help');
    await page.addScriptTag({ content: readFileSync('android/app/src/main/assets/NativeBridge.js', 'utf8') });
    assert.equal(await page.evaluate(() => window.__reylumiAndroidBack()), true);
    assert.equal(await page.locator('dialog').evaluate(e => e.open), true, 'pending dialog must stay open');
    assert.equal(await page.locator('details').evaluate(e => e.open), true, 'background More must stay open');
    await page.evaluate(() => { window.busy = false; window.__reylumiAndroidBack(); });
    assert.equal(await page.locator('dialog').evaluate(e => e.open), false);
    assert.equal(await page.locator('details').evaluate(e => e.open), true);
    assert.equal(await page.evaluate(() => window.__reylumiAndroidBack()), true);
    assert.equal(await page.locator('details').evaluate(e => e.open), false);
    assert.equal(await page.evaluate(() => window.__reylumiAndroidBack()), false);
    await page.evaluate(() => {
      const panel=document.createElement('section');panel.role='dialog';
      panel.innerHTML='<button aria-label="Close reschedule">Close</button>';
      panel.querySelector('button').onclick=()=>panel.remove();document.body.appendChild(panel);
      window.__reylumiAndroidBack();
    });
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
  } finally { await browser.close(); }
});
