import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { outputText } = ts.transpileModule(readFileSync("lib/supabase/server.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function session({ status = "active", revoked = false, queryError = false, deleted = false, invalidToken = false } = {}) {
  const pending = new Map();
  const client = {
    auth: { getUser: async () => ({ data: { user: invalidToken ? null : { id: "user" } }, error: null }) },
    from: table => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: () => new Promise(resolve => pending.set(table, resolve)) };
      return query;
    },
    rpc: async () => ({ data: deleted, error: null }),
  };
  const dependencies = {
    "@supabase/supabase-js": { createClient: () => client },
    "@/lib/account-security-shared": { ACCOUNT_LOGIN_SESSION_COOKIE: "login", isAccountLoginSessionId: () => true },
    "@/lib/users/account-status": { isDeniedKingUserStatus: value => ["suspended", "deleted"].includes(value) },
    "next/headers": { headers: async () => ({ get: () => "Bearer test" }), cookies: async () => ({ get: () => ({ value: "session" }) }) },
  };
  const exports = {};
  vm.runInNewContext(outputText, { exports, console: { error() {} }, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://test.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test" } }, require: name => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  } });
  return { pending, run: exports.createAuthenticatedSupabaseServerClient, release() {
    pending.get("users")?.({ data: status ? { status } : null, error: queryError ? { code: "unavailable" } : null });
    pending.get("account_login_sessions")?.({ data: { revoked_at: revoked ? "2026-01-01" : null }, error: null });
  } };
}

test("account and session validation start together, but authentication waits for both", async () => {
  const fixture = session();
  let finished = false;
  const result = fixture.run().then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...fixture.pending.keys()].sort(), ["account_login_sessions", "users"]);
  assert.equal(finished, false);
  fixture.release();
  assert.ok(await result);
});

for (const [name, options] of Object.entries({ suspended: { status: "suspended" }, deleted: { status: "deleted" }, revoked: { revoked: true }, queryFailure: { queryError: true }, deletedIdentity: { status: null, deleted: true } })) {
  test(`parallel validation still rejects ${name}`, async () => {
    const fixture = session(options);
    const result = fixture.run();
    await new Promise(resolve => setImmediate(resolve));
    fixture.release();
    assert.equal(await result, null);
  });
}

test("invalid access token never reaches account/session reads", async () => {
  const fixture = session({ invalidToken: true });
  assert.equal(await fixture.run(), null);
  assert.equal(fixture.pending.size, 0);
});
