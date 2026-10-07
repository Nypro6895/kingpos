import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { outputText } = ts.transpileModule(readFileSync("components/session-expiry-prompt.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});

async function fixture({ authenticated = true, valid = true, unavailable = false } = {}) {
  const effects = [], states = [], calls = [];
  const window = {
    location: new URL("https://app.test/settings"),
    fetch: async (input) => {
      calls.push(String(input));
      if (input === "/api/auth/session") {
        if (unavailable) throw new Error("offline");
        return Response.json({ authenticated: valid });
      }
      return new Response(null, { status: input === "/api/auth/logout" || input === "/settings" ? 200 : 401 });
    },
    setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {},
  };
  const original = window.fetch;
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, window, navigator: { onLine: true }, URL, Request, Headers,
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    require: (name) => name === "react" ? {
      useState: () => [false, value => states.push(value)],
      useRef: value => ({ current: value }), useEffect: fn => effects.push(fn),
    } : {},
  });
  exports.SessionExpiryPrompt({ authenticated });
  const cleanups = effects.map(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  return { window, states, calls, original, cleanup: () => cleanups.forEach(fn => fn?.()) };
}

test("expired session opens the login prompt and restores fetch on cleanup", async () => {
  const f = await fixture({ valid: false });
  assert.deepEqual(f.states, [true]);
  f.cleanup();
  assert.equal(f.window.fetch, f.original);
});

test("guest visitors are not treated as expired sessions", async () => {
  const f = await fixture({ authenticated: false, valid: false });
  await f.window.fetch("/api/notifications");
  assert.deepEqual(f.states, []);
  assert.ok(!f.calls.includes("/api/auth/session"));
  f.cleanup();
});

test("permission failures with a valid session do not open login", async () => {
  const f = await fixture();
  await f.window.fetch("/api/pos/owner/reports");
  assert.deepEqual(f.states, []);
  f.cleanup();
});

test("connection failures do not open login", async () => {
  const f = await fixture({ unavailable: true });
  assert.deepEqual(f.states, []);
  f.cleanup();
});

test("login validation errors do not trigger another session check", async () => {
  const f = await fixture();
  await f.window.fetch("/api/auth/login");
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 1);
  assert.deepEqual(f.states, []);
  f.cleanup();
});

test("server action responses check the session even with HTTP 200", async () => {
  const f = await fixture();
  await f.window.fetch("/settings", { method: "POST", headers: { "Next-Action": "action-id" } });
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 2);
  f.cleanup();
});

test("intentional logout stops expiry checks", async () => {
  const f = await fixture();
  await f.window.fetch("/api/auth/logout");
  await f.window.fetch("/api/notifications");
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 1);
  assert.ok(!f.states.includes(true));
  f.cleanup();
});

test("external unauthorized responses do not trigger login", async () => {
  const f = await fixture();
  await f.window.fetch("https://other.test/api");
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 1);
  f.cleanup();
});
