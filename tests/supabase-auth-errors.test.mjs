import assert from "node:assert/strict";
import test from "node:test";

import {
  SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE,
  getSupabaseAuthErrorResponse,
  isSupabaseAuthConnectionError,
} from "../lib/supabase/auth-errors.ts";

test("Supabase auth connection errors return a service unavailable response", () => {
  const error = {
    message: "fetch failed",
    name: "AuthRetryableFetchError",
    status: 0,
  };

  assert.equal(isSupabaseAuthConnectionError(error), true);
  assert.deepEqual(getSupabaseAuthErrorResponse(error, "Unable to log in."), {
    message: SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE,
    status: 503,
  });
});

test("Supabase auth API errors keep their user-facing message", () => {
  const error = {
    message: "Invalid login credentials",
    name: "AuthApiError",
    status: 400,
  };

  assert.equal(isSupabaseAuthConnectionError(error), false);
  assert.deepEqual(getSupabaseAuthErrorResponse(error, "Unable to log in."), {
    message: "Invalid login credentials",
    status: 400,
  });
});
