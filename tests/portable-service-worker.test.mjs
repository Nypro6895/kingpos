import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function worker(state) {
  const listeners = new Set();
  return {
    state,
    messages: [],
    addEventListener(name, callback) { assert.equal(name, "statechange"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "statechange"); listeners.delete(callback); },
    postMessage(message) { this.messages.push(message); },
    transition(next) { this.state = next; for (const callback of listeners) callback(); },
    get listenerCount() { return listeners.size; },
  };
}

function harness(registration) {
  const rootWorker = worker("activated");
  const calls = [], exports = {};
  let globalReadyReads = 0;
  vm.runInNewContext(ts.transpileModule(readFileSync("lib/portable-service-worker.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    navigator: { serviceWorker: {
      async register(url, options) { calls.push({ url, options }); return registration; },
      get ready() { globalReadyReads += 1; return Promise.resolve({ active: rootWorker, scope: "https://reylumi.example/" }); },
    } },
  });
  return { register: exports.registerPortableServiceWorker, rootWorker, calls, get globalReadyReads() { return globalReadyReads; } };
}

test("a previously resolved root ready promise cannot receive POS prepare during scoped installation", async () => {
  const pending = worker("installing");
  const registration = { active: null, installing: pending, waiting: null };
  const runtime = harness(registration);
  let resolved = false;
  const result = runtime.register().then((value) => { resolved = true; return value; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(resolved, false);
  pending.transition("installed");
  assert.equal(resolved, false);
  registration.active = pending;
  pending.transition("activating");
  assert.equal(resolved, false);
  pending.transition("activated");
  const active = await result;
  active.postMessage({ kind: "portable-prepare", scope: "salon:key" });
  assert.deepEqual(pending.messages, [{ kind: "portable-prepare", scope: "salon:key" }]);
  assert.deepEqual(runtime.rootWorker.messages, []);
  assert.equal(runtime.globalReadyReads, 0);
  assert.equal(runtime.calls[0].url, "/portable-sw.js");
  assert.equal(runtime.calls[0].options.scope, "/pos/");
  assert.equal(pending.listenerCount, 0);
});

test("an existing active POS worker remains usable during an update", async () => {
  const active = worker("activated"), pending = worker("installing");
  const runtime = harness({ active, installing: pending, waiting: null });
  assert.equal(await runtime.register(), active);
  assert.equal(pending.listenerCount, 0);
  assert.equal(runtime.globalReadyReads, 0);
});

test("failed or already-completed installation resolves without leaking listeners", async () => {
  const pending = worker("installing");
  const runtime = harness({ active: null, installing: pending, waiting: null });
  const result = runtime.register();
  await Promise.resolve();
  pending.transition("redundant");
  assert.equal(await result, null);
  assert.equal(pending.listenerCount, 0);
  const alreadyActive = worker("activated");
  const completed = harness({ active: alreadyActive, installing: null, waiting: null });
  assert.equal(await completed.register(), alreadyActive);
  const noWorker = harness({ active: null, installing: null, waiting: null });
  assert.equal(await noWorker.register(), null);
});
