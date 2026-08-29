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

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const formData = await request.formData();
  const email = readString(formData, "email").toLowerCase();
  const password = readString(formData, "password");
  const requestedPath = readString(formData, "next");
  const nextPath = sanitizeAuthReturnPath(requestedPath);

  if (!supabase) {
    return loginErrorResponse(
      request,
      "Supabase environment variables are missing.",
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

  const navigation = await getPostAuthWorkspaceNavigation({
    accessToken: data.session.access_token,
    requestedPath,
  }).catch((error: unknown) => {
    console.error("Unable to resolve post-login workspace navigation", {
      message: error instanceof Error ? error.message : String(error),
    });

    return fallbackPostAuthWorkspaceNavigation();
  });
  const response = loginSuccessResponse(request, navigation.redirectTo);
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
