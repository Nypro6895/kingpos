const test = require('node:test');
const assert = require('node:assert/strict');
const { validConfig } = require('../policy.cjs');
test('online installer uses public HTTPS and cannot enable unsigned automatic updates', () => {
  const config = { origin: 'https://reylumi.com', channel: 'online', updates: false, unsignedUpdates: false };
  assert.equal(validConfig(config).origin, 'https://reylumi.com');
  for (const changes of [{ origin: 'http://localhost:3107' }, { origin: 'https://localhost' }, { updates: true }, { unsignedUpdates: true }]) {
    assert.throws(() => validConfig({ ...config, ...changes }));
  }
});
test('unsigned test updates are restricted to the same local POS server', () => {
  const config = { origin: 'http://localhost:3107', channel: 'test', updates: true, unsignedUpdates: true, updateUrl: 'http://localhost:3107/desktop-updates/' };
  assert.equal(validConfig(config).updates, true);
  for (const updateUrl of ['http://example.com/desktop-updates/', 'http://localhost:3108/desktop-updates/', 'http://localhost:3107/other/', 'http://user:pass@localhost:3107/desktop-updates/']) assert.throws(() => validConfig({ ...config, updateUrl }));
  assert.throws(() => validConfig({ ...config, unsignedUpdates: false }));
});
