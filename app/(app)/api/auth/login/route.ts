import { isSameOriginMutation } from "@/lib/request-origin";
import { readMfaAssurance } from "@/lib/supabase/mfa-assurance";
import { resumeMfaChallenge } from "@/lib/supabase/mfa-challenge";
import { PENDING_MFA_CHALLENGE_COOKIE, PENDING_MFA_MAX_AGE_SECONDS, writePendingMfaTransition } from "@/lib/supabase/mfa-session";
import { splitGiftAuthReturn } from "@/lib/auth-return-fragment";
import { REMEMBER_LOGIN_SECONDS, writeLoginPolicy } from "@/lib/supabase/session-policy";
import { assertAbuseRequest } from "@/lib/abuse-server";
import {
  ACCOUNT_LOGIN_SESSION_COOKIE,
} from "@/lib/account-security-shared";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearPendingMfaSessionCookieWriter,
  createSupabaseServerClient,
  getSupabaseCookieOptions,
} from "@/lib/supabase/server";
import { recordAccountLoginForSession } from "@/lib/account-security";
import {
  fallbackPostAuthWorkspaceNavigation,
  getPostAuthWorkspaceNavigation,
} from "@/lib/post-auth-routing";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { resumeSignupPhonePath } from "@/lib/signup-phone-routing";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import {
  clearWorkspaceContextCookies,
  writeNormalizedWorkspaceContextCookies,
} from "@/lib/current-context";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const LOGIN_PATH = "/login";
const REMEMBERED_LOGIN_MAX_AGE_SECONDS = REMEMBER_LOGIN_SECONDS;

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function wantsJsonResponse(request: Request) {
  return (request.headers.get("accept") ?? "")
    .toLowerCase()
    .includes("application/json");
}

function redirectResponse(request: Request, path: string) {
  return NextResponse.redirect(new URL(path, request.url), 303);
}

function loginErrorResponse(
  request: Request,
  message: string,
  status: number,
  nextPath: string,
) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ error: message }, { status });
  }

  const params = new URLSearchParams({
    error: message,
    next: nextPath,
  });

  return redirectResponse(request, `${LOGIN_PATH}?${params.toString()}`);
}

function loginSuccessResponse(request: Request, redirectTo: string) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ redirectTo });
  }

  return redirectResponse(request, redirectTo);
}

function loginMfaRequiredResponse(input: {
  challenge: NonNullable<import("@/lib/auth-response").AuthResponse["mfa"]>;
  challengeCookie: string;
  nextPath: string;
  rememberLogin: boolean;
  request: Request;
  session: {
    access_token: string;
    refresh_token: string;
  };
}) {
  const response = wantsJsonResponse(input.request)
    ? NextResponse.json({ mfa: input.challenge }, { headers: { "Cache-Control": "private, no-store" } })
    : redirectResponse(input.request, `/login?mfa=1&next=${encodeURIComponent(input.nextPath)}`);
  clearPendingMfaSessionCookieWriter(response.cookies);
  writePendingMfaTransition(response.cookies, {
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    rememberLogin: input.rememberLogin,
  });
  response.cookies.set(PENDING_MFA_CHALLENGE_COOKIE, input.challengeCookie, getSupabaseCookieOptions(PENDING_MFA_MAX_AGE_SECONDS));
  clearWorkspaceContextCookies(response.cookies);

  return response;
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Invalid request origin. Reload the page and try again." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const email = readString(formData, "email").toLowerCase();
  const password = readString(formData, "password");
  const requestedPath = splitGiftAuthReturn(readString(formData, "next")).serverPath;
  const nextPath = sanitizeAuthReturnPath(requestedPath);
  const rememberLogin = formData.get("remember_me") === "on";

  if (!supabase) {
    return loginErrorResponse(
      request,
      "This feature is temporarily unavailable. Please try again later.",
      500,
      nextPath,
    );
  }

  if (!email || !password) {
    return loginErrorResponse(
      request,
      "Email and password are required.",
      400,
      nextPath,
    );
  }

  try { await assertAbuseRequest("login", email); } catch (error) { return loginErrorResponse(request, error instanceof Error ? error.message : "Please try again later.", 429, nextPath); }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    const authError = getSupabaseAuthErrorResponse(error, "Unable to log in.");

    return loginErrorResponse(
      request,
      authError.message,
      authError.status,
      nextPath,
    );
  }

  const assurance = await readMfaAssurance(supabase, data.session.access_token);
  if (assurance === "unavailable") return loginErrorResponse(request, "Two-factor authentication status could not be checked. Please try again later.", 503, nextPath);
  if (assurance === "required") {
    const mfaChallenge = await resumeMfaChallenge(supabase, data.session.access_token);
    if (mfaChallenge.error) return loginErrorResponse(request, mfaChallenge.error, 503, nextPath);
    return loginMfaRequiredResponse({
      challenge: mfaChallenge.challenge!, challengeCookie: mfaChallenge.cookie!,
      nextPath, rememberLogin, request, session: data.session,
    });
  }

  const loginSessionId = randomUUID();
  const [navigation] = await Promise.all([
    getPostAuthWorkspaceNavigation({
      accessToken: data.session.access_token,
      requestedPath: resumeSignupPhonePath(data.user, requestedPath),
    }).catch((error: unknown) => {
      console.error("Unable to resolve post-login workspace navigation", {
        message: error instanceof Error ? error.message : String(error),
      });

      return fallbackPostAuthWorkspaceNavigation();
    }),
    recordAccountLoginForSession({
      accessToken: data.session.access_token,
      requestHeaders: request.headers,
      sessionId: loginSessionId,
    }).catch((error: unknown) => {
      console.error("Unable to record login security session", {
        message: error instanceof Error ? error.message : String(error),
      });
    }),
  ]);

  const response = loginSuccessResponse(request, navigation.redirectTo);
  const accessTokenMaxAge = rememberLogin ? REMEMBERED_LOGIN_MAX_AGE_SECONDS : undefined;
  const sessionMaxAge = rememberLogin
    ? REMEMBERED_LOGIN_MAX_AGE_SECONDS
    : undefined;

  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    data.session.access_token,
    getSupabaseCookieOptions(accessTokenMaxAge),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    data.session.refresh_token,
    getSupabaseCookieOptions(sessionMaxAge),
  );
  response.cookies.set(
    ACCOUNT_LOGIN_SESSION_COOKIE,
    loginSessionId,
    getSupabaseCookieOptions(sessionMaxAge),
  );
  writeLoginPolicy(response.cookies, data.session.access_token, rememberLogin);
  clearPendingMfaSessionCookieWriter(response.cookies);
  if (navigation.workspace) {
    writeNormalizedWorkspaceContextCookies(response.cookies, navigation.workspace);
  }

  return response;
}
