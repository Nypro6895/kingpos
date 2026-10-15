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

async function fixture({ authenticated = true, expired = false, valid = true, unavailable = false, admin = false, adminExpired = false, serviceUnavailable = false, sessionFetch } = {}) {
  const effects = [], states = [], calls = [], cacheResets = [], invalidations = [], events = [];
  const window = {
    location: new URL(`https://app.test/${admin ? "admin" : "settings"}`),
    fetch: async (input) => {
      calls.push(String(input));
      if (String(input).startsWith("/api/auth/session")) {
        if (sessionFetch) return sessionFetch();
        if (unavailable) throw new Error("offline");
        return Response.json({ authenticated: valid, adminExpired }, { status: serviceUnavailable ? 503 : 200 });
      }
      return new Response(null, { status: input === "/api/auth/logout" || input === "/settings" ? 200 : 401 });
    },
    setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: event => events.push(event.type),
  };
  const original = window.fetch;
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, window, navigator: { onLine: true }, URL, Request, Headers, Event, HTMLElement: class {},
    document: { body: { style: { overflow: "" } }, visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    require: (name) => name === "react" ? {
      useState: () => [expired, value => states.push(value)],
      useRef: value => ({ current: value }), useEffect: fn => effects.push(fn),
    } : name === "react/jsx-runtime" ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      : name === "react-dom" ? { createPortal: child => child }
      : name === "@/lib/reset-experience-cache" ? { resetExperienceCaches: options => cacheResets.push(options) }
      : name === "@/lib/experience-resource-cache" ? { invalidateExperienceResources: options => invalidations.push(options) } : {},
  });
  const rendered = exports.SessionExpiryPrompt({ authenticated });
  const cleanups = effects.map(fn => fn());
  await new Promise(resolve => setImmediate(resolve));
  return { window, states, calls, cacheResets, invalidations, events, original, rendered, setValid: value => { valid = value; }, cleanup: () => cleanups.forEach(fn => fn?.()) };
}

test("expired session opens the login prompt and restores fetch on cleanup", async () => {
  const f = await fixture({ valid: false });
  assert.deepEqual(f.states, [true]);
  assert.equal(f.cacheResets[0].reason, 'expired');
  assert.equal(f.cacheResets[0].suspend, true);
  await f.window.fetch('/api/notifications');
  assert.equal(f.cacheResets.length, 1, 'repeat expiry checks must not repeatedly clear/broadcast');
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
  assert.equal(f.invalidations.length, 1);
  assert.deepEqual(f.events, ['reylumi:experience-mutation']);
  f.cleanup();
});

test("intentional logout stops expiry checks", async () => {
  const f = await fixture();
  await f.window.fetch("/api/auth/logout");
  await f.window.fetch("/api/notifications");
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 1);
  assert.ok(!f.states.includes(true));
  assert.equal(f.cacheResets.length, 1, "confirmed logout clears the old viewer's browsing snapshots");
  assert.equal(f.cacheResets[0].reason, 'logout');
  assert.equal(f.cacheResets[0].broadcast, true);
  assert.equal(f.invalidations.length, 0, 'logout is suspended rather than ordinary mutation invalidation');
  f.cleanup();
});

test("external unauthorized responses do not trigger login", async () => {
  const f = await fixture();
  await f.window.fetch("https://other.test/api");
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 1);
  f.cleanup();
});

test("admin expiry requests reauthentication while the personal session is still valid", async () => {
  const f = await fixture({ admin: true, adminExpired: true });
  assert.deepEqual(f.states, [true]);
  assert.ok(f.calls.includes("/api/auth/session?scope=admin"));
  assert.ok(!f.calls.includes("/api/auth/admin-activity"));
  f.cleanup();
});

test("temporary service errors never display an expired-session prompt", async () => {
  const f = await fixture({ serviceUnavailable: true, valid: false });
  assert.deepEqual(f.states, []);
  f.cleanup();
});

test("a fresh valid session clears a retained expiry prompt", async () => {
  const f = await fixture({ valid: false });
  f.setValid(true);
  await f.window.fetch("/api/notifications");
  assert.deepEqual(f.states, [true, false]);
  assert.equal(f.cacheResets.length, 1, "validity does not resume or seed private caches; the scope provider owns that");
  f.cleanup();
});

test("a session check completed after logout cannot reopen the expired prompt", async () => {
  let resolveSession;
  const f = await fixture({ sessionFetch: () => new Promise(resolve => { resolveSession = resolve; }) });
  await f.window.fetch("/api/auth/logout");
  resolveSession(Response.json({ authenticated: false }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.states, [false]);
  assert.deepEqual(f.cacheResets.map(reset => reset.reason), ["logout"]);
  f.cleanup();
});

test("a session response completed after Activity cleanup cannot invalidate a restored view", async () => {
  let resolveSession;
  const f = await fixture({ sessionFetch: () => new Promise(resolve => { resolveSession = resolve; }) });
  f.cleanup();
  resolveSession(Response.json({ authenticated: false }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.states, []);
  assert.deepEqual(f.cacheResets, []);
});

test("a check started before successful login cannot expire the renewed session", async () => {
  let count = 0, resolveSession;
  const f = await fixture({ expired: true, sessionFetch: () => ++count === 1 ?
    Promise.resolve(Response.json({ authenticated: false })) : new Promise(resolve => { resolveSession = resolve; }) });
  const oldRequest = f.window.fetch("/api/notifications");
  await new Promise(resolve => setImmediate(resolve));
  const login = f.rendered.props.children.find(child => child.props.onAuthenticated);
  login.props.onAuthenticated();
  resolveSession(Response.json({ authenticated: false }));
  await oldRequest;
  assert.deepEqual(f.states, [true, false]);
  assert.deepEqual(f.cacheResets.map(reset => reset.reason), ["expired", "identity"]);
  f.cleanup();
});
