import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { workstationFixture } from './helpers/portable-workstation-fixture.mjs';
import { workstationBrowserServer } from './helpers/portable-workstation-browser.mjs';

test('actual Portable and paired customer UI show typing before Submit and persist customer tip through reload', { timeout: 120000 }, async () => {
  const f = await workstationFixture(), server = await workstationBrowserServer(f, { actualUI: true });
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const output = 'artifacts/portable-paired-devices-20261125/actual-ui'; fs.mkdirSync(output, { recursive: true });
  const staffContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'America/Chicago' });
  const guestContext = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, timezoneId: 'America/Chicago' });
  const errors = [], external = [], measurements = [];
  for (const context of [staffContext, guestContext]) await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === server.origin) return route.continue();
    external.push(route.request().url()); return route.abort('blockedbyclient');
  });
  await staffContext.addCookies(server.staffCookies());
  const staff = await staffContext.newPage(), guest = await guestContext.newPage();
  for (const page of [staff, guest]) { page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); }
  const post = async (context, input) => {
    const response = await context.request.post(server.origin + '/api/pos/workstation', { headers: { Origin: server.origin }, data: input });
    const data = await response.json(); assert.equal(response.status(), 200, JSON.stringify(data)); return data;
  };
  try {
    const station = await post(staffContext, { action: 'create', label: 'Actual UI fixture desk' });
    const code = await post(staffContext, { action: 'code' });
    await post(guestContext, { action: 'pair', code: code.code });
    await Promise.all([staff.goto(server.origin + '/pos/portable'), guest.goto(server.origin + '/pos/customer-display')]);
    await staff.locator('[data-pos-desk-root]').waitFor();
    await staff.getByRole('button', { name: /^Anna/ }).click();
    const keypad = staff.locator('[data-pos-amount-panel]');
    const receiptAmount = guest.locator('[data-customer-display-receipt-amount]').first();
    const admissionDeadline = Date.now() + 5000;
    while ((server.streams.get(code.current.topic)?.size ?? 0) < 2) { if (Date.now() > admissionDeadline) throw Error('Both independent UI streams did not become admitted.'); await new Promise(resolve => setTimeout(resolve, 10)); }
    for (let sample = 0; sample < 20; sample++) {
      const digit = sample % 2 ? '0' : '5', amount = sample % 2 ? '$50.00' : '$5.00';
      if (sample > 0 && sample % 2 === 0) await staff.locator('[data-pos-receipt-line-item]').first().click();
      await guest.evaluate(expected => {
        window.fixturePaint = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { observer.disconnect(); reject(Error('Expected receipt amount did not paint.')); }, 15000);
          const observer = new MutationObserver(() => {
            if (document.querySelector('[data-customer-display-receipt-amount]')?.textContent !== expected) return;
            observer.disconnect(); clearTimeout(timer); requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now()));
          }); observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        });
      }, amount);
      const started = await staff.evaluate(digit => {
        const button = [...document.querySelectorAll('[data-pos-amount-panel] button')].find(button => button.textContent.trim() === digit);
        if (!button) throw Error('Actual keypad button missing.');
        const timestamp = performance.timeOrigin + performance.now(); button.click(); return timestamp;
      }, digit);
      const painted = await guest.evaluate(() => window.fixturePaint);
      measurements.push({ direction: 'actual-staff-click-dispatch-to-customer-mutation-rAF', firstInput: sample === 0, amount, milliseconds: painted - started });
    }
    assert.equal(server.trace.filter(item => item.type === 'request' && item.action === 'submit').length, 0);
    await guest.getByRole('button', { name: 'Tip', exact: true }).click();
    await staff.evaluate(() => {
      window.fixtureTipPaint = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { observer.disconnect(); reject(Error('Durable staff tip did not paint.')); }, 15000);
        const observer = new MutationObserver(() => {
          const durable = Object.entries(localStorage).some(([key, value]) => key.startsWith('kingpos:portable-draft:v1:') && JSON.parse(value).recovery?.draft?.tipInput === '5');
          if (!durable || !document.querySelector('[data-pos-receipt-adjustment="tip"]')?.textContent.includes('$5.00')) return;
          observer.disconnect(); clearTimeout(timer); requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now()));
        }); observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
    });
    const tipStart = await guest.evaluate(() => {
      const button = [...document.querySelectorAll('.customer-checkout-tip-options button')].find(button => button.textContent.includes('10%'));
      if (!button) throw Error('Actual tip suggestion missing.');
      const timestamp = performance.timeOrigin + performance.now(); button.click(); return timestamp;
    });
    const tipPainted = await staff.evaluate(() => window.fixtureTipPaint);
    await guest.getByText(/Tip saved.*\$5\.00/).waitFor();
    await staff.waitForFunction(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('kingpos:portable-draft:v1:') && JSON.parse(value).recovery?.draft?.tipInput === '5'));
    measurements.push({ direction: 'actual-customer-tip-click-to-staff-durable-recovery-and-mutation-rAF', milliseconds: tipPainted - tipStart });
    assert.ok(await staff.locator('[data-pos-receipt-panel]').getByText('$5.00', { exact: true }).count() > 0);
    const intents = server.frames.filter(frame => frame.envelope.kind === 'intent');
    assert.equal(intents.filter(frame => frame.envelope.payload.kind === 'tip').length, 1);
    await staff.reload();
    await staff.locator('[data-pos-desk-root]').waitFor();
    await staff.waitForFunction(() => document.querySelector('[data-pos-receipt-panel]')?.textContent.includes('$50.00') && document.querySelector('[data-pos-receipt-panel]')?.textContent.includes('$5.00'));
    await receiptAmount.filter({ hasText: '$50.00' }).waitFor();
    assert.equal(server.frames.filter(frame => frame.envelope.kind === 'intent' && frame.envelope.payload.kind === 'tip').length, 1, 'staff reload does not repeat a customer mutation');
    if (await guest.getByRole('button', { name: 'Custom tip', exact: true }).count() === 0) await guest.getByRole('button', { name: 'Tip', exact: true }).click();
    await guest.getByRole('button', { name: 'Custom tip', exact: true }).click();
    const custom = guest.getByRole('dialog', { name: 'Custom tip', exact: true });
    await custom.getByLabel('Tip amount ($)', { exact: true }).fill('8');
    await staff.locator('[data-pos-receipt-line-item]').first().click();
    await keypad.getByRole('button', { name: '6', exact: true }).click();
    await keypad.getByRole('button', { name: '0', exact: true }).click();
    await receiptAmount.filter({ hasText: '$60.00' }).waitFor();
    await custom.getByRole('button', { name: 'Done', exact: true }).click();
    await custom.getByRole('alert').filter({ hasText: 'The receipt changed. Please select your tip again.' }).waitFor();
    assert.equal(await staff.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('kingpos:portable-draft:v1:')).map(([, value]) => JSON.parse(value).recovery?.draft?.tipInput).find(Boolean)), '5', 'an edit made against a stale receipt never overwrites the accepted tip');
    await custom.getByLabel('Tip amount ($)', { exact: true }).fill('9');
    await custom.getByRole('button', { name: 'Done', exact: true }).click();
    await guest.getByText(/Tip saved.*\$9\.00/).waitFor();
    await staff.waitForFunction(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('kingpos:portable-draft:v1:') && JSON.parse(value).recovery?.draft?.tipInput === '9'));
    await receiptAmount.filter({ hasText: '$60.00' }).waitFor();
    assert.equal(server.frames.filter(frame => frame.envelope.kind === 'intent' && frame.envelope.payload.kind === 'tip').length, 2, 'only the initial tip and the deliberate retry reach the staff writer');
    const durableBeforeDuplicate = await staff.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('kingpos:portable-draft:v1:')).map(([key, value]) => [key, JSON.parse(value).recovery]));
    const duplicate = await staffContext.newPage(); duplicate.on('pageerror', error => errors.push(error.message));
    await duplicate.goto(server.origin + '/pos/portable');
    await duplicate.locator('[data-pos-desk-root]').waitFor();
    await duplicate.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Submit' && button.disabled));
    assert.equal(await duplicate.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true, 'the actual paired draft slot admits only one browser tab writer');
    assert.deepEqual(await staff.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('kingpos:portable-draft:v1:')).map(([key, value]) => [key, JSON.parse(value).recovery])), durableBeforeDuplicate, 'a second tab cannot replace the first tab durable recovery');
    await duplicate.close();
    assert.equal(await staff.getByRole('button', { name: 'Submit', exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    await Promise.all([staff.screenshot({ path: output + '/portable-staff.png' }), guest.screenshot({ path: output + '/paired-customer-tip.png' })]);
    const typing = measurements.filter(value => value.direction === 'actual-staff-click-dispatch-to-customer-mutation-rAF').map(value => value.milliseconds).sort((a, b) => a - b);
    const typingSummary = { samples: typing.length, firstInput: measurements[0].milliseconds, min: typing[0], p50: typing[Math.ceil(typing.length * .5) - 1], p95: typing[Math.ceil(typing.length * .95) - 1], max: typing.at(-1) };
    fs.writeFileSync(output + '/result.json', JSON.stringify({ passed: true, stationId: station.current.id, actualComponents: ['PosDeskClient', 'usePortableDraft', 'PortableWorkspaceStateProvider', 'PairedCustomerDisplay', 'CustomerDisplayClient', 'CustomerCheckoutTip'], actualApiRouteAndWorkstationSQL: true, independentBrowserContexts: 2, realLocalStorageAndIndexedDB: true, duplicateTabWriterBlocked: true, submitClicked: false, tipSurvivesStaffReload: true, duplicateTipAfterReload: false, simultaneousReceiptEditAndCustomTip: 'stale edit rejected; intentional retry accepted without replacing service amount', measurementMethod: 'Browser performance.timeOrigin+performance.now at actual click dispatch; receiver MutationObserver then requestAnimationFrame; connections admitted before first input; Playwright orchestration excluded', typingSummary, measurements, boundaryAdapters: ['existing Portable login authority', 'legacy draft cloud acknowledgement', 'Supabase realtime delivery over loopback SSE', 'unrelated providers unavailable'], excludedAcceptance: ['full Next rendering', 'production provider', 'native/physical device'], browserErrors: errors, externalRequests: external }, null, 2));
    console.log(JSON.stringify({ actualUiControlledTyping: typingSummary, tip: measurements.at(-1) }));
  } catch (error) {
    await Promise.all([staff.screenshot({ path: output + '/staff-failed.png' }), guest.screenshot({ path: output + '/customer-failed.png' })]);
    fs.writeFileSync(output + '/failure.json', JSON.stringify({ error: error.message, staff: await staff.locator('body').innerText(), customer: await guest.locator('body').innerText(), trace: server.trace, errors }, null, 2));
    throw error;
  } finally { await browser.close(); await server.close(); await f.close(); }
});
