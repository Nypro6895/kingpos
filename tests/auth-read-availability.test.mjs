import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Request, Response, Headers, URL, AbortController, AbortSignal, DOMException, Uint8Array, setTimeout, clearTimeout, fetch, console: { error() {}, log() {} }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test" } }, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, ...globals });
  return exports;
}
const reads = load("lib/bounded-get.ts");
const auth = load("lib/supabase/auth-rest.ts", { "@/lib/bounded-get": reads });

function fixture({ authError, profileError, sessionError } = {}) {
  let inserts = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: authError ? null : { id: "auth-one" } }, error: authError ?? null }) },
    from: table => {
      const query = { select: () => query, eq: () => query, insert: () => { inserts++; return query; }, maybeSingle: async () => ({ data: table === "users" ? { id: "user-one", status: "active" } : { revoked_at: null }, error: table === "users" ? profileError ?? null : sessionError ?? null }) };
      return query;
    },
    rpc: async () => ({ data: false, error: null }),
  };
  const server = load("lib/supabase/server.ts", {
    "@/lib/abuse-context": { safetyRequestHeaders: async () => ({}) },
    "@supabase/supabase-js": { createClient: () => client },
    "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login", isAccountLoginSessionId: () => true },
    "@/lib/users/account-status": { isDeniedKingUserStatus: () => false },
    "next/headers": { headers: async () => ({ get: () => "Bearer test" }), cookies: async () => ({ get: () => ({ value: "session-one" }) }) },
    "./session-policy": {}, "./auth-rest": auth,
  });
  const user = load("lib/users/current-user.ts", {
    react: { cache: fn => fn }, "@/lib/supabase/server": server, "@/lib/supabase/auth-rest": auth,
    "@/lib/users/account-status": { isDeniedKingUserStatus: () => false },
  });
  return { server, user, inserts: () => inserts };
}

test("strict session reads and current user throw503 for temporary auth outages instead of returning guest", async () => {
  for (const error of [{ status: 503 }, { status: 429 }, { message: "fetch failed" }]) {
    const f = fixture({ authError: error });
    await assert.rejects(f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), auth.AuthAvailabilityError);
    await assert.rejects(f.server.getSupabaseAuthUser(), auth.AuthAvailabilityError);
    await assert.rejects(f.user.getCurrentKingUser(), auth.AuthAvailabilityError);
  }
});

test("confirmed auth rejection remains signed out and never retries or creates a fallback account", async () => {
  for (const status of [401, 403]) {
    const f = fixture({ authError: { status } });
    assert.equal(await f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), null);
    assert.equal(await f.server.getSupabaseAuthUser(), null);
    assert.equal(await f.user.getCurrentKingUser(), null);
    assert.equal(f.inserts(), 0);
  }
});

test("critical account and session status failures remain unavailable; no profile write is attempted", async () => {
  for (const failure of [{ profileError: { code: "", message: "TypeError: fetch failed" } }, { sessionError: { code: "08006", message: "Connection unavailable" } }]) {
    const f = fixture(failure);
    await assert.rejects(f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), auth.AuthAvailabilityError);
    if (failure.profileError) await assert.rejects(f.user.getCurrentKingUser(), auth.AuthAvailabilityError);
    assert.equal(f.inserts(), 0);
  }
});

test("fully verified reads still return the authenticated client and matching user", async () => {
  const f = fixture();
  assert.ok(await f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }));
  assert.equal((await f.user.getCurrentKingUser()).id, "user-one");
});

test("the Supabase deadline wrapper bounds only auth/REST reads and preserves transactional and Storage transport", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, init }); return new Response("unchanged transport", { status: 503 }); };
  const wrapper = load("lib/supabase/auth-rest.ts", { "@/lib/bounded-get": reads }, { fetch: fetcher });
  const controller = new AbortController();
  for (const [url, method] of [["https://db.test/rest/v1/tickets", "POST"], ["https://db.test/auth/v1/token", "POST"], ["https://db.test/storage/v1/object/export", "GET"]]) {
    const init = { method, signal: controller.signal };
    const before = calls.length;
    await wrapper.supabaseDeadlineFetch(url, init);
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1).init, init);
  }
});
