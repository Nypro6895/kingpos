import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url), ts = require("typescript");
function load(path, deps = {}, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(js, { exports, Buffer, URL, URLSearchParams, Request, Response, Headers, AbortSignal, FormData, console: { error() {} }, process: { env: { NODE_ENV: "production" } },
    ...globals, require: name => { if (name.startsWith("node:")) return require(name); assert.ok(name in deps, `Unmocked dependency ${name} in ${path}`); return deps[name]; } });
  return exports;
}
const fragment = load("lib/auth-return-fragment.ts");
const assurance = load("lib/supabase/mfa-assurance.ts");
const cookiePolicy = { ADMIN_SESSION_COOKIE: "admin", REMEMBER_LOGIN_COOKIE: "remember", sessionCookieOptions: remember => ({ httpOnly: true, secure: true, sameSite: "lax", path: "/", ...(remember ? { maxAge: 777 } : {}) }) };
const mfaCookies = load("lib/supabase/mfa-session.ts", { "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login-id" }, "./session-policy": cookiePolicy });
const sid = "10000000-0000-4000-8000-000000000001";
const cid = "20000000-0000-4000-8000-000000000001";
class NextResponse extends Response {
  constructor(body, options) { super(body, options); this.changes = []; this.cookies = { set: (name, value, options) => this.changes.push({ name, value, options }), delete: name => this.changes.push({ name, deleted: true }) }; }
  static json(body, init = {}) { return new NextResponse(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init.headers } }); }
  static redirect(url, status = 307) { return new NextResponse(null, { status, headers: { location: String(url) } }); }
}
const sourceClient = (currentLevel, nextLevel = currentLevel, error = null) => ({ auth: { mfa: { getAuthenticatorAssuranceLevel: async token => { assert.equal(token, "explicit-new-token"); return { data: { currentLevel, nextLevel }, error }; } } } });

test("assurance uses explicit verified SDK token, all known levels and missing/error fail closed", async () => {
  for (const [current, next, expected] of [["aal1", "aal1", "allowed"], ["aal1", "aal2", "required"], ["aal2", "aal2", "verified"], [null, "aal1", "unavailable"], ["aal1", null, "unavailable"]]) {
    assert.equal(await assurance.readMfaAssurance(sourceClient(current, next), "explicit-new-token"), expected);
  }
  assert.equal(await assurance.readMfaAssurance(sourceClient("aal1", "aal1", { message: "offline" }), "explicit-new-token"), "unavailable");
  assert.equal(await assurance.readMfaAssurance({ auth: { mfa: { getAuthenticatorAssuranceLevel: async () => { throw Error("offline"); } } } }, "explicit-new-token"), "unavailable");
});

function callbackFixture(level = "required") {
  const events = [];
  const api = load("app/(app)/api/auth/callback/route.ts", {
    "next/server": { NextResponse },
    "@/lib/supabase/session-policy": { writeLoginPolicy: () => events.push("policy"), sessionCookieOptions: cookiePolicy.sessionCookieOptions },
    "@/lib/advertising-attribution": { recordAdvertisingSignup: async () => events.push("advertising") },
    "@/lib/supabase/server": { ACCESS_TOKEN_COOKIE: "access", REFRESH_TOKEN_COOKIE: "refresh", clearPendingMfaSessionCookieWriter() {}, createSupabaseServerClient: () => ({ auth: { exchangeCodeForSession: async () => ({ data: { session: { access_token: "new-access", refresh_token: "new-refresh" }, user: { id: "u" } }, error: null }) } }) },
    "@/lib/supabase/mfa-assurance": { readMfaAssurance: async () => { events.push("assurance"); return level; } },
    "@/lib/supabase/mfa-session": mfaCookies,
    "@/lib/auth-return-fragment": fragment,
    "@/lib/post-auth-routing": { getPostAuthWorkspaceNavigation: async input => { events.push("private-navigation"); assert.ok(!input.requestedPath.includes("#card=")); return { redirectTo: input.requestedPath || "/explore" }; }, fallbackPostAuthWorkspaceNavigation: () => ({ redirectTo: "/explore" }) },
    "@/lib/auth-routing": { sanitizeAuthReturnPath: path => path || "/explore" },
    "@/lib/signup-phone-routing": { resumeSignupPhonePath: (_user, path) => path },
    "@/lib/supabase/auth-errors": { getSupabaseAuthErrorResponse: () => ({ message: "invalid" }) },
    "@/lib/current-context": { writeNormalizedWorkspaceContextCookies() {} },
  });
  return { events, run: next => api.GET(new Request(`https://reylumi.com/api/auth/callback?code=synthetic&next=${encodeURIComponent(next || "/explore")}`)) };
}

test("callback requiring MFA keeps only pending credentials before private/bootstrap/advertising, GET never challenges", async () => {
  const f = callbackFixture(); const response = await f.run("/pos");
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location")).pathname, "/login");
  assert.deepEqual(f.events, ["assurance"]);
  assert.equal(response.changes.find(c => c.name === "sb-access-token").options.maxAge, 0);
  assert.equal(response.changes.find(c => c.name === "sb-pending-mfa-access-token").value, "new-access");
  assert.equal(response.changes.find(c => c.name === "sb-pending-mfa-remember").value, "1");
  assert.equal(response.changes.some(c => c.name === "access" && c.value), false);
});

test("callback normal no-MFA promotion remains after assessment; unknown assurance is 503 without cookie mutation", async () => {
  const normal = callbackFixture("allowed"); const response = await normal.run();
  assert.deepEqual(normal.events, ["assurance", "advertising", "private-navigation", "policy"]);
  assert.equal(response.changes.find(c => c.name === "access").value, "new-access");
  const unavailable = callbackFixture("unavailable"); const denied = await unavailable.run();
  assert.equal(denied.status, 503); assert.equal(denied.changes.length, 0);
  assert.deepEqual(unavailable.events, ["assurance"]);
});

test("Gift capability is never placed in callback continuation query or pending cookies", async () => {
  const token = "a".repeat(64), response = await callbackFixture().run(`/gift-cards#card=${token}`);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("next"), "/gift-cards");
  assert.equal(JSON.stringify(response.changes).includes(token), false);
  const split = fragment.splitGiftAuthReturn(`/gift-cards#card=${token}`);
  assert.equal(split.serverPath, "/gift-cards");
  assert.equal(fragment.restoreGiftAuthFragment("/gift-cards", split.fragment), `/gift-cards#card=${token}`);
  for (const destination of ["/pos", "//evil.test/gift-cards", "https://evil.test/gift-cards", "/gift-cards#other=1"]) assert.equal(fragment.restoreGiftAuthFragment(destination, split.fragment), destination);
});

function challengeModule({ phone = true, enabled = true, ambiguous = false, block, clock } = {}) {
  const counts = { sent: 0, readiness: 0, factors: 0 };
  const deps = { "./mfa-session": mfaCookies, "@/lib/system-sms": { systemSmsReady: async () => { counts.readiness++; return enabled; } } };
  const client = { auth: { mfa: {
    listFactors: async () => { counts.factors++; return { data: { phone: phone ? [{ id: sid, factor_type: "phone", status: "verified", phone: "+15555551234" }] : [], totp: phone ? [] : [{ id: sid, factor_type: "totp", status: "verified" }] }, error: null }; },
    challenge: async input => { counts.sent++; assert.equal(input.factorId, sid); if (block) await block; if (ambiguous) throw Error("unknown send outcome"); return { data: { id: cid, expires_at: Math.floor(Date.now() / 1000) + 300 }, error: null }; },
  } } };
  const globals = clock ? { Date: class extends Date { static now() { return clock.now; } } } : {};
  return { client, counts, api: load("lib/supabase/mfa-challenge.ts", deps, globals), freshWorker: () => load("lib/supabase/mfa-challenge.ts", deps, globals) };
}

test("same-worker overlapping resumes share one challenge; a received receipt is reusable and session-bound", async () => {
  let release; const block = new Promise(resolve => { release = resolve; });
  const f = challengeModule({ block });
  const a = f.api.resumeMfaChallenge(f.client, "pending-token"), b = f.api.resumeMfaChallenge(f.client, "pending-token");
  await new Promise(resolve => setImmediate(resolve)); assert.equal(f.counts.sent, 1); release();
  const [first, second] = await Promise.all([a, b]); assert.equal(first.cookie, second.cookie);
  assert.equal(first.challenge.phone, "1234", "receipt exposes only the displayed last four digits");
  const later = await f.freshWorker().resumeMfaChallenge(f.client, "pending-token", first.cookie);
  assert.equal(later.cookie, first.cookie); assert.equal(f.counts.sent, 1);
  await f.freshWorker().resumeMfaChallenge(f.client, "another-pending-token", first.cookie);
  assert.equal(f.counts.sent, 2, "another pending identity cannot reuse the signed receipt");
});

test("disabled SMS and ambiguous challenge outcomes never auto-resend; TOTP needs no SMS readiness", async () => {
  const disabled = challengeModule({ enabled: false });
  assert.ok((await disabled.api.resumeMfaChallenge(disabled.client, "pending")).error); assert.equal(disabled.counts.sent, 0);
  const unknown = challengeModule({ ambiguous: true });
  await unknown.api.resumeMfaChallenge(unknown.client, "pending"); await unknown.api.resumeMfaChallenge(unknown.client, "pending");
  assert.equal(unknown.counts.sent, 1);
  const totp = challengeModule({ phone: false }); await totp.api.resumeMfaChallenge(totp.client, "pending");
  assert.equal(totp.counts.sent, 1); assert.equal(totp.counts.readiness, 0);
});

test("provider challenge expiry returns restart guidance instead of a successful stale challenge or SMS resend", async () => {
  const clock = { now: Date.now() }, f = challengeModule({ clock });
  const first = await f.api.resumeMfaChallenge(f.client, "pending");
  assert.ok(first.challenge); clock.now += 301_000;
  const expired = await f.api.resumeMfaChallenge(f.client, "pending", first.cookie);
  assert.match(expired.error, /expired.*Log in again/); assert.equal(expired.challenge, undefined); assert.equal(f.counts.sent, 1);
  const anotherWorker = await f.freshWorker().resumeMfaChallenge(f.client, "pending", first.cookie);
  assert.match(anotherWorker.error, /expired.*Log in again/); assert.equal(anotherWorker.challenge, undefined); assert.equal(f.counts.sent, 1, "received expired receipt cannot restart SMS on another worker");
});

test("continuation GET is cookie-only; stale principal POST stops before SDK/challenge and all responses are private", async () => {
  let principal = "a".repeat(64), authCalls = 0, sends = 0;
  const api = load("app/(app)/api/auth/mfa/challenge/route.ts", {
    "next/server": { NextResponse }, "@/lib/request-origin": { isSameOriginMutation: req => req.headers.get("origin") === "https://reylumi.com" },
    "@/lib/supabase/server": { getPendingMfaSessionTokensFromRequest: async () => ({ accessToken: principal, refreshToken: "refresh" }), pendingMfaContinuationId: tokens => tokens.accessToken,
      createPendingMfaSupabaseAuthSessionServerClient: async () => { authCalls++; return { continuationId: principal, accessToken: "pending", supabase: {}, challengeReceipt: undefined }; }, getSupabaseCookieOptions: () => ({}) },
    "@/lib/supabase/mfa-assurance": { readMfaAssurance: async () => "required" },
    "@/lib/supabase/mfa-challenge": { resumeMfaChallenge: async () => { sends++; return { challenge: { factorId: sid }, cookie: "receipt" }; } },
    "@/lib/supabase/mfa-session": mfaCookies,
  });
  const initial = await api.GET(); assert.equal((await initial.json()).continuationId, principal); assert.equal(authCalls, 0); assert.match(initial.headers.get("cache-control"), /private.*no-store/);
  const staleId = principal; principal = "b".repeat(64);
  const request = (id, origin = "https://reylumi.com") => new Request("https://reylumi.com/api/auth/mfa/challenge", { method: "POST", headers: { origin, "x-reylumi-mfa-continuation": id } });
  const stale = await api.POST(request(staleId)); assert.equal(stale.status, 409); assert.equal(authCalls, 0); assert.equal(sends, 0); assert.match(stale.headers.get("cache-control"), /private.*no-store/);
  const cross = await api.POST(request(principal, "https://evil.invalid")); assert.equal(cross.status, 403); assert.equal(authCalls, 0);
  const current = await api.POST(request(principal)); assert.equal(current.status, 200); assert.equal(authCalls, 1); assert.equal(sends, 1); assert.match(current.headers.get("cache-control"), /private.*no-store/);
});

test("pending cookie credentials cannot be borrowed by a different or malformed Bearer principal", async () => {
  const values = new Map([["sb-pending-mfa-access-token", "pending-access"], ["sb-pending-mfa-refresh-token", "pending-refresh"], ["sb-pending-mfa-remember", "1"]]);
  let authorization = null;
  const deps = { "@/lib/abuse-context": {}, "@supabase/supabase-js": {}, "@/lib/account-security-shared": {}, "@/lib/users/account-status": {}, "@/lib/users/user-select": {},
    "next/headers": { cookies: async () => ({ get: name => values.has(name) ? { value: values.get(name) } : undefined }), headers: async () => new Headers(authorization === null ? {} : { authorization }) },
    "./session-policy": {}, "./auth-rest": {}, "./auth-rejection": {}, "@/lib/read-context-scope": {} };
  const server = load("lib/supabase/server.ts", deps);
  for (const value of ["Bearer other", "Basic invalid", "Bearer", ""]) { authorization = value; assert.equal(await server.getPendingMfaSessionTokensFromRequest(), null); }
  authorization = "Bearer pending-access";
  assert.equal((await server.getPendingMfaSessionTokensFromRequest()).refreshToken, "pending-refresh");
  authorization = null; assert.equal((await server.getPendingMfaSessionTokensFromRequest()).rememberLogin, true);
});

test("enrollment promotes fresh AAL2 before shared audit and uses the new token client, never old AAL1 context", async () => {
  for (const phone of [false, true]) {
    const events = [], fresh = { from: () => ({ insert: async () => { events.push("fresh-audit"); return { error: null }; } }) };
    const old = { from: () => { throw Error("Old AAL1 context used after factor verification"); } };
    const auth = { auth: { mfa: { challenge: async () => ({ data: { id: cid }, error: null }), verify: async () => ({ data: { access_token: "new-aal2", refresh_token: "new-refresh" }, error: null }) } } };
    const deps = {
      "@/lib/system-sms": {}, "@/lib/account-security-shared": { getLoginRequestSnapshot: () => ({}), isAccountLoginSessionId: () => true },
      "@/lib/account-security": { LOGIN_SECURITY_PATH: "/settings/login-security", isLoginSecuritySchemaMissing: () => false },
      "@/lib/current-context": {}, "@/lib/phone-normalization": {},
      "@/lib/supabase/server": { createAuthenticatedSupabaseAuthSessionServerClient: async () => auth, createAuthenticatedSupabaseServerClient: async () => old,
        validateSupabaseAppSession: async token => { assert.equal(token, "new-aal2"); events.push("fresh-gate"); return true; },
        setSupabaseSessionCookies: async () => events.push("cookies"), createUserScopedSupabaseServerClient: token => { assert.equal(token, "new-aal2"); return fresh; },
        getCurrentAppLoginSessionId: async () => { assert.ok(events.includes("cookies")); events.push("shared-read"); return sid; } },
      "@/lib/supabase/mfa-assurance": { readMfaAssurance: async () => { events.push("assurance"); return "verified"; } },
      "@/lib/users/current-user": { getCurrentKingUser: async () => ({ id: "owned-user" }) },
      "next/cache": { revalidatePath: () => events.push("revalidate") }, "next/headers": { headers: async () => new Headers() },
    };
    const actions = load("app/settings/login-security/actions.ts", deps);
    const response = await (phone ? actions.verifyPhoneMfaEnrollmentAction : actions.verifyTotpEnrollmentAction)({ factor_id: sid, challenge_id: cid, code: "123456" });
    assert.equal(response.error, null);
    assert.deepEqual(events, ["assurance", "fresh-gate", "cookies", "shared-read", "fresh-audit", "revalidate"]);
  }
});

function verifyFixture({ level = "verified", gate = true, gateError } = {}) {
  const events = [];
  class Rejected extends Error {}
  const api = load("app/(app)/api/auth/mfa/verify/route.ts", {
    "next/server": { NextResponse }, "@/lib/request-origin": { isSameOriginMutation: () => true },
    "@/lib/supabase/session-policy": { REMEMBER_LOGIN_SECONDS: 777, writeLoginPolicy: () => events.push("policy") },
    "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login-id", isAccountLoginSessionId: value => value === sid || value === cid },
    "@/lib/account-security": { recordAccountLoginForSession: async () => events.push("audit") },
    "@/lib/auth-routing": { sanitizeAuthReturnPath: value => value || "/explore" }, "@/lib/auth-return-fragment": fragment,
    "@/lib/signup-phone-routing": { resumeSignupPhonePath: (_user, path) => path },
    "@/lib/current-context": { clearWorkspaceContextCookies() {}, writeNormalizedWorkspaceContextCookies() {} },
    "@/lib/supabase/server": { ACCESS_TOKEN_COOKIE: "access", REFRESH_TOKEN_COOKIE: "refresh", clearPendingMfaSessionCookieWriter() {}, getSupabaseCookieOptions: maxAge => ({ ...cookiePolicy.sessionCookieOptions(false), ...(maxAge ? { maxAge } : {}) }),
      createPendingMfaSupabaseAuthSessionServerClient: async () => ({ rememberLogin: false, supabase: { auth: { mfa: { verify: async () => { events.push("verify"); return { data: { access_token: "aal2-token", refresh_token: "aal2-refresh", user: { id: "u" } }, error: null }; } } } } }),
      validateSupabaseAppSession: async token => { assert.equal(token, "aal2-token"); events.push("app-gate"); if (gateError) throw new (gateError === "rejected" ? Rejected : Error)(); return gate; } },
    "@/lib/supabase/mfa-assurance": { readMfaAssurance: async () => { events.push("assurance"); return level; } },
    "@/lib/supabase/auth-rejection": { AuthRejectionError: Rejected },
    "@/lib/post-auth-routing": { getPostAuthWorkspaceNavigation: async () => { events.push("private-navigation"); return { redirectTo: "/pos" }; }, fallbackPostAuthWorkspaceNavigation: () => ({ redirectTo: "/explore" }) },
  });
  return { events, run: () => api.POST(new Request("https://reylumi.com/api/auth/mfa/verify", { method: "POST", body: new URLSearchParams({ factor_id: sid, challenge_id: cid, code: "123456" }) })) };
}

test("MFA verify promotes only fresh AAL2 after actual application gate; no-MFA AAL1 is insufficient", async () => {
  const success = verifyFixture(); const response = await success.run();
  assert.equal(response.status, 200); assert.equal(response.changes.find(c => c.name === "access").value, "aal2-token");
  assert.equal(response.changes.find(c => c.name === "refresh").options.maxAge, undefined, "Remember opt-out remains session-only");
  assert.deepEqual(success.events.slice(0, 3), ["verify", "assurance", "app-gate"]);
  for (const level of ["allowed", "required", "unavailable"]) {
    const f = verifyFixture({ level }), denied = await f.run();
    assert.equal(denied.status, level === "unavailable" ? 503 : 403); assert.equal(denied.changes.length, 0);
    assert.equal(f.events.includes("app-gate"), false);
  }
  for (const options of [{ gate: false }, { gateError: "rejected" }, { gateError: "unavailable" }]) {
    const f = verifyFixture(options), denied = await f.run();
    assert.equal(denied.status, options.gateError === "unavailable" ? 503 : 401); assert.equal(denied.changes.length, 0);
    assert.equal(f.events.includes("private-navigation"), false);
  }
});

test("client resume joins only the current pending identity and never borrows another in-flight DTO", async () => {
  let reads = 0, resolve, currentId = "a".repeat(64);
  const pending = new Promise(done => { resolve = done; });
  const client = load("lib/mfa-resume-client.ts", { "./bounded-get": { fetchWithDeadline: async (_path, init, options) => {
    assert.equal(init.signal, undefined); assert.equal(options.maxAttempts, 1);
    if (init.method === "GET") return Response.json({ continuationId: currentId });
    reads++; const id = init.headers["X-Reylumi-Mfa-Continuation"]; await pending;
    return Response.json({ mfa: { factorId: id } });
  } }, "./auth-response": { readAuthResponse: response => response.json() } });
  const a = client.resumePendingMfa(), b = client.resumePendingMfa();
  await new Promise(done => setImmediate(done)); assert.equal(reads, 1);
  currentId = "b".repeat(64); const switched = client.resumePendingMfa();
  await new Promise(done => setImmediate(done)); assert.equal(reads, 2, "new pending principal cannot join the old POST");
  resolve(); const [first, joined, other] = await Promise.all([a, b, switched]);
  assert.equal(first.result.mfa.factorId, "a".repeat(64)); assert.equal(joined.result.mfa.factorId, first.result.mfa.factorId);
  assert.equal(other.result.mfa.factorId, "b".repeat(64));
  await client.resumePendingMfa(); assert.equal(reads, 3, "settled identity results are not cached");
});

test("pending transition clears only ordinary auth/workspace cookies and uses existing names", () => {
  const updates = mfaCookies.pendingMfaCookieUpdates({ accessToken: "pending", refreshToken: "pending-refresh", rememberLogin: true });
  for (const name of ["sb-access-token", "sb-refresh-token", "remember", "admin", "login-id", "kingpos-current-account-id", "kingpos-current-salon-id", "kingpos-current-manage-salon-id", "kingpos-current-staff-salon-id", "kingpos-selected-workspace"]) assert.equal(updates.find(c => c.name === name).options.maxAge, 0);
  assert.equal(updates.find(c => c.name === "sb-pending-mfa-remember").value, "1");
  const existing = readFileSync("lib/current-context.ts", "utf8");
  for (const update of updates.filter(c => c.name.startsWith("kingpos-current") || c.name === "kingpos-selected-workspace")) assert.ok(existing.includes(`"${update.name}"`));
  const server = readFileSync("lib/supabase/server.ts", "utf8");
  for (const name of ["sb-pending-mfa-access-token", "sb-pending-mfa-refresh-token", "sb-pending-mfa-remember", "sb-pending-mfa-challenge"]) assert.ok(server.includes(`"${name}"`));
});

test("actual existing login form renders only safe Gift return path and existing recovery guidance", () => {
  const React = require("react"), render = require("react-dom/server").renderToStaticMarkup;
  const form = load("app/login/login-form.tsx", {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"), "next/link": { default: props => React.createElement("a", props) }, "next/navigation": { useRouter: () => ({}) },
    "@/components/workspace-language": { WorkspaceText: ({ text }) => text, useWorkspaceTranslation: () => text => text },
    "@/lib/auth-response": {}, "@/lib/auth-fragment": {}, "@/lib/auth-return-fragment": fragment, "@/lib/mfa-resume-client": {},
    "@/app/pos/portable/touch-keyboard": { PortableTouchKeyboard: () => null }, "@/app/pos/portable/device-input-settings": { DeviceInputSettingsButton: () => null },
    "@/lib/supabase/auth-errors": {}, "@/lib/bounded-get": {},
  });
  const token = "a".repeat(64), html = render(React.createElement(form.LoginForm, { nextPath: `/gift-cards?from=share#card=${token}` }));
  assert.ok(html.includes('name="next"')); assert.ok(html.includes('value="/gift-cards?from=share"'));
  assert.equal(html.includes(token), false); assert.ok(html.includes("reopen your original Gift Card link"));
});
