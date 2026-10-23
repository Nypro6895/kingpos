import { writeLoginPolicy, sessionCookieOptions } from "@/lib/supabase/session-policy";
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedPath = url.searchParams.get("next");
  const nextPath = sanitizeAuthReturnPath(requestedPath);
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

  await recordAdvertisingSignup(request, data.user);
  const navigation = await getPostAuthWorkspaceNavigation({
    accessToken: data.session.access_token,
    requestedPath,
  }).catch((error: unknown) => {
    console.error("Unable to resolve post-callback workspace navigation", {
      message: error instanceof Error ? error.message : String(error),
    });

    return fallbackPostAuthWorkspaceNavigation();
  });
  const response = NextResponse.redirect(
    new URL(navigation.redirectTo, url.origin),
  );
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
