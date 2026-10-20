import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const source = readFileSync('ios/Reylumi/AppLocalBridge.js', 'utf8');
function fixture(enabled = true, location = { protocol: 'reylumi-app:', hostname: 'bundle' }, reply = { ok: true }) {
  const messages = [], requests = [], snapshot = [{ event: 'context.reject', contextReason: 'workspace-changed', status: 409 }];
  const window = { __reylumiDiagnosticsEnabled: enabled, __reylumiAppLocalContext: { nonce: 'nonce', generation: 'generation', scopeEpoch: 1 },
    __reylumiDiagnostics: { snapshot: () => snapshot },
    webkit: { messageHandlers: { appLocal: { postMessage: async value => { requests.push(value); return reply; } }, reylumi: { postMessage: value => messages.push(value) } } },
    addEventListener() {} };
  window.top = window;
  vm.runInNewContext(source, { window, location, performance: { now: () => 1 }, crypto: webcrypto,
    navigator: {}, document: { addEventListener() {} }, MutationObserver: class { observe() {} },
    requestAnimationFrame() {}, setTimeout() {} });
  return { window, messages, snapshot, requests };
}
test('device diagnostics export is available in enabled local app and requires explicit invocation', () => {
  const f = fixture();
  assert.equal(typeof f.window.__reylumiExportDiagnostics, 'function');
  assert.equal(f.messages.length, 0, 'no background send or automatic report upload');
  f.window.__reylumiExportDiagnostics();
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].action, 'diagnostics-export');
  assert.equal(f.messages[0].entries, f.snapshot);
  assert.deepEqual(Object.keys(f.messages[0]).sort(), ['action', 'entries']);
});
test('disabled diagnostics and hosted pages cannot expose local export', () => {
  for (const f of [fixture(false), fixture(true, { protocol: 'https:', hostname: 'reylumi.com' })]) {
    assert.equal(f.window.__reylumiExportDiagnostics, undefined);
    assert.equal(f.messages.length, 0);
  }
});
test('host cancellation stays cancellation at the JS boundary and never replays a command', async () => {
  const f = fixture(true, undefined, { __hostError: { status: -999, reason: 'cancelled', message: 'Request superseded' } });
  await assert.rejects(f.window.__reylumiAppLocalTransport.request({ id: 'test', kind: 'command', name: 'test.command', args: {} }), error => {
    assert.equal(error.name, 'AbortError'); assert.equal(error.status, -999); assert.equal(error.reason, 'cancelled'); return true;
  });
  assert.equal(f.requests.length, 1);
});
test('actual denial remains denial instead of being mislabeled cancellation', async () => {
  const f = fixture(true, undefined, { __hostError: { status: 403, reason: 'unknown', message: 'Access denied' } });
  await assert.rejects(f.window.__reylumiAppLocalTransport.request({ id: 'test', kind: 'context', args: {} }), error => {
    assert.equal(error.name, 'Error'); assert.equal(error.status, 403); assert.equal(error.reason, undefined); return true;
  });
  assert.equal(f.requests.length, 1);
});
test('scope conflicts preserve their bounded recovery reason without becoming cancellation or replaying a request', async () => {
  const f = fixture(true, undefined, { __hostError: { status: 409, reason: 'stale-scope', message: 'Verify the current workspace' } });
  await assert.rejects(f.window.__reylumiAppLocalTransport.request({ id: 'test', kind: 'read', name: 'owner.today', args: {} }), error => {
    assert.equal(error.name, 'Error'); assert.equal(error.status, 409); assert.equal(error.reason, 'stale-scope'); return true;
  });
  assert.equal(f.requests.length, 1);
});
test('host errors cannot expose arbitrary reason strings', async () => {
  const f = fixture(true, undefined, { __hostError: { status: 409, reason: 'private-workspace-detail', message: 'Verify access' } });
  await assert.rejects(f.window.__reylumiAppLocalTransport.request({ id: 'test', kind: 'read', args: {} }), error => {
    assert.equal(error.name, 'Error'); assert.equal(error.reason, undefined); return true;
  });
});
test('native export recognizes every typed JS admission reason without allowing free-form input', () => {
  const exports = {};
  const code = ts.transpileModule(readFileSync('lib/app-local-context-recovery.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', code)(exports);
  const native = readFileSync('ios/Reylumi/ReylumiLocalDiagnostics.swift', 'utf8');
  const allowed = JSON.parse('[' + native.match(/"contextReason": \[([^\]]+)\]/)[1] + ']');
  assert.deepEqual(allowed, exports.APP_LOCAL_CONTEXT_REASONS);
});
