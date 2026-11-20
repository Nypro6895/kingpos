import { writeLoginPolicy, sessionCookieOptions } from "@/lib/supabase/session-policy";
import { recordAdvertisingSignup } from "@/lib/advertising-attribution";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  createSupabaseServerClient,
  clearPendingMfaSessionCookieWriter,
} from "@/lib/supabase/server";
import { readMfaAssurance } from "@/lib/supabase/mfa-assurance";
import { writePendingMfaTransition } from "@/lib/supabase/mfa-session";
import { splitGiftAuthReturn } from "@/lib/auth-return-fragment";
import {
  fallbackPostAuthWorkspaceNavigation,
  getPostAuthWorkspaceNavigation,
} from "@/lib/post-auth-routing";
import { sanitizeAuthReturnPath } from "@/lib/auth-routing";
import { resumeSignupPhonePath } from "@/lib/signup-phone-routing";
import { getSupabaseAuthErrorResponse } from "@/lib/supabase/auth-errors";
import { writeNormalizedWorkspaceContextCookies } from "@/lib/current-context";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedPath = splitGiftAuthReturn(url.searchParams.get("next") ?? "").serverPath;
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

  const assurance = await readMfaAssurance(supabase, data.session.access_token);
  if (assurance === "unavailable") {
    return NextResponse.json({ error: "Two-factor authentication status could not be checked. Please try again later." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (assurance === "required") {
    // A callback never sends SMS or reads the private app before verification.
    const response = NextResponse.redirect(new URL(`/login?mfa=1&next=${encodeURIComponent(nextPath)}`, url.origin));
    writePendingMfaTransition(response.cookies, { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, rememberLogin: true });
    return response;
  }

  await recordAdvertisingSignup(request, data.user);
  const navigation = await getPostAuthWorkspaceNavigation({
    accessToken: data.session.access_token,
    requestedPath: resumeSignupPhonePath(data.user, requestedPath),
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
  clearPendingMfaSessionCookieWriter(response.cookies);
  return response;
}
