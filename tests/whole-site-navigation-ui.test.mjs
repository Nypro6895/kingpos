import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright-core';
const isWebKit = process.env.TEST_BROWSER_ENGINE === 'webkit';
const launchBrowser = () => isWebKit ? webkit.launch({ headless: true }) : chromium.launch({ args: ['--no-proxy-server'], executablePath: process.env.TEST_BROWSER_PATH, headless: true });

test('production Next navigation retains Market and legal pages without reloading the document or existing assets', { skip: !process.env.TEST_APP_URL || !process.env.TEST_BROWSER_PATH }, async () => {
  const browser = await launchBrowser();
  const measurements = [];
  try {
    for (const width of [390, 412, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const documents = [], assets = [], errors = [], paymentScripts = [];
      page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
        if (request.frame() === page.mainFrame() && new URL(request.url()).origin === new URL(process.env.TEST_APP_URL).origin
          && ['script', 'stylesheet', 'font'].includes(request.resourceType())) assets.push(request.url());
        if (request.resourceType() === 'script' && new URL(request.url()).hostname === 'js.stripe.com') paymentScripts.push(request.url());
      });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${process.env.TEST_APP_URL}/market`);
      // The progressive startup shell intentionally gives way to the final
      // Market component. Test Activity retention of that final component;
      // startup interactivity and handoff have separate focused coverage.
      await page.waitForFunction(() => !document.querySelector('[data-market-startup]') && document.querySelector('[data-reylumi-shell-ready="true"]') && document.querySelector('input[aria-label="Search features"]')?.getClientRects().length);
      // Real keyboard events let selective hydration attach the leaf's input
      // handler before editing; a single fill can mutate streamed DOM only.
      await page.getByRole('textbox', { name: 'Search features', exact: true }).pressSequentially('Payroll', { delay: 25 });
      await page.getByRole('button', { name: 'Clear search', exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Search features', exact: true }).inputValue(), 'Payroll', 'the final Market component accepted the edit before navigation');
      await page.evaluate(() => { window.originalDocument = document; window.originalMarket = document.querySelector('input[aria-label="Search features"]'); });
      const loadedAssets = new Set(assets);
      await page.getByRole('link', { name: 'Privacy', exact: true }).click();
      await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).waitFor();
      // LegalLayout first streams the page in an auth-unresolved fallback.
      // Its final guest shell exposes Login; retain that resolved page node.
      await page.locator('[data-testid="guest-navigation-shell"]').filter({ visible: true }).getByRole('link', { name: 'Login', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).evaluate(element => { window.originalPrivacy = element; });
      const start = performance.now();
      await page.goBack();
      await page.getByRole('textbox', { name: 'Search features', exact: true }).waitFor();
      const elapsedMs = Math.round(performance.now() - start);
      assert.equal(await page.getByRole('textbox', { name: 'Search features', exact: true }).inputValue(), 'Payroll');
      assert.equal(await page.evaluate(() => document === window.originalDocument && document.querySelector('input[aria-label="Search features"]') === window.originalMarket), true);
      await page.getByRole('link', { name: 'Privacy', exact: true }).click();
      await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).evaluate(element => element === window.originalPrivacy), true, 'menu return preserves DOM');
      await page.getByRole('link', { name: 'Community Standards', exact: true }).last().click();
      await page.getByRole('heading', { name: 'Community Standards', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Privacy', exact: true }).click();
      await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).evaluate(element => element === window.originalPrivacy), true, 'three recent routes retain a legal view');
      assert.equal(documents.length, 1);
      assert.deepEqual(paymentScripts, [], 'browsing Market must not download the payment SDK');
      for (const asset of loadedAssets) assert.equal(assets.filter(url => url === asset).length, 1, 'existing JS/CSS is not downloaded again');
      assert.deepEqual(errors, []);
      measurements.push({ viewportWidth: width, marketBackVisibleMs: elapsedMs, documentRequests: documents.length, duplicateInitialAssetRequests: 0 });
      await page.close();
    }
    const output = process.env.TEST_NAVIGATION_ARTIFACT_DIR || 'artifacts/experience-cache';
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'whole-site-navigation-measurements.json'), JSON.stringify({ environment: `production build, desktop ${isWebKit ? 'WebKit' : 'Chromium'} mobile viewports`, measurements }, null, 2));
  } finally { await browser.close(); }
});

test('production sensitive form return clears credentials and receives a fresh server revision', { skip: !process.env.TEST_APP_URL || !process.env.TEST_BROWSER_PATH }, async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    let documentRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++; });
    await page.goto(`${process.env.TEST_APP_URL}/login`);
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('cache-test@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('local-fixture-only');
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await page.getByRole('heading', { name: 'Privacy Policy', exact: true }).waitFor();
    await page.goBack();
    await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
    assert.equal(documentRequests, 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
