import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
  getSupabaseCookieOptions,
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
) {
  if (wantsJsonResponse(request)) {
    return NextResponse.json({ error: message }, { status });
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
      "Supabase environment variables are missing.",
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

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
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
    getSupabaseCookieOptions(data.session.expires_in),
  );
  response.cookies.set(
    REFRESH_TOKEN_COOKIE,
    data.session.refresh_token,
    getSupabaseCookieOptions(60 * 60 * 24 * 30),
  );
  if (navigation.workspace) {
    writeNormalizedWorkspaceContextCookies(response.cookies, navigation.workspace);
  }

  return response;
}
