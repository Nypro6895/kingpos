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
const mutations = {};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/experience-mutations.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: mutations });

async function fixture({ authenticated = true, expired = false, valid = true, unavailable = false, admin = false, adminExpired = false, serviceUnavailable = false, sessionFetch, responseStatus, responseHeaders = {}, apiFetch } = {}) {
  const effects = [], states = [], calls = [], cacheResets = [], invalidations = [], events = [];
  const window = {
    location: new URL(`https://app.test/${admin ? "admin" : "settings"}`),
    fetch: async (input) => {
      const target = input instanceof Request ? input.url : String(input);
      calls.push(target);
      if (target.startsWith("/api/auth/session")) {
        if (sessionFetch) return sessionFetch();
        if (unavailable) throw new Error("offline");
        return Response.json({ authenticated: valid, adminExpired }, { status: serviceUnavailable ? 503 : 200 });
      }
      const custom = apiFetch?.(target);
      if (custom) return custom;
      return new Response(null, { status: responseStatus ?? (target === "/api/auth/logout" || target === "/settings" ? 200 : 401), headers: responseHeaders });
    },
    setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: event => events.push(event.type),
  };
  const original = window.fetch;
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, window, navigator: { onLine: true }, URL, Request, Headers, Event, CustomEvent, HTMLElement: class {},
    document: { body: { style: { overflow: "" } }, visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    require: (name) => name === "react" ? {
      useState: () => [expired, value => states.push(value)],
      useRef: value => ({ current: value }), useEffect: fn => effects.push(fn),
    } : name === "react/jsx-runtime" ? { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
      : name === "react-dom" ? { createPortal: child => child }
      : name === "@/lib/reset-experience-cache" ? { resetExperienceCaches: options => cacheResets.push(options) }
      : name === "@/lib/experience-resource-cache" ? { invalidateExperienceResources: options => invalidations.push(options) }
      : name === "@/components/experience-scope" ? { useExperienceScope: () => ({ context: { scope: 'account-one' } }) }
      : name === "@/lib/experience-mutations" ? mutations : {},
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

test("server-action reads check the session without invalidating data or restarting page effects", async () => {
  const f = await fixture();
  await f.window.fetch("/settings", { method: "POST", headers: { "Next-Action": "action-id" } });
  assert.equal(f.calls.filter(url => url === "/api/auth/session").length, 2);
  assert.equal(f.invalidations.length, 0);
  assert.deepEqual(f.events, []);
  f.cleanup();
});

test("confirmed server-action writes invalidate the request account and emit the data event", async () => {
  for (const value of ['1', '2']) {
    const f = await fixture({ responseHeaders: { 'x-action-revalidated': value } });
    await f.window.fetch('/settings', { method: 'POST', headers: { 'Next-Action': 'write-action' } });
    assert.equal(f.invalidations.length, 1);
    assert.equal(f.invalidations[0].scope, 'account-one');
    assert.deepEqual(f.events, ['reylumi:experience-mutation']);
    assert.equal(f.calls.filter(url => url === '/api/auth/session').length, 2);
    f.cleanup();
  }
});

test("explicit access changes remain blocking signals, separate from ordinary data refresh", async () => {
  const f = await fixture({ responseHeaders: { 'x-reylumi-experience-change': 'scope' } });
  await f.window.fetch('/settings', { method: 'POST', headers: { 'Next-Action': 'grant-action' } });
  assert.equal(f.invalidations[0].scope, 'account-one');
  assert.deepEqual(f.events, ['reylumi:experience-scope-changed']);
  f.cleanup();
});

test("passive POST responses including campaign delivery never invalidate resources", async () => {
  const f = await fixture({ responseStatus: 200 });
  for (const path of ['/api/explore/search', '/api/explore/feed', '/api/explore/area', '/api/explore/advertising', '/api/public-booking/inspiration-times', '/api/pos/windows-download', '/api/campaigns/delivery']) {
    await f.window.fetch(path, { method: 'POST' });
  }
  assert.deepEqual(f.invalidations, []);
  assert.deepEqual(f.events, []);
  f.cleanup();
});

test("notification writes refresh only their relevant account cache tags", async () => {
  const f = await fixture({ responseStatus: 200 });
  await f.window.fetch('/api/notifications', { method: 'POST' });
  assert.equal(f.invalidations[0].scope, 'account-one');
  assert.deepEqual(Array.from(f.invalidations[0].tags), ['notification-center']);
  assert.deepEqual(f.events, ['reylumi:experience-mutation']);
  f.cleanup();
});

test("external successful writes and authentication requests cannot emit ordinary app mutation events", async () => {
  const f = await fixture({ responseStatus: 200 });
  await f.window.fetch('https://other.test/write', { method: 'POST' });
  await f.window.fetch('/api/auth/login', { method: 'POST' });
  assert.deepEqual(f.invalidations, []);
  assert.deepEqual(f.events, []);
  f.cleanup();
});

test("a write response from before logout or Activity cleanup cannot invalidate the current account", async () => {
  for (const endSession of ['logout', 'cleanup']) {
    let finish;
    const f = await fixture({ apiFetch: target => target === '/api/late-write' ? new Promise(resolve => { finish = resolve; }) : undefined });
    const pending = f.window.fetch('/api/late-write', { method: 'POST' });
    if (endSession === 'logout') await f.window.fetch('/api/auth/logout', { method: 'POST' });
    else f.cleanup();
    finish(new Response(null, { status: 200 }));
    await pending;
    assert.deepEqual(f.invalidations, []);
    assert.deepEqual(f.events, []);
    if (endSession === 'logout') f.cleanup();
  }
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
