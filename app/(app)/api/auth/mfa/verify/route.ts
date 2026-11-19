import { isSameOriginMutation } from "@/lib/request-origin";
import { REMEMBER_LOGIN_SECONDS, writeLoginPolicy } from "@/lib/supabase/session-policy";
import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
  isAccountLoginSessionId,
} from "@/lib/account-security-shared";
import { recordAccountLoginForSession } from "@/lib/account-security";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { resumeSignupPhonePath } from "@/lib/signup-phone-routing";
import {
  clearWorkspaceContextCookies,
  writeNormalizedWorkspaceContextCookies,
} from "@/lib/current-context";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearPendingMfaSessionCookieWriter,
  createPendingMfaSupabaseAuthSessionServerClient,
  getSupabaseCookieOptions,
  validateSupabaseAppSession,
} from "@/lib/supabase/server";
import { readMfaAssurance } from "@/lib/supabase/mfa-assurance";
import { splitGiftAuthReturn } from "@/lib/auth-return-fragment";
import { AuthRejectionError } from "@/lib/supabase/auth-rejection";
import {
  fallbackPostAuthWorkspaceNavigation,
  getPostAuthWorkspaceNavigation,
} from "@/lib/post-auth-routing";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const REMEMBERED_LOGIN_MAX_AGE_SECONDS = REMEMBER_LOGIN_SECONDS;

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Invalid request origin. Reload the page and try again." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const formData = await request.formData();
  const factorId = readString(formData, "factor_id");
  const challengeId = readString(formData, "challenge_id");
  const code = readString(formData, "code").replace(/\s+/g, "");
  const requestedPath = splitGiftAuthReturn(readString(formData, "next")).serverPath;
  const nextPath = sanitizeAuthReturnPath(requestedPath);

  if (!factorId || !challengeId || !code) {
    return errorResponse("Enter the two-factor verification code.");
  }

  if (!isAccountLoginSessionId(factorId) || !isAccountLoginSessionId(challengeId)) {
    return errorResponse("Two-factor verification could not be found.");
  }

  let pending;
  try { pending = await createPendingMfaSupabaseAuthSessionServerClient({ throwOnUnavailable: true }); }
  catch { return errorResponse("Your sign-in could not be checked. Please try again later.", 503); }

  if (!pending) {
    return errorResponse("Two-factor verification expired. Log in again.", 401);
  }

  const verification = await pending.supabase.auth.mfa.verify({
    challengeId,
    code,
    factorId,
  });

  if (verification.error || !verification.data?.access_token || !verification.data?.refresh_token) {
    return errorResponse(
      verification.error?.message ||
        "The two-factor verification code could not be verified.",
      403,
    );
  }

  const assurance = await readMfaAssurance(pending.supabase, verification.data.access_token);
  // A successful verify response alone must never promote an AAL1 session.
  if (assurance === "unavailable") return errorResponse("Two-factor authentication status could not be checked. Please try again later.", 503);
  if (assurance !== "verified") return errorResponse("Two-factor verification is required.", 403);
  try {
    if (!await validateSupabaseAppSession(verification.data.access_token)) return errorResponse("Your session is no longer available. Log in again.", 401);
  } catch (error) {
    return errorResponse(error instanceof AuthRejectionError ? "Your session is no longer available. Log in again." : "Your account could not be checked. Please try again later.", error instanceof AuthRejectionError ? 401 : 503);
  }

  const loginSessionId = randomUUID();
  const [navigation] = await Promise.all([
    getPostAuthWorkspaceNavigation({
      accessToken: verification.data.access_token,
      requestedPath: resumeSignupPhonePath(verification.data.user, nextPath),
    }).catch((error: unknown) => {
      console.error("Unable to resolve post-MFA workspace navigation", {
        message: error instanceof Error ? error.message : String(error),
      });

      return fallbackPostAuthWorkspaceNavigation();
    }),
    recordAccountLoginForSession({
      accessToken: verification.data.access_token,
      requestHeaders: request.headers,
      sessionId: loginSessionId,
    }).catch((error: unknown) => {
      console.error("Unable to record MFA login security session", {
        message: error instanceof Error ? error.message : String(error),
      });
    }),
  ]);

  const response = NextResponse.json({ redirectTo: navigation.redirectTo }, { headers: { "Cache-Control": "private, no-store" } });
  const accessTokenMaxAge = pending.rememberLogin
    ? REMEMBERED_LOGIN_MAX_AGE_SECONDS
    : undefined;
  const sessionMaxAge = pending.rememberLogin
    ? REMEMBERED_LOGIN_MAX_AGE_SECONDS
    : undefined;

  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    verification.data.access_token,
    getSupabaseCookieOptions(accessTokenMaxAge),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    verification.data.refresh_token,
    getSupabaseCookieOptions(sessionMaxAge),
  );
  response.cookies.set(
    ACCOUNT_LOGIN_SESSION_COOKIE,
    loginSessionId,
    getSupabaseCookieOptions(sessionMaxAge),
  );
  writeLoginPolicy(response.cookies, verification.data.access_token, pending.rememberLogin);
  clearPendingMfaSessionCookieWriter(response.cookies);
  clearWorkspaceContextCookies(response.cookies);

  if (navigation.workspace) {
    writeNormalizedWorkspaceContextCookies(response.cookies, navigation.workspace);
  }

  return response;
}
