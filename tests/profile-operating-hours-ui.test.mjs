import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
test('hours editor preserves split shifts, adds closed days, handles save failure, and fits mobile', { skip: !process.env.ESBUILD_MODULE_PATH, timeout: 60000 }, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `import React from 'react';import{createRoot}from'react-dom/client';import{OperatingHoursQuick}from'./app/salon-profile/operating-hours-quick';window.saved=[];createRoot(document.getElementById('root')).render(<OperatingHoursQuick salonId="salon"/>);` },
    bundle: true, write: false, outdir: 'fixture', jsx: 'automatic',
    plugins: [{ name: 'stubs', setup(b) {
      b.onResolve({ filter: /operating-hours-actions|next\/navigation/ }, a => ({ path: a.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: a.path.includes('navigation')
        ? 'export const useRouter=()=>({refresh:()=>{window.refreshed=true}});'
        : `export async function loadProfileOperatingHours(){return {canManage:!window.readOnly,settings:{timeZone:'America/Chicago',weeklyHours:[{dayOfWeek:1,opensAtLocal:'09:00',closesAtLocal:'12:00'},{dayOfWeek:1,opensAtLocal:'13:00',closesAtLocal:'17:00'}]}}};export async function saveProfileOperatingHours(id,input){window.saved.push({id,input});return window.fail?{ok:false,error:'Invalid hours'}:{ok:true,error:null}};` }));
    } }],
  });
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH, headless: true });
  try {
    for (const width of [375, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 812 } });
      await page.route('http://localhost/', r => r.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;padding:16px;font-family:Arial}*{box-sizing:border-box}' + result.outputFiles.find(f => f.path.endsWith('.css')).text + '</style><div id="root"></div><script src="/app.js"></script>' }));
      await page.route('**/app.js', r => r.fulfill({ contentType: 'text/javascript', body: result.outputFiles.find(f => f.path.endsWith('.js')).text }));
      await page.goto('http://localhost/');
      await page.getByLabel('Mon opening time 1').waitFor();
      await page.getByLabel('Mon opening time 2').fill('14:00');
      await page.getByRole('button', { name: 'add hours', exact: true }).first().click();
      await page.getByRole('button', { name: 'Save hours', exact: true }).click();
      await page.getByText('Operating hours saved.', { exact: true }).waitFor();
      const saved = await page.evaluate(() => window.saved[0]);
      assert.equal(saved.id, 'salon');
      assert.equal(saved.input.weeklyHours.length, 3);
      assert.equal(saved.input.weeklyHours[1].opensAtLocal, '14:00');
      assert.equal(saved.input.weeklyHours[2].dayOfWeek, 0);
      await page.getByRole('button', { name: 'Remove Sun interval 3', exact: true }).click();
      await page.evaluate(() => { window.fail = true; window.refreshed = false; });
      await page.getByRole('button', { name: 'Save hours', exact: true }).click();
      await page.getByText('Invalid hours', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.refreshed), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.addInitScript(() => { window.readOnly = true; });
      await page.reload();
      await page.getByText('You can view hours. Editing requires salon settings permission.').waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save hours', exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Mon opening time 1').isDisabled(), true);
      await page.close();
    }
  } finally { await browser.close(); }
});
