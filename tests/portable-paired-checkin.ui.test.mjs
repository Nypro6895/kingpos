import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { workstationFixture, fixtureId } from './helpers/portable-workstation-fixture.mjs';
import { workstationBrowserServer } from './helpers/portable-workstation-browser.mjs';

async function checkinUI(label, run, { staffOnline = true } = {}) {
  const f = await workstationFixture(), server = await workstationBrowserServer(f, { actualUI: true, customerJourney: true });
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const staff = await browser.newContext(), context = await browser.newContext({ viewport: { width: 1194, height: 834 }, hasTouch: true, timezoneId: 'America/Chicago' });
  const output = `artifacts/portable-paired-checkin-20261125/${process.env.PORTABLE_CHECKIN_BASELINE || 'current'}/${label}`; fs.mkdirSync(output, { recursive: true });
  const errors = [];
  await staff.addCookies(server.staffCookies());
  for (const target of [staff, context]) await target.route('**/*', route => new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort('blockedbyclient'));
  const post = async (target, input) => {
    const response = await target.request.post(server.origin + '/api/pos/workstation', { headers: { Origin: server.origin }, data: input });
    const value = await response.json(); assert.equal(response.status(), 200, JSON.stringify(value)); return value;
  };
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
  try {
    const station = await post(staff, { action: 'create', label: 'Check-in fixture desk' });
    const code = await post(staff, { action: 'code' });
    const session = await post(context, { action: 'pair', code: code.code });
    assert.equal(session.serviceCatalog.length, 2, 'real service catalog action normalizes the nonempty RPC result');
    if (staffOnline) await post(staff, { action: 'heartbeat', dirty: false, pending: false, cartId: 'idle-cart', revision: 'idle-revision' });
    await page.goto(server.origin + '/pos/customer-display');
    await page.getByLabel('Phone', { exact: true }).waitFor();
    await run({ page, context, staff, f, server, post, station, output });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: output + '/screen.png' });
    fs.writeFileSync(output + '/result.json', JSON.stringify({ passed: true, baseline: process.env.PORTABLE_CHECKIN_BASELINE ?? 'current', actualPairedUI: true, actualWorkstationAPIAndSQL: true, actualPhoneActionsAndCustomerVisitRouting: true, boundaries: ['existing Portable auth', 'legacy phone/service domain RPC fixture with scoped token and persisted visits', 'Supabase delivery over loopback SSE', 'unrelated providers unavailable'], calls: server.journey.calls, errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: output + '/failed.png' });
    fs.writeFileSync(output + '/failure.json', JSON.stringify({ passed: false, baseline: process.env.PORTABLE_CHECKIN_BASELINE ?? 'current', error: error.message, body: await page.locator('body').innerText(), calls: server.journey.calls, trace: server.trace, errors }, null, 2));
    throw error;
  } finally { server.journey.releasePhone(); server.journey.releaseServices(); await browser.close(); await server.close(); await f.close(); }
}

async function enterPhone(page, phone) { await page.getByLabel('Phone', { exact: true }).pressSequentially(phone); }
async function chooseAndConfirm({ page, f, output }) {
  const services = page.locator('[data-customer-display-service-select]');
  await services.waitFor();
  if (output) await page.screenshot({ path: output + '/welcome-services.png' });
  await services.getByRole('button', { name: /Manicure/ }).click();
  await services.getByRole('button', { name: 'Confirm check-in', exact: true }).click();
  await page.getByRole('heading', { name: "You're checked in!", exact: true }).waitFor();
  const { rows } = await f.db.query('select requested_services from fixture_customer_checkins');
  assert.equal(rows.length, 1); assert.equal(rows[0].requested_services[0].name, 'Manicure');
}

test('paired iPad customer existing phone advances to service choices and saves check-in', { timeout: 45000 }, async () => {
  await checkinUI('existing-phone', async env => { await enterPhone(env.page, '4145550101'); await chooseAndConfirm(env); });
});

test('paired customer preserves the identity-choice business result and opens its services', { timeout: 45000 }, async () => {
  await checkinUI('identity-choice', async env => {
    await enterPhone(env.page, '4145550103');
    await env.page.getByRole('button', { name: /Maya Fixture/ }).click();
    await chooseAndConfirm(env);
  });
});

const emptyPreview = (cartId, revision) => ({ cartId, revision, payload: { customer: null, selectedStaffId: null, staffLines: [], subtotal: 0, total: 0, totalBeforeTip: 0, tip: 0, tax: 0, discount: 0 } });
async function waitForBoundary(ready) { const deadline = Date.now() + 5000; while (!ready()) { if (Date.now() > deadline) throw Error('Expected scoped RPC boundary was not reached.'); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('idle cart changes and reconnect preserve a partially typed new profile and pending service save', { timeout: 45000 }, async () => {
  await checkinUI('profile-services-reconnect', async env => {
    await env.post(env.staff, { action: 'preview', payload: emptyPreview('idle-A', 'r-A') });
    await enterPhone(env.page, '4145550102');
    const profile = env.page.locator('[data-customer-display-create-profile]'); await profile.waitFor();
    await profile.getByLabel('Customer name', { exact: true }).fill('Ja');
    await env.post(env.staff, { action: 'preview', payload: emptyPreview('idle-B', 'r-B') });
    await env.page.evaluate(() => window.fixtureDisconnectStreams());
    await env.page.waitForTimeout(100);
    assert.equal(await profile.getByLabel('Customer name', { exact: true }).inputValue(), 'Ja');
    await profile.getByLabel('Customer name', { exact: true }).fill('Jade Fixture');
    await profile.getByRole('button', { name: 'Continue', exact: true }).click();
    const services = env.page.locator('[data-customer-display-service-select]'); await services.waitFor();
    await services.getByRole('button', { name: /Manicure/ }).click();
    env.server.journey.holdServices = true;
    await services.getByRole('button', { name: 'Confirm check-in', exact: true }).click();
    await waitForBoundary(() => env.server.journey.serviceWaiters.length > 0);
    await env.post(env.staff, { action: 'preview', payload: emptyPreview('idle-C', 'r-C') });
    await env.page.evaluate(() => window.fixtureDisconnectStreams());
    env.server.journey.releaseServices();
    await env.page.getByRole('heading', { name: "You're checked in!", exact: true }).waitFor();
    assert.equal((await env.f.db.query('select requested_services from fixture_customer_checkins')).rows[0].requested_services[0].name, 'Manicure');
  });
});

test('standalone check-in lazily clears an expired completed draft while preserving a still-active closed receipt', { timeout: 45000 }, async () => {
  await checkinUI('closed-draft-gates', async env => {
    await env.f.db.query("update pos_live_drafts set status='closed',reset_at=clock_timestamp()+interval '1 minute' where id=$1", [fixtureId(30)]);
    const blocked = await env.context.request.post(env.server.origin + '/api/pos/workstation', { headers: { Origin: env.server.origin }, data: { action: 'customerAction', command: 'phone', input: { phone: '4145550101', checkInOnly: true } } });
    assert.equal(blocked.status(), 409); assert.equal((await env.f.db.query('select status from pos_live_drafts where id=$1', [fixtureId(30)])).rows[0].status, 'closed');
    assert.equal(env.server.journey.calls.some(call => call.name.startsWith('resolve_customer_display_')), false);
    await env.f.db.query("update pos_live_drafts set reset_at=clock_timestamp()-interval '1 second' where id=$1", [fixtureId(30)]);
    await enterPhone(env.page, '4145550101'); await chooseAndConfirm(env);
    assert.equal((await env.f.db.query('select status from pos_live_drafts where id=$1', [fixtureId(30)])).rows[0].status, 'draft');
    assert.equal(env.server.journey.calls.filter(call => call.name === 'fixture-existing-reader-lazy-reset').length, 1);
  }, { staffOnline: false });
});

test('service and receipt commands require the current enrollment exact approved visit grant', { timeout: 45000 }, async () => {
  await checkinUI('visit-grant-security', async env => {
    const command = (command, input) => env.context.request.post(env.server.origin + '/api/pos/workstation', { headers: { Origin: env.server.origin }, data: { action: 'customerAction', command, input } });
    for (const name of ['services', 'checkin.receipt.issue']) assert.equal((await command(name, { visitId: fixtureId(999), serviceIds: [] })).status(), 403);
    await enterPhone(env.page, '4145550101');
    await env.page.locator('[data-customer-display-service-select]').waitFor();
    const visitId = (await env.f.db.query('select id from fixture_customer_checkins')).rows[0].id;
    assert.equal((await command('services', { visitId: fixtureId(999), serviceIds: [] })).status(), 403);
    assert.equal((await command('checkin.receipt.issue', { visitId: fixtureId(999) })).status(), 403);
    const receipt = await command('checkin.receipt.issue', { visitId }); assert.equal(receipt.status(), 200); assert.equal((await receipt.json()).receipt.visitId, visitId);
    const grants = (await env.context.cookies()).filter(cookie => cookie.name.startsWith('reylumi-check-in-visit-')); assert.equal(grants.length, 1);
    await env.context.addCookies([{ ...grants[0], value: grants[0].value + 'tampered' }]);
    assert.equal((await command('services', { visitId, serviceIds: [] })).status(), 403);
    await env.context.addCookies([grants[0]]);
    await env.post(env.staff, { action: 'code', replace: true });
    assert.equal((await command('services', { visitId, serviceIds: [] })).status(), 401);
    assert.equal((await command('checkin.receipt.issue', { visitId })).status(), 401);
  }, { staffOnline: false });
});

test('out-of-order independent phone replies retain visit-scoped grants for both authorized visits', { timeout: 45000 }, async () => {
  await checkinUI('out-of-order-phone-grants', async env => {
    const phone = number => env.context.request.post(env.server.origin + '/api/pos/workstation', { headers: { Origin: env.server.origin }, data: { action: 'customerAction', command: 'phone', input: { phone: number, name: 'Fixture ' + number, checkInOnly: true } } });
    env.server.journey.holdPhone = true;
    const first = phone('4145550104'); await waitForBoundary(() => env.server.journey.waiters.length === 1);
    const second = phone('4145550105'); await waitForBoundary(() => env.server.journey.waiters.length === 2);
    env.server.journey.waiters.splice(1, 1)[0]();
    const secondReply = await second; assert.equal(secondReply.status(), 200); const secondVisit = (await secondReply.json()).data.visit.id;
    env.server.journey.releasePhone();
    const firstReply = await first; assert.equal(firstReply.status(), 200); const firstVisit = (await firstReply.json()).data.visit.id;
    const grants = (await env.context.cookies()).filter(cookie => cookie.name.startsWith('reylumi-check-in-visit-')); assert.equal(grants.length, 2);
    for (const visitId of [firstVisit, secondVisit]) {
      const response = await env.context.request.post(env.server.origin + '/api/pos/workstation', { headers: { Origin: env.server.origin }, data: { action: 'customerAction', command: 'services', input: { visitId, serviceIds: [fixtureId(801)] } } });
      assert.equal(response.status(), 200); assert.equal((await response.json()).ok, true);
    }
  }, { staffOnline: false });
});

test('paired customer new phone collects name and reaches the same service confirmation', { timeout: 45000 }, async () => {
  await checkinUI('new-phone', async env => {
    await enterPhone(env.page, '4145550102');
    const profile = env.page.locator('[data-customer-display-create-profile]'); await profile.waitFor();
    await profile.getByLabel('Customer name', { exact: true }).fill('Jade Fixture');
    await profile.getByRole('button', { name: 'Continue', exact: true }).click();
    await chooseAndConfirm(env);
  });
});

test('temporary paired-stream reconnect cannot strand an in-flight valid phone submission', { timeout: 45000 }, async () => {
  await checkinUI('pending-phone-reconnect', async env => {
    env.server.journey.holdPhone = true;
    await enterPhone(env.page, '4145550101');
    const deadline = Date.now() + 5000;
    while (!env.server.journey.waiters.length) { if (Date.now() > deadline) throw Error('Phone action did not reach the real resolver boundary.'); await new Promise(resolve => setTimeout(resolve, 10)); }
    await env.page.evaluate(() => window.fixtureDisconnectStreams());
    env.server.journey.releasePhone();
    await chooseAndConfirm(env);
  });
});

test('enrolled standalone customer can check in while employee POS is signed out', { timeout: 45000 }, async () => {
  await checkinUI('staff-signed-out', async env => { await enterPhone(env.page, '4145550101'); await chooseAndConfirm(env); }, { staffOnline: false });
});
