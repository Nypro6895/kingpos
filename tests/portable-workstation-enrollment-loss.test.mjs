import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function clientFixture(status) {
  const exports = {}, listeners = new Map(), retries = [], events = [];
  let requests = 0;
  const surface = { addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); } };
  const compiled = ts.transpileModule(fs.readFileSync("lib/portable-workstation-client.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, {
    exports, require: name => name.endsWith("app-local-host") ? { getAppLocalHost: () => ({ isNative: false }), appLocalRequestId: () => "synthetic-request" }
      : name.endsWith("supabase/browser") ? { createSupabaseBrowserClient: () => null } : {},
    window: surface, document: { ...surface, visibilityState: "visible" },
    fetch: async url => { requests++; assert.equal(url, "/api/pos/workstation?role=customer"); return Response.json({ error: "Synthetic connection failure" }, { status }); },
    AbortSignal, Response, TextEncoder, Uint8Array, Map, Set, atob, btoa, queueMicrotask,
    setTimeout: (callback, delay) => { const entry = { callback, delay }; retries.push(entry); return entry; },
    clearTimeout: entry => { entry.cleared = true; },
  });
  const connection = exports.connectWorkstation({ role: "customer", status: value => events.push(value), enrollmentLost: () => events.push("enrollment-lost") });
  return { connection, listeners, retries, events, requests: () => requests };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test("explicit customer 401 withdraws enrollment once, never reloads or retries automatically", async () => {
  const fixture = clientFixture(401);
  await settled();
  assert.deepEqual(fixture.events, ["connecting", "waiting", "enrollment-lost"]);
  assert.equal(fixture.connection.current(), null);
  assert.equal(fixture.retries.length, 0);
  fixture.listeners.get("online")?.(); fixture.listeners.get("visibilitychange")?.();
  await settled();
  assert.equal(fixture.requests(), 1);
  assert.equal(fixture.events.filter(value => value === "enrollment-lost").length, 1);
  fixture.connection.close();
});
test("temporary network/provider failure preserves enrollment and offers reconnection", async () => {
  const fixture = clientFixture(503);
  await settled();
  assert.deepEqual(fixture.events, ["connecting", "reconnecting"]);
  assert.equal(fixture.retries.length, 1);
  assert.equal(fixture.retries[0].delay, 5000);
  assert.equal(fixture.events.includes("enrollment-lost"), false);
  fixture.connection.close();
  assert.equal(fixture.retries[0].cleared, true);
});
