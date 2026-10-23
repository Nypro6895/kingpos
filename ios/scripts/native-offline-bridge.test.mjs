import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../Reylumi/NativeBridge.js', import.meta.url), 'utf8');
const nonce = '12345678-1234-1234-1234-123456789abc';
function fixture(url = 'https://reylumi.com/pos', debug = false) {
  const listeners = new Map();
  const location = new URL(url);
  const messages = [];
  const frames = [];
  const window = {
    webkit: { messageHandlers: { reylumi: { postMessage: value => messages.push(value) } } },
    addEventListener: (name, fn) => listeners.set(name, fn),
    ...(debug ? { __reylumiDebugLocalOrigin: location.origin } : {}),
  };
  const document = { visibilityState: 'visible', querySelectorAll: () => [], addEventListener() {} };
  const context = vm.createContext({ window, document, location, URL, navigator: {}, history: { pushState() {}, replaceState() {} },
    MutationObserver: class { observe() {} }, requestAnimationFrame: callback => frames.push(callback), Date, Number });
  vm.runInContext(source, context);
  return { location, messages, setContext: (generation = 1) => window.__reylumiStartup.setNavigationContext({ origin: location.origin, nonce, generation }),
    sync: window.__reylumiBackgroundSync,
    frame: () => { for (const callback of frames.splice(0)) callback(); },
    event: (name, detail) => listeners.get(name)?.({ detail }) };
}
const lease = path => ({ path, version: 1, expiresAt: new Date(Date.now() + 3600000).toISOString() });

test('ordinary readiness never persists a protected route; complete ACK is nonce scoped', () => {
  const f = fixture();
  f.setContext(4);
  f.event('reylumi:screen-ready');
  assert.equal(f.messages.length, 0);
  f.event('reylumi:offline-ready', lease('/pos'));
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages[0])), { action: 'offline-ready', nonce, generation: 4,
    origin: f.location.origin, ...lease('/pos'), expiresAt: f.messages[0].expiresAt });
});

test('pre-commit ACK waits for native context and reset discards an older prepared route', () => {
  const f = fixture();
  f.event('reylumi:offline-ready', lease('/pos'));
  assert.equal(f.messages.length, 0);
  f.setContext();
  assert.equal(f.messages[0].action, 'offline-ready');
  const reset = fixture();
  reset.event('reylumi:offline-ready', lease('/pos'));
  reset.event('reylumi:offline-clear');
  reset.setContext();
  assert.deepEqual(reset.messages.map(x => x.action), ['offline-clear']);
});

test('expired, absent grant expiry, wrong route, callback and excluded ACKs are refused', () => {
  for (const url of ['https://reylumi.com/pos', 'https://reylumi.com/pos?payment=received', 'https://reylumi.com/pos#secret', 'https://reylumi.com/admin']) {
    const f = fixture(url);
    f.setContext();
    for (const value of [{ path: '/pos', version: 1 }, { ...lease('/pos'), expiresAt: 'invalid' },
      { ...lease('/pos'), expiresAt: new Date(0).toISOString() }, lease('/staff/my-work'), { ...lease('/pos'), version: 2 }]) {
      f.event('reylumi:offline-ready', value);
    }
    assert.equal(f.messages.length, 0, url);
    if (url.includes('?') || url.includes('#') || url.includes('/admin')) {
      f.event('reylumi:offline-ready', lease('/pos'));
      assert.equal(f.messages.length, 0);
    }
  }
});

test('SPA route changes cannot flush an ACK from the previous page', () => {
  const f = fixture();
  f.event('reylumi:offline-ready', lease('/pos'));
  f.location.pathname = '/staff/my-work';
  f.setContext();
  assert.equal(f.messages.length, 0);
  f.event('reylumi:offline-ready', lease('/staff/my-work'));
  assert.equal(f.messages[0].path, '/staff/my-work');
  f.event('reylumi:offline-clear');
  assert.equal(f.messages[1].action, 'offline-clear');
});

test('HTTP bridge is refused except explicit localhost simulator injection', () => {
  assert.equal(fixture('http://localhost:1234/pos').setContext(), false);
  assert.equal(fixture('http://reylumi.com/pos', true).setContext(), false);
  assert.equal(fixture('http://localhost:1234/pos', true).setContext(), true);
});

test('background register and drain require committed context and forward only the fixed contract', () => {
  const f = fixture();
  const scope = 'v3:' + 'a'.repeat(64);
  const config = { scope, key: 'today', endpoint: '/api/experience/today?scope=' + scope,
    expiresAt: lease('/pos').expiresAt, action: 'print', nonce: 'untrusted', extra: 'not-forwarded' };
  assert.equal(f.sync.register(config), false);
  assert.equal(f.sync.drain(scope), false);
  f.setContext(3);
  assert.equal(f.sync.register(config), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages[0])), { scope, key: config.key, endpoint: config.endpoint,
    expiresAt: config.expiresAt, action: 'background-register', nonce, generation: 3, origin: f.location.origin });
  assert.equal(f.sync.drain(scope), true);
  assert.equal(f.messages[1].action, 'background-drain');
  assert.equal(f.sync.register({ ...config, expiresAt: 123 }), false);
  assert.equal(f.sync.drain(null), false);
  f.location.pathname = '/admin';
  assert.equal(f.sync.drain(scope), false);
  assert.equal(f.sync.register(config), false);
});

test('offline support preserves first-frame readiness and duplicate nonce protection', () => {
  const f = fixture();
  f.setContext();
  f.frame(); f.frame();
  assert.equal(f.messages.length, 0, 'a committed document alone is not usable');
  f.event('reylumi:screen-ready');
  f.frame();
  assert.equal(f.messages.length, 0);
  f.frame();
  assert.equal(f.messages[0].action, 'screen-ready');
  f.event('reylumi:screen-ready'); f.frame(); f.frame();
  assert.equal(f.messages.length, 1);
  f.event('reylumi:offline-ready', lease('/pos'));
  assert.equal(f.messages[1].action, 'offline-ready');
});
