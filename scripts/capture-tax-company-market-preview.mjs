import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { taxCompanyPreview } from '../tests/fixtures/tax-company-preview.mjs';

// Capture the actual owner page with fictional data and inert server actions.
const server = await taxCompanyPreview();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=settings`);
  await page.getByRole('heading', { name: 'Tax Company settings', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) throw new Error(errors.join('\n'));
  fs.mkdirSync('public/market/features/tax-company', { recursive: true });
  // Element capture excludes the QA banner; the Market caption identifies sample data.
  await page.locator('main').screenshot({ path: 'public/market/features/tax-company/owner-settings-v1.png' });
  console.log('Owner settings screenshot:', await page.locator('main').boundingBox());
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
