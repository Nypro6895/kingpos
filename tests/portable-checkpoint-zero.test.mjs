import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sources = new Map([
  ['android', fs.readFileSync(new URL('../android/app/src/main/assets/PortableDeviceBridge.js', import.meta.url), 'utf8')],
  ['ios', fs.readFileSync(new URL('../ios/Reylumi/PortableDeviceBridge.js', import.meta.url), 'utf8')],
]);
const scope = '00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002';
const key = `kingpos:portable-draft:v1:${scope}`;

// Each call evaluates the actual bundled shim in a new document. Only the
// native fixture's committed map survives, as it does across a cold app launch.
function boot(platform, values, reply = body => {
  if (body.action === 'operations.checkpoint') return 0;
  if (body.action === 'operations.list') return [];
  if (body.action === 'writer.acquire') return { acquired: true, token: 'native-owner' };
  return { ok: true };
}) {
  const window = new EventTarget();
  const calls = [];
  window.top = window;
  window.__reylumiPortableHost = { nonce: '00000000-0000-4000-8000-000000000003', documentGeneration: 0 };
  Object.defineProperty(window, 'localStorage', { get() { throw Error('Native persistence must not fall back to browser storage'); } });
  window.prompt = message => {
    const body = JSON.parse(message.slice('__reylumiPortableDevice:'.length));
    calls.push(body);
    if (body.action === 'storage.get') return JSON.stringify({ ok: true, value: values.get(body.key) ?? null });
    if (body.action === 'storage.set') values.set(body.key, body.value);
    if (body.action === 'storage.remove') values.delete(body.key);
    return JSON.stringify({ ok: true });
  };
  if (platform === 'android') {
    window.reylumiPortable = { postMessage(raw) {
      const body = JSON.parse(raw);
      calls.push(body);
      this.onmessage({ data: JSON.stringify({ id: body.id, reply: reply(body) }) });
    } };
  } else {
    window.webkit = { messageHandlers: { portableDevice: { async postMessage(body) { calls.push(body); return reply(body); } } } };
  }
  vm.runInNewContext(sources.get(platform), { window, location: { pathname: '/pos/portable', search: '', hash: '' }, Event, setTimeout, clearTimeout });
  return { device: window.__reylumiPortableDevice, calls };
}

for (const platform of sources.keys()) {
  test(`${platform}: numeric zero checkpoint restores a nonempty committed draft in a cold document`, async () => {
    const values = new Map();
    const draft = JSON.stringify({ schema: 1, savedAt: 1700000000000, outbox: { head: null, next: null }, recovery: { lines: [{ serviceId: 'fixture-service', amount: 25, quantity: 1 }] } });
    const original = boot(platform, values);
    await original.device.request({ action: 'storage.prepare', scope });
    await original.device.request({ action: 'writer.acquire', scope, key });
    original.device.storage.set(key, draft);
    await original.device.request({ action: 'writer.release', scope, key, token: 'native-owner' });

    const cold = boot(platform, values);
    await cold.device.request({ action: 'storage.prepare', scope });
    await cold.device.request({ action: 'writer.acquire', scope, key });
    const checkpoint = await cold.device.request({ action: 'operations.checkpoint', scope, key });
    assert.equal(checkpoint, 0, 'no prior receipt is a valid checkpoint, not a native failure');
    assert.equal(cold.device.storage.get(key), draft, 'cold read preserves the exact nonempty draft');
    assert.ok(JSON.parse(draft).savedAt > checkpoint, 'draft remains eligible for normal recovery');
    assert.equal((await cold.device.request({ action: 'operations.list', scope })).length, 0);
    assert.equal(cold.calls.some(call => call.action === 'storage.remove'), false, 'zero must not discard the saved draft');
    cold.device.storage.set(key, draft);
    assert.equal(cold.calls.at(-1).writerToken, 'native-owner', 'checkpoint zero does not invalidate the live writer');
  });

  test(`${platform}: checkpoint accepts only finite nonnegative numbers and preserves native errors`, async () => {
    for (const invalid of [null, undefined, false, '', '0', -1, NaN, Infinity, {}, []]) {
      const f = boot(platform, new Map(), () => invalid);
      await assert.rejects(f.device.request({ action: 'operations.checkpoint', scope, key }), error => error.code === 'storage-unavailable');
    }
    const positive = boot(platform, new Map(), () => 1700000000000);
    assert.equal(await positive.device.request({ action: 'operations.checkpoint', scope, key }), 1700000000000);
    const denied = boot(platform, new Map(), () => ({ __portableError: { code: 'storage-locked', error: 'Locked fixture' } }));
    await assert.rejects(denied.device.request({ action: 'operations.checkpoint', scope, key }), error => error.code === 'storage-locked' && error.message === 'Locked fixture');
  });

  test(`${platform}: accepting zero checkpoints does not accept zero for object or list replies`, async () => {
    for (const action of ['storage.prepare', 'writer.acquire', 'operations.list']) {
      const f = boot(platform, new Map(), () => 0);
      await assert.rejects(f.device.request({ action, scope, key }), error => error.code === 'storage-unavailable');
    }
    const f = boot(platform, new Map(), () => ({ ok: true }));
    await assert.rejects(f.device.request({ action: 'operations.list', scope }), error => error.code === 'storage-unavailable');
  });
}
