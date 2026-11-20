import { ACCOUNT_LOGIN_SESSION_COOKIE } from "@/lib/account-security-shared";
import { ADMIN_SESSION_COOKIE, REMEMBER_LOGIN_COOKIE, sessionCookieOptions } from "./session-policy";

export const PENDING_MFA_ACCESS_TOKEN_COOKIE = "sb-pending-mfa-access-token";
export const PENDING_MFA_REFRESH_TOKEN_COOKIE = "sb-pending-mfa-refresh-token";
export const PENDING_MFA_REMEMBER_COOKIE = "sb-pending-mfa-remember";
export const PENDING_MFA_CHALLENGE_COOKIE = "sb-pending-mfa-challenge";
export const PENDING_MFA_MAX_AGE_SECONDS = 600;

export type PendingMfaTokens = { accessToken: string; refreshToken: string; rememberLogin: boolean };
export type MfaCookieUpdate = { name: string; value: string; options: ReturnType<typeof sessionCookieOptions> };

/** The proxy cannot import request-scoped workspace loaders. These are the
 * existing workspace preference cookie names, not authentication authority. */
const ordinaryCookies = ["sb-access-token", "sb-refresh-token", REMEMBER_LOGIN_COOKIE, ADMIN_SESSION_COOKIE, ACCOUNT_LOGIN_SESSION_COOKIE,
  "kingpos-current-account-id", "kingpos-current-salon-id", "kingpos-current-manage-salon-id", "kingpos-current-staff-salon-id", "kingpos-selected-workspace"];

export function pendingMfaCookieUpdates(input: PendingMfaTokens): MfaCookieUpdate[] {
  const options = { ...sessionCookieOptions(false), maxAge: PENDING_MFA_MAX_AGE_SECONDS };
  return [
    ...ordinaryCookies.map(name => ({ name, value: "", options: { ...options, maxAge: 0 } })),
    { name: PENDING_MFA_CHALLENGE_COOKIE, value: "", options: { ...options, maxAge: 0 } },
    { name: PENDING_MFA_ACCESS_TOKEN_COOKIE, value: input.accessToken, options },
    { name: PENDING_MFA_REFRESH_TOKEN_COOKIE, value: input.refreshToken, options },
    { name: PENDING_MFA_REMEMBER_COOKIE, value: input.rememberLogin ? "1" : "0", options },
  ];
}

export function writePendingMfaTransition(writer: { set(name: string, value: string, options: ReturnType<typeof sessionCookieOptions>): unknown }, input: PendingMfaTokens) {
  for (const update of pendingMfaCookieUpdates(input)) writer.set(update.name, update.value, update.options);
}
