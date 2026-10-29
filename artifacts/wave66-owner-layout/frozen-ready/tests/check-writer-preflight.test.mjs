import test from "node:test";
import assert from "node:assert/strict";
import { checkConfig } from "../scripts/check-writer-preflight.mjs";
test("preflight rejects accidental live target, enabled sales and malformed crypto without displaying values", () => {
  const ref = "abcdefghijklmnopqrst";
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    CHECK_WRITER_ENVIRONMENT: "staging",
    CHECK_WRITER_SALES_ENABLED: "false",
    CHECK_WRITER_ENCRYPTION_KEY: "ab".repeat(32),
    SUPABASE_SERVICE_ROLE_KEY: "private-service-fixture",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-fixture",
  };
  assert.deepEqual(checkConfig(env, ref), []);
  for (const modified of [
    { NEXT_PUBLIC_SUPABASE_URL: "https://differentprojectrefxx.supabase.co" },
    { CHECK_WRITER_ENVIRONMENT: "production" },
    { CHECK_WRITER_SALES_ENABLED: "true" },
    { CHECK_WRITER_ENCRYPTION_KEY: "private-invalid-key" },
    { CHECK_WRITER_ENCRYPTION_KEYS: "invalid-private-json" },
    { CHECK_WRITER_ENCRYPTION_KEYS: "[]" },
    { SUPABASE_SERVICE_ROLE_KEY: "" },
  ]) {
    const result = checkConfig({ ...env, ...modified }, ref);
    assert.ok(result.length);
    assert.ok(!JSON.stringify(result).includes("private-"));
  }
  assert.ok(checkConfig(env, "").length);
});
