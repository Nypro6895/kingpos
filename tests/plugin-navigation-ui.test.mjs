import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { pluginNavigationPreview } from './fixtures/plugin-navigation-preview.mjs';

test('Advertising is discoverable in both More menus; entering opens only the activation popup; installed and owner gates remain', async () => {
  const server = await pluginNavigationPreview();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const path of ['/more', '/dropdown']) {
      await page.goto(base + path);
      const advertising = page.getByRole('link', { name: /Advertising/ });
      await advertising.waitFor();
      assert.equal(await advertising.getAttribute('href'), '/campaigns');
      assert.equal(await page.getByRole('dialog').count(), 0);
      await advertising.click();
      const dialog = page.getByRole('dialog', { name: 'Advertising', exact: true });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole('link', { name: 'Open Market' }).getAttribute('href'), '/market?q=Campaigns');
      assert.deepEqual(await page.evaluate(() => window.reads), ['owner:false', 'wallet']);
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.doesNotMatch(await page.locator('main').innerText(), /Market/);
      await page.getByRole('button', { name: 'Activate', exact: true }).click();
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
      // Cached route restoration must reopen the prompt, without a stale close event hiding it.
      await page.evaluate(() => window.setPageVisible(false));
      await page.locator('main').waitFor({ state: 'hidden' });
      await page.evaluate(() => window.setPageVisible(true));
      await dialog.waitFor();
      await page.keyboard.press('Escape');
    }
    for (const role of ['staff', 'personal']) for (const path of ['/more', '/dropdown']) {
      await page.goto(`${base}${path}?role=${role}`);
      await page.getByRole('link', { name: 'View all settings' }).waitFor();
      assert.equal(await page.getByRole('link', { name: /Advertising/ }).count(), 0);
    }
    await page.goto(base + '/campaigns?active=1');
    await page.locator('[data-installed-workspace]').waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.reads), ['owner:false', 'wallet', 'settings', 'owner:true', 'campaigns']);
    await page.goto(base + '/campaigns?denied=1');
    await page.getByText('Redirected', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.redirected), '/my-place');
    assert.deepEqual(await page.evaluate(() => window.reads), ['owner:false']);
    await page.goto(base + '/campaigns?vi=1');
    await page.getByRole('dialog', { name: 'Quảng cáo', exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
