import { isAuthSessionMissingError } from "@supabase/supabase-js";

/** A server-observed denial, distinct from an unavailable validation service. */
export class AuthRejectionError extends Error {
  constructor(readonly status: 401 | 403) {
    super("Your access has changed. Please sign in again.");
    this.name = "AuthRejectionError";
  }
}

/** Only a confirmed rejection may turn an authenticated request into a guest.
 * Unknown validation failures and service outages leave authority unverified.
 * Keep this helper free of request storage so proxy refresh and server reads
 * use the same policy without sharing identity or caching credentials.
 */
export function isConfirmedAuthRejection(error: unknown, status?: number): boolean {
  const value = error as { status?: number; code?: string } | null;
  const code = value?.code ?? "";
  return isAuthSessionMissingError(error) || [401, 403].includes(status ?? value?.status ?? 0)
    || ["bad_jwt", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "user_not_found", "PGRST301", "PGRST302", "PGRST303"].includes(code);
}
