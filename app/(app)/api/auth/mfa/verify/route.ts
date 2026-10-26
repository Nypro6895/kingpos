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
} from "@/lib/supabase/server";
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
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const factorId = readString(formData, "factor_id");
  const challengeId = readString(formData, "challenge_id");
  const code = readString(formData, "code").replace(/\s+/g, "");
  const requestedPath = readString(formData, "next");
  const nextPath = sanitizeAuthReturnPath(requestedPath);

  if (!factorId || !challengeId || !code) {
    return errorResponse("Enter the two-factor verification code.");
  }

  if (!isAccountLoginSessionId(factorId) || !isAccountLoginSessionId(challengeId)) {
    return errorResponse("Two-factor verification could not be found.");
  }

  const pending = await createPendingMfaSupabaseAuthSessionServerClient();

  if (!pending) {
    return errorResponse("Two-factor verification expired. Log in again.", 401);
  }

  const verification = await pending.supabase.auth.mfa.verify({
    challengeId,
    code,
    factorId,
  });

  if (verification.error || !verification.data?.access_token) {
    return errorResponse(
      verification.error?.message ||
        "The two-factor verification code could not be verified.",
      403,
    );
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

  const response = NextResponse.json({ redirectTo: navigation.redirectTo });
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
