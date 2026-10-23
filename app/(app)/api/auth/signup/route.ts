import { writeLoginPolicy, sessionCookieOptions } from "@/lib/supabase/session-policy";
import { createSignupTicket, getAbuseErrorResponse } from "@/lib/abuse-server";
import { recordAdvertisingSignup } from "@/lib/advertising-attribution";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import {
  fallbackPostAuthWorkspaceNavigation,
  getPostAuthWorkspaceNavigation,
} from "@/lib/post-auth-routing";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import { writeNormalizedWorkspaceContextCookies } from "@/lib/current-context";
import { NextResponse } from "next/server";

const LOGIN_PATH = "/login";
const SIGNUP_PATH = "/signup";

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

function signupErrorResponse(
  request: Request,
  message: string,
  status: number,
  nextPath: string,
  security?: { code: string; challengeRequired: boolean },
) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ error: message, ...security }, { status, headers: { "Cache-Control": "no-store" } });
  }

  const params = new URLSearchParams({
    error: message,
    next: nextPath,
  });

  return redirectResponse(request, `${SIGNUP_PATH}?${params.toString()}`);
}

function signupSuccessResponse(request: Request, redirectTo: string) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ redirectTo });
  }

  return redirectResponse(request, redirectTo);
}

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const email = readString(formData, "email").toLowerCase();
  const password = readString(formData, "password");
  const displayName = readString(formData, "display_name");
  const requestedPath = readString(formData, "next");
  const nextPath = sanitizeAuthReturnPath(requestedPath);

  if (!supabase) {
    return signupErrorResponse(
      request,
      "This feature is temporarily unavailable. Please try again later.",
      500,
      nextPath,
    );
  }

  if (!email || !password) {
    return signupErrorResponse(
      request,
      "Email and password are required.",
      400,
      nextPath,
    );
  }

  let signupTicket: string;
  try {
    signupTicket = await createSignupTicket(email);
  } catch (error) {
    const security = getAbuseErrorResponse(error);
    return signupErrorResponse(request, security.error, security.status, nextPath, {
      code: security.code,
      challengeRequired: security.challengeRequired,
    });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        abuse_signup_ticket: signupTicket,
        display_name: displayName || email,
      },
    },
  });

  if (error) {
    const authError = getSupabaseAuthErrorResponse(
      error,
      "Unable to create account.",
    );

    return signupErrorResponse(
      request,
      authError.message,
      authError.status,
      nextPath,
    );
  }

  await recordAdvertisingSignup(request, data.user);

  if (!data.session) {
    const loginParams = new URLSearchParams({
      message: "Account created. Please confirm your email, then log in.",
      next: nextPath,
    });

    return signupSuccessResponse(
      request,
      `${LOGIN_PATH}?${loginParams.toString()}`,
    );
  }

  const navigation = await getPostAuthWorkspaceNavigation({
    accessToken: data.session.access_token,
    requestedPath,
  }).catch((error: unknown) => {
    console.error("Unable to resolve post-signup workspace navigation", {
      message: error instanceof Error ? error.message : String(error),
    });

    return fallbackPostAuthWorkspaceNavigation();
  });
  const response = signupSuccessResponse(request, navigation.redirectTo);
  response.cookies.set(
    ACCESS_TOKEN_COOKIE,
    data.session.access_token,
    sessionCookieOptions(true),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    data.session.refresh_token,
    sessionCookieOptions(true),
  );
  if (navigation.workspace) {
    writeNormalizedWorkspaceContextCookies(
      response.cookies,
      navigation.workspace,
    );
  }

  writeLoginPolicy(response.cookies, data.session.access_token, true);
  return response;
}
