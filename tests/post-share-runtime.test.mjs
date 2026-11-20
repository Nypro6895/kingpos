import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function harness(navigator = {}, webkit, origin = "https://reylumi.com") {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/post-share.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, URL, window: { location: { origin }, webkit }, navigator, require(name) { if(name === "./browser-public-origin") return { browserPublicOrigin: () => origin.startsWith("reylumi-app:") ? "https://reylumi.com" : origin }; throw Error("Unexpected dependency "+name); } });
  return () => exports.sharePostLink('/explore/post/123', 'Nail design');
}

test('iPhone uses existing native bridge even if Web Share exists but would fail', async () => {
  let message;
  const share = harness({ share: () => { throw Error('WebKit sharing unavailable'); } }, {
    messageHandlers: { reylumi: { postMessage: value => { message = value; } } },
  });
  assert.equal((await share()).status, 'shared');
  assert.equal(message.action, 'share');
  assert.equal(message.text, 'Nail design\nhttps://reylumi.com/explore/post/123');
});

test('browser opens native share with absolute post URL', async () => {
  let payload;
  assert.equal((await harness({ share: async value => { payload = value; } })()).status, 'shared');
  assert.equal(payload.url, 'https://reylumi.com/explore/post/123');
});

test('failed Web Share falls back to clipboard', async () => {
  let copied;
  const share = harness({ share: async () => { throw { name: 'NotAllowedError' }; }, clipboard: { writeText: async value => { copied = value; } } });
  assert.equal((await share()).status, 'copied');
  assert.equal(copied, 'https://reylumi.com/explore/post/123');
});

test('cancelling share does not copy or report failure', async () => {
  const share = harness({ share: async () => { throw { name: 'AbortError' }; }, clipboard: { writeText: () => assert.fail('unexpected copy') } });
  assert.equal((await share()).status, 'cancelled');
});

test('missing or denied clipboard leaves a selectable URL', async () => {
  for (const navigator of [{}, { clipboard: { writeText: async () => { throw Error('denied'); } } }]) {
    const result = await harness(navigator)();
    assert.equal(result.status, 'manual');
    assert.equal(result.url, 'https://reylumi.com/explore/post/123');
  }
});

test('bridge exception falls back to browser sharing', async () => {
  let called = false;
  const share = harness({ share: async () => { called = true; } }, { messageHandlers: { reylumi: { postMessage: () => { throw Error('unavailable'); } } } });
  assert.equal((await share()).status, 'shared');
  assert.equal(called, true);
});

 test("installed-app sharing keeps the canonical public origin", async () => { let message; await harness({}, {messageHandlers:{reylumi:{postMessage:value=>message=value}}}, "reylumi-app://bundle")(); assert.equal(message.text, "Nail design\nhttps://reylumi.com/explore/post/123"); });
