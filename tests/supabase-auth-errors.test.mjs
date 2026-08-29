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

test("Supabase invalid credential errors return a human-readable message", () => {
  const error = {
    message: "Invalid login credentials",
    name: "AuthApiError",
    status: 400,
  };

  assert.equal(isSupabaseAuthConnectionError(error), false);
  assert.deepEqual(getSupabaseAuthErrorResponse(error, "Unable to log in."), {
    message: "Email or password is incorrect.",
    status: 400,
  });
});

test("Supabase auth API errors keep other user-facing messages", () => {
  const error = {
    message: "Password should be at least 6 characters.",
    name: "AuthApiError",
    status: 422,
  };

  assert.equal(isSupabaseAuthConnectionError(error), false);
  assert.deepEqual(getSupabaseAuthErrorResponse(error, "Unable to create account."), {
    message: "Password should be at least 6 characters.",
    status: 422,
  });
});
