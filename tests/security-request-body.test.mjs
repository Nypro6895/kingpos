import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Response, TextDecoder, Uint8Array, Number, RangeError,
    setTimeout, clearTimeout, require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    } });
  return exports;
}
const body = load('lib/request-body.ts');
const bytes = text => new TextEncoder().encode(text);
function streamed(chunks, headers = {}) {
  let cancelled = false, reads = 0;
  const pending = [...chunks];
  const stream = new ReadableStream({
    pull(controller) { reads++; if (pending.length) controller.enqueue(pending.shift()); else controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { request: new Request('https://fixture.invalid/webhook', { method: 'POST', headers, body: stream, duplex: 'half' }),
    get cancelled() { return cancelled; }, get reads() { return reads; } };
}

test('signed UTF-8 payload is preserved across arbitrary chunk boundaries', async () => {
  const raw = '{ "note": "Móng đẹp 🌼", "a": 1 }\r\n';
  const encoded = bytes(raw);
  const input = streamed([...encoded].map(value => Uint8Array.of(value)));
  assert.equal(await body.readBoundedRequestText(input.request, encoded.length), raw);
});
test('a leading UTF-8 BOM remains part of the raw signed bytes', async () => {
  const raw = '\uFEFF{"note":"fixture"}';
  const original = bytes(raw);
  const decoded = await body.readBoundedRequestText(streamed([original.subarray(0, 1), original.subarray(1)]).request, original.length);
  assert.equal(decoded, raw);
  assert.equal(createHmac('sha256', 'fixture').update(decoded).digest('hex'),
    createHmac('sha256', 'fixture').update(original).digest('hex'));
});
test('actual bytes are bounded for chunked and falsely short Content-Length requests', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const input = streamed([bytes('1234'), bytes('5678'), bytes('unread')], headers);
    await assert.rejects(body.readBoundedRequestText(input.request, 6), error => error.status === 413);
    assert.equal(input.cancelled, true);
    assert.equal(input.reads, 2);
  }
});
test('declared oversized body is rejected without consumption', async () => {
  const input = streamed([bytes('unread')], { 'content-length': '100' });
  await assert.rejects(body.readBoundedRequestText(input.request, 10), error => error.status === 413);
  assert.equal(input.reads, 0);
  assert.equal(input.cancelled, true);
});
test('UTF-8 size, malformed encoding and invalid length are rejected safely', async () => {
  await assert.rejects(body.readBoundedRequestText(streamed([bytes('🌼')]).request, 3), error => error.status === 413);
  await assert.rejects(body.readBoundedRequestText(streamed([Uint8Array.of(0xff)]).request, 10), error => error.status === 400);
  await assert.rejects(body.readBoundedRequestText(streamed([bytes('x')], { 'content-length': '-1' }).request, 10), error => error.status === 400);
});
test('a stalled stream expires and is cancelled', async () => {
  const input = streamed([]);
  let cancelled = false;
  const request = new Request(input.request.url, { method: 'POST', duplex: 'half', body: new ReadableStream({ cancel() { cancelled = true; } }) });
  await assert.rejects(body.readBoundedRequestText(request, 100, 15), error => error.status === 408);
  assert.equal(cancelled, true);
});
test('reader failures return a bounded public failure response', async () => {
  const request = new Request('https://fixture.invalid/webhook', { method: 'POST', duplex: 'half',
    body: new ReadableStream({ pull(controller) { controller.error(Error('private backend detail')); } }) });
  let failure;
  try { await body.readBoundedRequestText(request, 100); } catch (error) { failure = body.requestBodyFailure(error); }
  assert.equal(failure.status, 400);
  assert.equal(failure.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await failure.text(), /private backend/);
});

const secret = 'fixture-secret-not-a-provider-credential';
const signature = text => createHmac('sha256', secret).update(text).digest('hex');
const routes = [
  ['app/api/payments/webhook/route.ts', 1_000_000],
  ['app/api/booking-payment/webhook/route.ts', 262_144],
  ['app/api/campaigns/payment-webhook/route.ts', 262_144],
  ['app/api/market/payment-webhook/route.ts', 1_000_000],
  ['app/api/gift-cards/webhook/route.ts', 1_000_000],
];
for (const [path, limit] of routes) {
  function fixture() {
    const seen = [], processed = [];
    const verify = (raw, value) => { seen.push(raw); return signature(raw) === value; };
    const forbidden = () => { throw Error('Unexpected provider or database operation'); };
    const dependencies = {
      '@/lib/request-body': body, 'next/server': { NextResponse: Response },
      '@/lib/platform-payment': { paymentConfig: async () => ({ webhookSecret: secret }), paymentSignature: verify },
      '@/lib/market-card': { processCardEvent: async id => processed.push(id) },
      '@/lib/booking-deposit': { syncBookingDeposit: forbidden, verifyDepositWebhook: verify },
      '@/lib/campaign-payments': { verifyCampaignWebhook: verify, fulfillCreditPayment: forbidden,
        expireCreditCheckout: forbidden, fulfillCampaignCardSetup: forbidden },
      '@/lib/market-payments': { verifyMarketWebhook: verify, marketServiceClient: forbidden, syncVietnameseSubscription: forbidden },
      '@/lib/gift-card-stripe': { verifyGiftSignature: verify, syncGiftOnline: forbidden },
    };
    for (const [file, name] of [['tax-company-subscription', 'syncTaxCompanySubscription'],
      ['booking-policy-subscription', 'syncBookingPolicySubscription'], ['booking-deposit-subscription', 'syncBookingDepositSubscription'],
      ['checkin-receipt-subscription', 'syncCheckinReceiptSubscription']]) dependencies[`@/lib/${file}`] = { [name]: forbidden };
    return { route: load(path, dependencies), seen, processed };
  }
  test(`${path}: oversized unsigned stream stops before signature/business operations`, async () => {
    const state = fixture();
    const response = await state.route.POST(streamed([new Uint8Array(limit), Uint8Array.of(1)]).request);
    assert.equal(response.status, 413);
    assert.deepEqual(state.seen, []);
    assert.deepEqual(state.processed, []);
  });
  test(`${path}: valid signed body reaches unchanged verification`, async () => {
    const state = fixture();
    const raw = '{ "id":"evt_fixture", "account":"acct_fixture", "type":"fixture.ignored", "data":{"object":{}}, "note":"Đẹp 🌼" }\n';
    const response = await state.route.POST(streamed([bytes(raw)], { 'stripe-signature': signature(raw) }).request);
    assert.equal(response.status, 200);
    assert.deepEqual(state.seen, [raw]);
    if (path.includes('/payments/webhook/')) assert.deepEqual(state.processed, ['evt_fixture']);
  });
  test(`${path}: invalid signature never processes a payment`, async () => {
    const state = fixture();
    const response = await state.route.POST(streamed([bytes('{}')], { 'stripe-signature': 'invalid' }).request);
    assert.equal(response.status, 400);
    assert.deepEqual(state.processed, []);
  });
}
