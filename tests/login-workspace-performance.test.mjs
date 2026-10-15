import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, console: { error() {} }, require(name) {
    assert.ok(name in dependencies, `Missing test dependency ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function authFixture({ mfa = false, invalid = false } = {}) {
  const started = [];
  const pending = new Map();
  const cookies = [];
  const session = { access_token: "access", refresh_token: "refresh", expires_in: 3600 };
  const auth = {
    signInWithPassword: async () => ({ data: { session: invalid ? null : session }, error: invalid ? { message: "Invalid credentials" } : null }),
    mfa: {
      verify: async () => ({ data: invalid ? null : session, error: invalid ? { message: "Invalid code" } : null }),
      getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }),
      listFactors: async () => ({ data: { phone: [], totp: [] }, error: null }),
    },
  };
  const wait = (name, input) => {
    started.push({ name, input });
    return new Promise(resolve => pending.set(name, resolve));
  };
  const dependencies = {
    "@/lib/system-sms": { systemSmsReady: async () => true },
    "@/lib/abuse-server": { assertAbuseRequest: async () => {} },
    "@/lib/supabase/session-policy": { REMEMBER_LOGIN_SECONDS: 90 * 86400, writeLoginPolicy: () => cookies.push("login-policy") },
    "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login-session", isAccountLoginSessionId: () => true },
    "@/lib/account-security": { recordAccountLoginForSession: input => wait("session", input) },
    "@/lib/auth-routing": { sanitizeAuthReturnPath: path => path || "/explore" },
    "@/lib/current-context": { clearWorkspaceContextCookies() {}, writeNormalizedWorkspaceContextCookies: () => cookies.push("workspace") },
    "@/lib/supabase/server": {
      ACCESS_TOKEN_COOKIE: "access", REFRESH_TOKEN_COOKIE: "refresh",
      clearPendingMfaSessionCookieWriter() {}, setPendingMfaSessionCookieWriter() {},
      createSupabaseServerClient: () => ({ auth }),
      createPendingMfaSupabaseAuthSessionServerClient: async () => ({ supabase: { auth }, rememberLogin: false }),
      getSupabaseCookieOptions: () => ({ httpOnly: true }),
    },
    "@/lib/post-auth-routing": {
      getPostAuthWorkspaceNavigation: input => wait("navigation", input),
      fallbackPostAuthWorkspaceNavigation: () => ({ redirectTo: "/explore", workspace: null }),
    },
    "@/lib/supabase/auth-errors": { getSupabaseAuthErrorResponse: error => ({ message: error.message, status: 401 }) },
    "next/server": { NextResponse: {
      json: (body, options = {}) => ({ body, status: options.status ?? 200, cookies: { set: name => cookies.push(name), delete() {} } }),
    } },
    "node:crypto": { randomUUID: () => "session-id" },
  };
  const route = load(mfa ? "app/(app)/api/auth/mfa/verify/route.ts" : "app/(app)/api/auth/login/route.ts", dependencies);
  const form = new FormData();
  for (const [key, value] of Object.entries({ email: "test@example.invalid", password: "test", next: "/pos", factor_id: "factor", challenge_id: "challenge", code: "123456" })) form.set(key, value);
  return { started, pending, cookies, run: () => route.POST({ formData: async () => form, headers: new Headers({ accept: "application/json" }) }) };
}

for (const mfa of [false, true]) {
  test(`${mfa ? "MFA" : "password"} login overlaps navigation/session but waits for both before issuing cookies`, async () => {
    const fixture = authFixture({ mfa });
    let done = false;
    const response = fixture.run().then(result => { done = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fixture.started.map(row => row.name).sort(), ["navigation", "session"]);
    assert.equal(fixture.started.find(row => row.name === "session").input.sessionId, "session-id");
    fixture.pending.get("navigation")({ redirectTo: "/pos", workspace: { id: "owner" } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(done, false);
    assert.deepEqual(fixture.cookies, []);
    fixture.pending.get("session")();
    assert.equal((await response).body.redirectTo, "/pos");
    assert.deepEqual(fixture.cookies, ["access", "refresh", "login-session", "login-policy", "workspace"]);
  });

  test(`${mfa ? "MFA" : "password"} failure does not start workspace or session work`, async () => {
    const fixture = authFixture({ mfa, invalid: true });
    assert.ok((await fixture.run()).status >= 400);
    assert.deepEqual(fixture.started, []);
    assert.deepEqual(fixture.cookies, []);
  });
}

function workspaceFixture({ authenticated = true, allowed = true } = {}) {
  const calls = [];
  const workspace = { id: "manage:a", defaultHref: "/staff/today" };
  const context = { user: authenticated ? { id: "user" } : null, workspaceOptions: [workspace] };
  const actions = load("app/salons/actions.ts", {
    "@/lib/current-context": {
      getCurrentBusinessContext: async () => context,
      getWorkspaceLandingHref: option => option.defaultHref,
      isWorkspaceDestinationAllowed: () => allowed,
      setNormalizedWorkspaceContext: async option => calls.push(`cookie:${option.id}`),
    },
    "@/lib/permissions": {}, "@/lib/routes": { routes: {} }, "@/lib/supabase/server": {},
    "next/cache": { revalidatePath: (path, type) => calls.push(`invalidate:${path}:${type}`), refresh: () => calls.push("refresh") },
    "next/navigation": {},
  });
  return { actions, calls };
}

test("workspace switch invalidates the shell once without another server refresh", async () => {
  const { actions, calls } = workspaceFixture();
  const result = await actions.switchWorkspaceLanding({ workspaceId: "manage:a" });
  assert.equal(result.ok, true);
  assert.equal(result.href, "/staff/today");
  assert.deepEqual(calls, ["cookie:manage:a", "invalidate:/:layout"]);
});

for (const [name, options, workspaceId] of [
  ["signed out", { authenticated: false }, "manage:a"],
  ["removed membership", {}, "manage:removed"],
  ["forbidden destination", { allowed: false }, "manage:a"],
]) {
  test(`workspace switch rejects ${name} before writing cookies`, async () => {
    const { actions, calls } = workspaceFixture(options);
    assert.equal((await actions.switchWorkspaceDestination({ workspaceId, destinationHref: "/pos" })).ok, false);
    assert.deepEqual(calls, []);
  });
}
