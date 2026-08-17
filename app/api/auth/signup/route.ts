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

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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
    return NextResponse.json(
      { error: "Supabase environment variables are missing." },
      { status: 500 },
    );
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
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

    return NextResponse.json(
      { error: authError.message },
      { status: authError.status },
    );
  }

  if (!data.session) {
    const loginParams = new URLSearchParams({
      message: "Account created. Please confirm your email, then log in.",
      next: nextPath,
    });

    return NextResponse.json({
      redirectTo: `/login?${loginParams.toString()}`,
    });
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
  const response = NextResponse.json({ redirectTo: navigation.redirectTo });
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
