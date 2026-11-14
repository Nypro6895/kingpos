import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../ios/Reylumi/PortableDeviceBridge.js', import.meta.url), 'utf8');
function fixture({ subframe = false, reply } = {}) {
  const handlers = new Map();
  const calls = [];
  const values = new Map();
  let failWrite = false;
  const window = {
    __reylumiPortableHost: { nonce: 'document-nonce' },
    addEventListener(name, callback) { handlers.set(name, callback); },
    webkit: { messageHandlers: { portableDevice: { async postMessage(body) { calls.push(body); return reply ? reply(body) : body.action === 'writer.acquire' ? { acquired: true, token: 'native-writer-token' } : { ok: true }; } } } },
    prompt(input) {
      const body = JSON.parse(input.slice('__reylumiPortableDevice:'.length));
      calls.push(body);
      if (body.action === 'storage.get') return JSON.stringify({ ok: true, value: values.get(body.key) ?? null });
      if (failWrite) return JSON.stringify({ ok: false, error: 'Disk full', code: 'storage-unavailable' });
      if (body.action === 'storage.set') values.set(body.key, body.value);
      if (body.action === 'storage.remove') values.delete(body.key);
      return JSON.stringify({ ok: true });
    },
  };
  window.top = subframe ? {} : window;
  const location = { pathname: '/pos/portable', search: '', hash: '' };
  vm.runInNewContext(source, { window, location });
  return { device: window.__reylumiPortableDevice, calls, values, fire(name) { handlers.get(name)?.(); }, fail() { failWrite = true; } };
}

test('native storage cannot acknowledge writes before admission or after lock/reset', async () => {
  const f = fixture();
  assert.throws(() => f.device.storage.set('draft', 'ticket'), /unlock POS Portable/);
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  f.device.storage.set('draft', 'ticket');
  assert.equal(f.values.get('draft'), 'ticket');
  assert.equal(f.device.storage.get('draft'), 'ticket');
  f.fire('kingpos:portable-lock');
  assert.throws(() => f.device.storage.get('draft'), /unlock POS Portable/);
  assert.equal(f.values.get('draft'), 'ticket', 'locking preserves the committed draft');
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  f.fire('reylumi:app-local-reset');
  assert.throws(() => f.device.storage.get('draft'), /unlock POS Portable/);
});

test('failed synchronous commit throws and does not pretend a draft was saved', async () => {
  const f = fixture();
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  f.fail();
  assert.throws(() => f.device.storage.set('draft', 'unsaved'), /Disk full/);
  assert.equal(f.values.has('draft'), false);
});

test('requests bind immutable native nonce/current path and bridge is absent in subframes', async () => {
  const f = fixture();
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device', nonce: 'forged', version: 5, path: '/admin' });
  f.device.storage.get('draft');
  assert.ok(f.calls.every(call => call.nonce === 'document-nonce' && call.version === 1 && call.path === '/pos/portable'));
  assert.equal(fixture({ subframe: true }).device, undefined);
});

test('synchronous draft writes carry the native writer token and release drops it', async () => {
  const f = fixture();
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  const claim = await f.device.request({ action: 'writer.acquire', scope: 'salon:device', key: 'draft' });
  f.device.storage.set('draft', 'owned');
  assert.equal(f.calls.at(-1).writerToken, claim.token);
  await f.device.request({ action: 'operations.save', operation: { kind: 'receipt', payload: { localDraftKey: 'draft' } } });
  assert.equal(f.calls.at(-1).writerToken, claim.token, 'a queued receipt must prove ownership before checkpointing its draft');
  await f.device.request({ action: 'writer.release', key: 'draft', token: claim.token });
  f.device.storage.set('draft', 'unowned');
  assert.equal(f.calls.at(-1).writerToken, undefined);
  f.fire('kingpos:native-writer-reset');
  assert.throws(() => f.device.storage.get('draft'), /unlock POS Portable/);
});

test('late preparation cannot unlock after reset and a stale acquire cannot replace a newer token', async () => {
  let resolvePrepare, resolveAcquire;
  let preparations = 0, acquisitions = 0;
  const f = fixture({ reply: body => {
    if (body.action === 'storage.prepare' && ++preparations === 1) return new Promise(resolve => { resolvePrepare = resolve; });
    if (body.action === 'writer.acquire' && ++acquisitions === 1) return new Promise(resolve => { resolveAcquire = resolve; });
    if (body.action === 'writer.acquire') return { acquired: true, token: 'new-token' };
    return { ok: true };
  } });
  const oldPrepare = f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  f.fire('kingpos:native-writer-reset');
  resolvePrepare({ ok: true });
  await assert.rejects(oldPrepare, /POS session changed/);
  assert.throws(() => f.device.storage.get('draft'), /unlock POS Portable/);
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  const oldAcquire = f.device.request({ action: 'writer.acquire', scope: 'salon:device', key: 'draft' });
  f.fire('reylumi:app-local-reset');
  await f.device.request({ action: 'storage.prepare', scope: 'salon:device' });
  await f.device.request({ action: 'writer.acquire', scope: 'salon:device', key: 'draft' });
  resolveAcquire({ acquired: true, token: 'old-token' });
  await assert.rejects(oldAcquire, /POS session changed/);
  f.device.storage.set('draft', 'current');
  assert.equal(f.calls.at(-1).writerToken, 'new-token');
  assert.ok(f.calls.some(call => call.action === 'writer.release' && call.token === 'old-token'));
});
