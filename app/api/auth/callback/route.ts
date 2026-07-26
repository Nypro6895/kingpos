import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
  getSupabaseCookieOptions,
} from "@/lib/supabase/server";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import { NextResponse } from "next/server";

function sanitizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/account";
  }

  return value;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = sanitizeNextPath(url.searchParams.get("next"));
  const supabase = createSupabaseServerClient();

  if (!supabase || !code) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent("Login link is invalid or expired.")}&next=${encodeURIComponent(nextPath)}`,
        url.origin,
      ),
    );
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    const authError = getSupabaseAuthErrorResponse(
      error,
      "Login link is invalid or expired.",
    );

    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(authError.message)}&next=${encodeURIComponent(nextPath)}`,
        url.origin,
      ),
    );
  }

  const response = NextResponse.redirect(new URL(nextPath, url.origin));
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

  return response;
}
