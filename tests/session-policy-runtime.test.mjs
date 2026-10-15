import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHmac, timingSafeEqual } from "node:crypto";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url), ts = require("typescript");
function load(file, dependencies, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, Buffer, process: { env: { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test" } },
    setTimeout: () => ({ unref() {} }), AbortSignal, fetch, ...globals,
    require: name => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; } });
  return exports;
}
const sign = value => createHmac("sha256", "test-key").update(value).digest("hex");
const policy = load("lib/supabase/session-policy.ts", { "@/lib/abuse-signals": {
  abuseHash: sign, abuseSigningKey: () => "test-key", verifySignedValue: (value, signature) => /^[a-f0-9]{64}$/.test(signature) && timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(value), "hex")),
} });
const now = 1_800_000_000_000;
const token = (exp = now / 1000 + 3600, id = "session-1") => `header.${Buffer.from(JSON.stringify({ exp, session_id: id })).toString("base64url")}.signature`;

test("Remember is persistent; opt-out remains browser-session-only on every device", () => {
  assert.equal(policy.sessionCookieOptions(true).maxAge, 90 * 86400);
  assert.equal(policy.sessionCookieOptions(false).maxAge, undefined);
  assert.equal(policy.sessionCookieOptions(true).httpOnly, true);
  assert.equal(policy.sessionCookieOptions(true).secure, true);
  const writes = new Map();
  policy.writeLoginPolicy({ set: (name, value, options) => writes.set(name, { value, options }), delete: name => writes.delete(name) }, token(), false);
  assert.equal(writes.get(policy.REMEMBER_LOGIN_COOKIE).value, "0");
  assert.equal(writes.get(policy.REMEMBER_LOGIN_COOKIE).options.maxAge, undefined);
});

test("refresh is required before expiry, after reopening without an access cookie, and for malformed tokens", () => {
  assert.equal(policy.tokenNeedsRefresh(token(), now), false);
  assert.equal(policy.tokenNeedsRefresh(token(now / 1000 + 30), now), true);
  assert.equal(policy.tokenNeedsRefresh(undefined, now), true);
  assert.equal(policy.tokenNeedsRefresh("broken", now), true);
});

test("admin idle expiry does not follow Remember or token refresh", () => {
  const cookie = policy.newAdminSession(token(), now);
  assert.ok(policy.readAdminSession(cookie, token(), now + policy.ADMIN_IDLE_MS - 1));
  assert.equal(policy.readAdminSession(cookie, token(), now + policy.ADMIN_IDLE_MS), null);
  assert.equal(policy.readAdminSession(cookie, token(now / 1000 + 7200), now + policy.ADMIN_IDLE_MS), null);
  assert.equal(policy.touchAdminSession(cookie, token(), now + policy.ADMIN_IDLE_MS), null);
});

test("real activity extends idle time, but never extends the 12-hour admin maximum", () => {
  let cookie = policy.newAdminSession(token(), now);
  for (let elapsed = 20 * 60_000; elapsed < policy.ADMIN_MAX_MS; elapsed += 20 * 60_000) {
    cookie = policy.touchAdminSession(cookie, token(), now + elapsed);
    assert.ok(cookie);
  }
  assert.equal(policy.readAdminSession(cookie, token(), now + policy.ADMIN_MAX_MS), null);
});

test("admin cookies cannot be forged, transferred to another login, or assigned future activity", () => {
  const cookie = policy.newAdminSession(token(), now);
  assert.equal(policy.readAdminSession(cookie.replace("session-1", "session-2"), token(undefined, "session-2"), now), null);
  assert.equal(policy.readAdminSession(cookie, token(undefined, "other-login"), now), null);
  assert.equal(policy.readAdminSession(policy.newAdminSession(token(), now + 1), token(), now), null);
});

function refreshFixture({ remember = "1", failed = false, status = 503, authorization = false, pathname = "/settings" } = {}) {
  let calls = 0;
  const requestCookies = new Map([["sb-refresh-token", "refresh-old"], ["sb-access-token", token(0)], ["login-id", "login-1"]]);
  if (remember !== undefined) requestCookies.set(policy.REMEMBER_LOGIN_COOKIE, remember);
  const request = { cookies: { get: name => requestCookies.has(name) ? { value: requestCookies.get(name) } : undefined, set: (name, value) => requestCookies.set(name, value) },
    headers: new Headers(authorization ? { authorization: "Bearer external" } : {}), nextUrl: { pathname } };
  const module = load("lib/supabase/refresh-session.ts", {
    "@supabase/supabase-js": { createClient: () => ({ auth: { refreshSession: async () => {
      calls++; await new Promise(resolve => setImmediate(resolve));
      return failed ? { data: {}, error: { status } } : { data: { session: { access_token: token(), refresh_token: "refresh-new" } }, error: null };
    } } }) },
    "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login-id" },
    "./session-policy": policy, "node:crypto": require("node:crypto"),
  });
  return { request, run: () => module.refreshRequestSession(request), calls: () => calls, cookies: requestCookies };
}

test("parallel refreshes rotate once and forward the new token to the current request", async () => {
  const f = refreshFixture();
  const results = await Promise.all([f.run(), f.run()]);
  assert.equal(f.calls(), 1);
  assert.equal(f.cookies.get("sb-refresh-token"), "refresh-new");
  assert.equal(results[0].updates.find(v => v.name === "login-id").value, "login-1");
  assert.equal(results[0].updates[0].options.maxAge, policy.REMEMBER_LOGIN_SECONDS);
});

test("refresh preserves Remember opt-out instead of silently persisting cookies", async () => {
  const f = refreshFixture({ remember: "0" });
  const result = await f.run();
  for (const update of result.updates) assert.equal(update.options.maxAge, undefined);
  assert.equal(f.cookies.get(policy.REMEMBER_LOGIN_COOKIE), "0");
});

test("transient auth outage preserves cookies; invalid refresh is distinguished from outage", async () => {
  const outage = refreshFixture({ failed: true });
  assert.equal((await outage.run()).unavailable, true);
  assert.equal(outage.cookies.get("sb-refresh-token"), "refresh-old");
  const invalid = refreshFixture({ failed: true, status: 400 });
  assert.equal((await invalid.run()).unavailable, false);
});

test("logout and explicit bearer requests do not refresh cookie credentials", async () => {
  for (const options of [{ pathname: "/api/auth/logout" }, { authorization: true }]) {
    const f = refreshFixture(options);
    assert.equal((await f.run()).updates.length, 0);
    assert.equal(f.calls(), 0);
  }
});

test("security updates preserve Remember and cannot reset the admin timeout", async () => {
  for (const remember of ["0", "1", undefined]) {
    const writes = [], values = new Map([[policy.ADMIN_SESSION_COOKIE, "existing-admin-lease"]]);
    if (remember !== undefined) values.set(policy.REMEMBER_LOGIN_COOKIE, remember);
    const writer = { get: name => values.has(name) ? { value: values.get(name) } : undefined,
      set: (name, value, options) => { values.set(name, value); writes.push({ name, value, options }); }, delete: name => values.delete(name) };
    const server = load("lib/supabase/server.ts", {
      "@/lib/abuse-context": {}, "@supabase/supabase-js": {}, "@/lib/account-security-shared": {},
      "@/lib/users/account-status": {}, "next/headers": { cookies: async () => writer }, "./session-policy": policy,
      "./auth-rest": {},
    });
    await server.setSupabaseSessionCookies({ access_token: token(), refresh_token: "rotated", expires_in: 3600 });
    assert.equal(values.get(policy.ADMIN_SESSION_COOKIE), "existing-admin-lease");
    for (const update of writes) assert.equal(Boolean(update.options.maxAge), remember === "1");
    server.clearSupabaseSessionCookieWriter(writer);
    for (const name of ["sb-access-token", "sb-refresh-token", policy.REMEMBER_LOGIN_COOKIE, policy.ADMIN_SESSION_COOKIE]) assert.equal(values.has(name), false);
  }
});
