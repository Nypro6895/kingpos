import assert from "node:assert/strict";
import test from "node:test";

import { isMissingSupabaseColumnError } from "../lib/supabase/postgrest-errors.ts";

test("detects missing Postgres columns returned by PostgREST", () => {
  assert.equal(
    isMissingSupabaseColumnError(
      {
        code: "42703",
        message: "column pos_settings.staff_check_in_enabled does not exist",
      },
      "staff_check_in_enabled",
    ),
    true,
  );
});

test("detects schema cache misses for upserts", () => {
  assert.equal(
    isMissingSupabaseColumnError(
      {
        code: "PGRST204",
        message:
          "Could not find the 'staff_check_in_enabled' column of 'pos_settings' in the schema cache",
      },
      "staff_check_in_enabled",
    ),
    true,
  );
});

test("does not match unrelated missing columns", () => {
  assert.equal(
    isMissingSupabaseColumnError(
      {
        code: "42703",
        message: "column staff.passcode_digest does not exist",
      },
      "staff_check_in_enabled",
    ),
    false,
  );
});
