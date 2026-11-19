import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const origin = "https://reylumi.com";
const uid = "00000000-0000-4000-8000-000000000001";
class NextRequest extends Request { get nextUrl() { return new URL(this.url); } }
class NextResponse extends Response {
  constructor(body, init) {
    super(body, init);
    this.cookieChanges = [];
    this.cookies = { set: (...args) => this.cookieChanges.push(["set", ...args]), delete: name => this.cookieChanges.push(["delete", name]) };
  }
  static json(body, init = {}) { return new NextResponse(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...init.headers } }); }
  static redirect(url, status = 307) { return new NextResponse(null, { status, headers: { Location: String(url) } }); }
}

function load(file, dependencies = {}, globals = {}) {
  const calls = [];
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, Request, Response, Headers, URL, URLSearchParams, Buffer, Uint8Array, TextDecoder, AbortSignal,
    performance, console, process: { env: {} }, ...globals,
    require(name) {
      if (name === "@/lib/request-origin") return originGuard;
      if (name in dependencies) return dependencies[name];
      if (name === "next/server") return { NextRequest, NextResponse, after: callback => callback() };
      if (name.startsWith("node:")) return require(name);
      return new Proxy({}, { get: (_target, key) => (...args) => { calls.push({ name, key, args }); throw Error(`Unexpected dependency call: ${name}.${String(key)}`); } });
    },
  });
  return { ...exports, calls };
}
const originGuard = load("lib/request-origin.ts");
function request(path, headers = {}, body = "action=attempt") {
  return new NextRequest(`${origin}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body });
}

const protectedRoutes = [
  "app/(app)/api/auth/login/route.ts", "app/(app)/api/auth/logout/route.ts",
  "app/(app)/api/auth/signup/route.ts", "app/(app)/api/auth/forgot-password/route.ts",
  "app/(app)/api/auth/mfa/verify/route.ts", "app/(app)/api/staff/invite/signup/route.ts",
  "app/(app)/api/auth/admin-activity/route.ts", "app/(app)/admin/api/support-activity/route.ts",
  "app/(app)/api/security/challenge/route.ts", "app/(legal)/api/contact-support/route.ts",
  "app/api/advertising/reports/route.ts", "app/api/app-local/command/route.ts", "app/api/app-local/read/route.ts",
  "app/api/booking-payment/test-confirm/route.ts", "app/api/campaigns/delivery/route.ts",
  "app/api/check-writer/route.ts", "app/api/check-writer/pdf/route.ts", "app/api/explore/advertising/route.ts",
  "app/api/gift-cards/route.ts", "app/api/gift-cards/ticket-delivery/route.ts", "app/api/images/normalize/route.ts",
  "app/api/notifications/route.ts", "app/api/notifications/preferences/route.ts", "app/api/owner-attention/route.ts",
  "app/api/pos/closing/route.ts", "app/api/pos/owner/operations/route.ts", "app/api/pos/portable/device/route.ts",
  "app/api/pos/portable/draft/route.ts", "app/api/pos/portable/operations/route.ts", "app/api/pos/windows-download/route.ts",
  "app/api/public-booking/confirm/route.ts", "app/api/rewards/route.ts", "app/api/shop-money/route.ts",
  "app/api/staff/booking-preferences/route.ts", "app/api/staff/confirm-booking/route.ts",
  "app/api/staff/create-appointment/route.ts", "app/api/staff/report-no-show/route.ts",
];
const rejectedHeaders = [
  { Origin: "https://attacker.test", "Sec-Fetch-Site": "cross-site" },
  { Origin: "https://untrusted.reylumi.com", "Sec-Fetch-Site": "same-site" },
  { "User-Agent": "ReylumiIOS/1.0 ReylumiAndroidPOS/1.0", "X-Reylumi-Native": "1", Cookie: "kingpos-access-token=fixture" },
  { Origin: "null" },
  { Origin: "http://reylumi.com" },
  { Origin: "https://attacker.test", "X-Forwarded-Host": "attacker.test", Host: "attacker.test" },
  { Origin: origin, "Sec-Fetch-Site": "cross-site" },
  { Origin: origin, "Sec-Fetch-Site": "same-site" },
];
for (const file of protectedRoutes) {
  test(`${file}: hostile forms and missing Origin stop before body/auth/provider work`, async () => {
    const api = load(file);
    for (const headers of rejectedHeaders) {
      const incoming = request("api/security-fixture", headers);
      const result = await api.POST(incoming);
      assert.equal(result.status, 403, JSON.stringify(headers));
      assert.equal(incoming.bodyUsed, false, "Denied input must not be read");
      assert.equal(api.calls.length, 0, "No authentication, provider or mutation dependency should run");
    }
  });
}

test("same-origin web forms, native HTTPS requests and local exact ports remain admitted", () => {
  for (const headers of [{ Origin: origin }, { Origin: origin, "Sec-Fetch-Site": "same-origin" }, { Origin: origin, "User-Agent": "ReylumiIOS/1.0" }]) {
    assert.equal(originGuard.isSameOriginMutation(request("api/login", headers)), true);
  }
  for (const [url, supplied, accepted] of [["http://127.0.0.1:4317/api/login", "http://127.0.0.1:4317", true], ["http://127.0.0.1:4317/api/login", "http://127.0.0.1:4318", false], ["https://reylumi.com/api/login", "https://reylumi.com/", false]]) {
    assert.equal(originGuard.isSameOriginMutation(new Request(url, { method: "POST", headers: { Origin: supplied } })), accepted);
  }
  assert.equal(originGuard.isSameOriginMutation(request("api/login", { Authorization: "Bearer attacker-supplied", Cookie: "kingpos-access-token=fixture" })), false);
});

test("actual NextRequest loopback normalization recovers only same-port loopback Host", () => {
  const { NextRequest: FrameworkRequest } = require("next/server");
  const requestAt = (url, headers) => new FrameworkRequest(url, { method: "POST", headers });
  for (const supplied of ["http://127.0.0.1:4317", "http://localhost:4317", "http://[::1]:4317"]) {
    const incoming = requestAt(`${supplied}/api/auth/login`, { Host: new URL(supplied).host, Origin: supplied });
    assert.equal(new URL(incoming.url).hostname, "localhost", "exercise actual framework normalization");
    assert.equal(originGuard.effectiveRequestOrigin(incoming), supplied);
    assert.equal(originGuard.isSameOriginMutation(incoming), true);
  }
  for (const headers of [
    { Host: "attacker.invalid:4317", Origin: "http://attacker.invalid:4317" },
    { Host: "attacker.invalid:4317", Origin: "http://localhost:4317" },
    { Host: "127.0.0.1:4318", Origin: "http://127.0.0.1:4318" },
    { Host: "127.0.0.1:4318", Origin: "http://localhost:4317" },
    { Host: "127.0.0.1:4317", Origin: "https://127.0.0.1:4317" },
    { Host: "127.0.0.1:4317", Origin: "http://localhost:4317" },
    { Host: "127.0.0.1:4317", Origin: "http://attacker.invalid:4317", "X-Forwarded-Host": "attacker.invalid:4317" },
    { Host: "attacker.invalid:4317", Origin: "http://127.0.0.1:4317", "X-Forwarded-Host": "127.0.0.1:4317" },
  ]) assert.equal(originGuard.isSameOriginMutation(requestAt("http://127.0.0.1:4317/api/auth/login", headers)), false, JSON.stringify(headers));
  assert.equal(originGuard.effectiveRequestOrigin(requestAt(`${origin}/api/auth/login`, { Host: "127.0.0.1:4317", "X-Forwarded-Host": "attacker.invalid" })), origin, "public URL authority is not replaced by headers");
});

test("same-origin login completes and writes its existing cookies for web and native transports", async () => {
  for (const extra of [{ "Sec-Fetch-Site": "same-origin" }, { "User-Agent": "ReylumiIOS/1.0" }]) {
    const authCalls = [];
    const api = load("app/(app)/api/auth/login/route.ts", {
      "@/lib/supabase/server": {
        ACCESS_TOKEN_COOKIE: "access", REFRESH_TOKEN_COOKIE: "refresh", getSupabaseCookieOptions: () => ({ httpOnly: true }),
        clearPendingMfaSessionCookieWriter: () => {},
        createSupabaseServerClient: () => ({ auth: {
          signInWithPassword: async credentials => { authCalls.push(credentials); return { data: { user: { id: uid }, session: { access_token: "fixture-access", refresh_token: "fixture-refresh" } }, error: null }; },
          mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" } }), listFactors: async () => ({ data: {} }) },
        } }),
      },
      "@/lib/supabase/session-policy": { REMEMBER_LOGIN_SECONDS: 1000, writeLoginPolicy: () => {} },
      "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login-session" },
      "@/lib/account-security": { recordAccountLoginForSession: async () => {} },
      "@/lib/abuse-server": { assertAbuseRequest: async () => {} },
      "@/lib/auth-routing": { sanitizeAuthReturnPath: () => "/explore" },
      "@/lib/signup-phone-routing": { resumeSignupPhonePath: () => "/explore" },
      "@/lib/post-auth-routing": { getPostAuthWorkspaceNavigation: async () => ({ redirectTo: "/explore" }) },
    });
    const result = await api.POST(request("api/auth/login", { Origin: origin, Accept: "application/json", ...extra }, "email=fixture%40example.test&password=fixture-only"));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).redirectTo, "/explore");
    assert.equal(authCalls.length, 1);
    assert.ok(result.cookieChanges.some(([kind, name, value]) => kind === "set" && name === "access" && value === "fixture-access"));
    assert.ok(result.cookieChanges.some(([kind, name]) => kind === "set" && name === "login-session"));
  }
});

test("native/cookie logout still revokes and clears its existing session", async () => {
  const changes = [];
  const api = load("app/(app)/api/auth/logout/route.ts", {
    "next/headers": { cookies: async () => ({ get: () => ({ value: "fixture-refresh" }), getAll: () => [{ name: "access" }] }) },
    "@/lib/account-security": { recordCurrentAccountSessionLogout: async () => changes.push("record") },
    "@/lib/supabase/server": { REFRESH_TOKEN_COOKIE: "refresh", createSupabaseServerClient: () => ({ auth: { refreshSession: async () => ({ data: { session: {} } }), signOut: async () => changes.push("revoke") } }), clearSupabaseSessionCookieWriter: jar => jar.delete("access") },
    "@/lib/current-context": { clearWorkspaceContextCookies: jar => jar.delete("workspace") },
    "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login-session" },
  });
  const result = await api.POST(request("api/auth/logout", { Origin: origin }));
  assert.equal(result.status, 200);
  assert.deepEqual(changes, ["record", "revoke"]);
  assert.ok(result.cookieChanges.some(([kind, name]) => kind === "delete" && name === "access"));
});

test("Shop Money GET adapter remains a fixed read and cannot forward a write operation", async () => {
  const operations = [];
  const api = load("app/api/shop-money/route.ts", {
    "@/lib/current-context": { getCurrentBusinessContext: async () => ({ currentSalon: { id: uid }, currentMembership: {} }), isOwnerMembership: () => true },
    "@/lib/supabase/server": { createAuthenticatedSupabaseServerClient: async () => ({ rpc: async (name, args) => { operations.push({ name, args }); return { data: {}, error: null }; } }) },
  });
  assert.equal((await api.GET(new NextRequest(`${origin}/api/shop-money?salonId=${uid}&start=2026-11-01&end=2026-11-19`))).status, 200);
  assert.equal(operations[0].name, "shop_money_read");
  assert.equal((await api.GET(new NextRequest(`${origin}/api/shop-money?op=write&salonId=${uid}`))).status, 400);
  assert.equal(operations.length, 1);
});

test("same-origin portable replay keeps the original operation ID, scope and payload", async () => {
  const operations = [];
  const api = load("app/api/pos/portable/operations/route.ts", {
    "@/app/pos/portable/actions": { replayPortableOperation: async input => { operations.push(input); return { kind: "ok" }; } },
  });
  const operation = { kind: "receipt", id: uid, scope: "fixture-device:fixture-salon", occurredAt: "2026-11-19T12:00:00.000Z", payload: { lines: [], total: 0 } };
  const result = await api.POST(request("api/pos/portable/operations", { Origin: origin, "Content-Type": "application/json" }, JSON.stringify(operation)));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).kind, "ok");
  assert.equal(operations.length, 1);
  assert.equal(JSON.stringify(operations[0]), JSON.stringify(operation));
});

test("installed shell logout forwards a fixed verified-origin Request and current cookie", async () => {
  const forwarded = [];
  const api = load("lib/app-local-shell-server.ts", {
    "next/headers": { headers: async () => new Headers({ Cookie: "fixture=current-session" }) },
    "./request-business-context": { getRequestBusinessContext: async () => ({ user: { id: uid } }) },
    "./experience-context": { getExperienceContext: () => ({ scope: "fixture-scope" }) },
    "@/app/(app)/api/auth/logout/route": { POST: async incoming => {
      assert.equal(incoming.url, `${origin}/api/auth/logout`);
      assert.equal(incoming.method, "POST");
      assert.equal(originGuard.isSameOriginMutation(incoming), true);
      assert.equal(incoming.headers.get("cookie"), "fixture=current-session");
      forwarded.push(incoming);
      return Response.json({ redirectTo: "/login" });
    } },
  });
  const invalid = request("api/app-local/command", { Origin: "https://attacker.test" });
  await assert.rejects(api.runAppLocalShellCommand("shell.logout", {}, invalid, "fixture-scope"), error => error.status === 403);
  assert.equal(forwarded.length, 0);
  const result = await api.runAppLocalShellCommand("shell.logout", {}, request("api/app-local/command", { Origin: origin }), "fixture-scope");
  assert.equal(result.handled, true);
  assert.equal(result.data.status, 200);
  assert.equal(forwarded.length, 1);
});

test("native receipt adapter preserves loopback authority through actual NextRequest reconstruction", async () => {
  const { NextRequest: FrameworkRequest } = require("next/server");
  let dispatched = 0;
  const local = "http://127.0.0.1:4317";
  const api = load("lib/app-local-http-server.ts", {
    "next/server": { NextRequest: FrameworkRequest },
    "next/headers": { headers: async () => new Headers({ Cookie: "fixture=current-session" }) },
    "./request-business-context": { getRequestBusinessContext: async () => ({ user: { id: uid } }) },
    "./experience-context": { getExperienceContext: () => ({ scope: "fixture-scope" }) },
    "@/app/api/pos/owner/operations/route": { POST: async incoming => {
      assert.equal(new URL(incoming.url).hostname, "localhost");
      assert.equal(incoming.headers.get("host"), "127.0.0.1:4317");
      assert.equal(originGuard.effectiveRequestOrigin(incoming), local);
      assert.equal(originGuard.isSameOriginMutation(incoming), true);
      assert.equal(incoming.headers.get("cookie"), "fixture=current-session");
      dispatched++;
      return Response.json({ kind: "ok" });
    } },
  });
  const incoming = new FrameworkRequest(`${local}/api/app-local/command`, { method: "POST", headers: { Host: "127.0.0.1:4317", Origin: local } });
  const result = await api.runAppLocalHttpCommand("owner.receipt-operation", { operation: { id: uid } }, incoming, "fixture-scope");
  assert.equal(result.handled, true);
  assert.equal(result.data.status, 200);
  assert.equal(dispatched, 1);
});

test("origin-less recovery uses only an independently verified bearer, never ambient cookies", async () => {
  let verified = false, cookieReads = 0, changed = 0;
  const sessionId = "00000000-0000-4000-8000-000000000002";
  const token = "header." + Buffer.from(JSON.stringify({ sub: uid, session_id: sessionId })).toString("base64url") + ".signature";
  const api = load("app/api/auth/recovery-password/route.ts", {
    "next/headers": { cookies: () => { cookieReads++; throw Error("Cookie identity must not be read"); } },
    "@/lib/platform-admin/user-identity": { adminIdentityClient: () => ({
      auth: { getUser: async supplied => ({ data: { user: verified && supplied === token ? { id: uid } : null }, error: null }), admin: { signOut: async () => {} } },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "active" }, error: null }) }) }) }),
      rpc: async name => ({ data: name === "recovery_reset_session_valid", error: null }),
    }) },
  }, { process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon" } }, fetch: async (_url, init) => { changed++; assert.equal(init.headers.Authorization, `Bearer ${token}`); return Response.json({ id: uid }); } });
  const incoming = headers => request("api/auth/recovery-password", { "Content-Type": "application/json", Cookie: "kingpos-access-token=valid-cookie-fixture", ...headers }, JSON.stringify({ password: "fixture-new-password" }));
  assert.equal((await api.POST(incoming({}))).status, 403);
  assert.equal((await api.POST(incoming({ Authorization: `Bearer ${token}` }))).status, 401);
  verified = true;
  assert.equal((await api.POST(incoming({ Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await api.POST(incoming({ Authorization: `Bearer ${token}` }))).status, 200);
  assert.equal(changed, 1);
  assert.equal(cookieReads, 0);
});
