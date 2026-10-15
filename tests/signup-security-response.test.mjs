import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(file, dependencies = {}, env = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, { exports, URL, URLSearchParams, console: { error() {} }, process: { env }, require(name) {
    assert.ok(name in dependencies, `Missing test dependency ${name}`);
    return dependencies[name];
  } });
  return exports;
}

function abuseFixture({ preflight = { data: { allowed: true }, error: null }, bot = false, botError = false, botEvent = { data: false, error: null }, ticket = { data: "ticket", error: null } } = {}) {
  const calls = [];
  const api = load("lib/abuse-server.ts", {
    "server-only": {},
    "@supabase/supabase-js": { createClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      return name === "abuse_preflight" ? preflight : name === "record_abuse_bot_event" ? botEvent : ticket;
    } }) },
    "@/lib/abuse-context": { getSafetyContext: async () => ({ deviceHash: "device", ipHash: "network", country: "US" }) },
    "@/lib/users/current-user": { getCurrentKingUser: async () => null },
    "@/lib/abuse-signals": { abuseHash: value => `hashed:${value}` },
    "botid/server": { checkBotId: async () => { if (botError) throw new Error("private provider payload"); return { isBot: bot }; } },
  }, { NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-only", VERCEL: "1" });
  return { api, calls };
}

test("admission distinguishes challenge, quota, restriction and provider outages", async () => {
  for (const [data, code, status] of [
    [{ allowed: false, challengeRequired: true, message: "Complete the check." }, "security_check_required", 403],
    [{ allowed: false, message: "Please complete the security check at /security-check, then try again." }, "security_check_required", 403],
    [{ allowed: false, code: "rate_limited", message: "Too many requests." }, "rate_limited", 429],
    [{ allowed: false, code: "restricted", message: "This action is temporarily restricted." }, "restricted", 403],
    [null, "security_unavailable", 503],
    [{ allowed: "yes" }, "security_unavailable", 503],
  ]) {
    const { api, calls } = abuseFixture({ preflight: { data, error: null } });
    await assert.rejects(api.createSignupTicket("person@example.test"), error => {
      const response = api.getAbuseErrorResponse(error);
      assert.equal(response.code, code);
      assert.equal(response.status, status);
      assert.equal(response.challengeRequired, code === "security_check_required");
      return true;
    });
    assert.equal(calls.some(call => call.name === "issue_abuse_signup_ticket"), false);
  }
});

test("BotID challenges remain recoverable and provider failures never disclose raw errors", async () => {
  for (const [options, expected] of [
    [{ bot: true }, "security_check_required"],
    [{ botError: true }, "security_unavailable"],
    [{ bot: true, botEvent: { data: null, error: { message: "private database payload" } } }, "security_unavailable"],
    [{ preflight: { data: null, error: { message: "private database payload" } } }, "security_unavailable"],
    [{ ticket: { data: null, error: { message: "private database payload" } } }, "security_unavailable"],
  ]) {
    const { api } = abuseFixture(options);
    await assert.rejects(api.createSignupTicket("person@example.test"), error => {
      const response = api.getAbuseErrorResponse(error);
      assert.equal(response.code, expected);
      assert.doesNotMatch(response.error, /private|fixture-only/);
      return true;
    });
  }
  const { api, calls } = abuseFixture({ bot: true, botEvent: { data: true, error: null } });
  assert.equal(await api.createSignupTicket(" PERSON@EXAMPLE.TEST "), "ticket");
  assert.equal(calls.at(-1).args.p_email_hash, "hashed:email:person@example.test");
});

function routeFixture(admissionError) {
  const { api } = abuseFixture();
  let authCalls = 0;
  const route = load("app/(app)/api/auth/signup/route.ts", {
    "@/lib/abuse-server": { getAbuseErrorResponse: api.getAbuseErrorResponse, createSignupTicket: async () => {
      if (admissionError) throw typeof admissionError === "string" ? new api.AbuseRequestError(admissionError, "Safe admission message /security-check") : admissionError;
      return "ticket";
    } },
    "@/lib/supabase/session-policy": { writeLoginPolicy() {}, sessionCookieOptions: () => ({}) },
    "@/lib/advertising-attribution": { recordAdvertisingSignup: async () => {} },
    "@/lib/supabase/server": { createSupabaseServerClient: () => ({ auth: { signUp: async () => {
      authCalls++;
      return { data: { user: { id: "fixture-user" }, session: null }, error: null };
    } } }) },
    "@/lib/post-auth-routing": { fallbackPostAuthWorkspaceNavigation: () => ({ redirectTo: "/explore" }), getPostAuthWorkspaceNavigation: async () => ({ redirectTo: "/explore" }) },
    "@/lib/auth-routing": { sanitizeAuthReturnPath: path => path.startsWith("/") && !path.startsWith("//") ? path : "/explore" },
    "@/lib/supabase/auth-errors": { getSupabaseAuthErrorResponse: () => ({ message: "Invalid credentials.", status: 400 }) },
    "@/lib/current-context": { writeNormalizedWorkspaceContextCookies() {} },
    "next/server": { NextResponse: {
      json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers }),
      redirect: (url, status) => ({ location: url.toString(), status }),
    } },
  });
  const request = (accept = "application/json", valid = true) => {
    const form = new FormData();
    form.set("email", "person@example.test");
    form.set("password", valid ? "fixture-password" : "");
    form.set("next", "/explore");
    return new Request("https://example.test/api/auth/signup", { method: "POST", headers: { accept }, body: form });
  };
  return { route, request, authCalls: () => authCalls };
}

test("signup route returns typed errors without sending a signup request", async () => {
  for (const [code, status] of [["security_check_required", 403], ["rate_limited", 429], ["restricted", 403], ["security_unavailable", 503]]) {
    const fixture = routeFixture(code);
    const response = await fixture.route.POST(fixture.request());
    assert.equal(response.status, status);
    assert.equal(response.body.code, code);
    assert.equal(response.body.challengeRequired, code === "security_check_required");
    assert.equal(response.headers["Cache-Control"], "no-store");
    assert.equal(fixture.authCalls(), 0);
  }
  const fixture = routeFixture(new Error("SECRET provider details"));
  const response = await fixture.route.POST(fixture.request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.body.error, /SECRET|provider/);
  assert.equal(response.body.challengeRequired, false);
});

test("HTML fallback still redirects safely; normal signup and validation still work", async () => {
  const blocked = routeFixture("security_check_required");
  const response = await blocked.route.POST(blocked.request("text/html"));
  assert.equal(response.status, 303);
  const location = new URL(response.location);
  assert.equal(location.pathname, "/signup");
  assert.match(location.searchParams.get("error"), /security-check/);
  assert.equal(location.searchParams.get("next"), "/explore");
  const normal = routeFixture();
  const invalid = await normal.route.POST(normal.request("application/json", false));
  assert.equal(invalid.status, 400);
  assert.equal(normal.authCalls(), 0);
  const success = await normal.route.POST(normal.request());
  assert.equal(success.status, 200);
  assert.ok(success.body.redirectTo.startsWith("/login?"));
  assert.equal(normal.authCalls(), 1);
});

test("auth response reader preserves typed challenge flags and handles non-JSON responses", async () => {
  const { readAuthResponse } = load("lib/auth-response.ts");
  const parsed = await readAuthResponse(Response.json({ error: "Complete check", code: "security_check_required", challengeRequired: true }), "Fallback");
  assert.equal(parsed.challengeRequired, true);
  assert.equal(parsed.code, "security_check_required");
  assert.equal((await readAuthResponse(new Response("<html>Provider checkpoint</html>"), "Fallback")).error, "Fallback");
});
