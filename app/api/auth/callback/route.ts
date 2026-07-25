import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
  getSupabaseCookieOptions,
} from "@/lib/supabase/server";
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
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(error?.message ?? "Login link is invalid or expired.")}&next=${encodeURIComponent(nextPath)}`,
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
