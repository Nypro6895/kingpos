import { ACCOUNT_LOGIN_SESSION_COOKIE } from "@/lib/account-security-shared";
import { recordCurrentAccountSessionLogout } from "@/lib/account-security";
import { clearSupabaseSessionCookieWriter, createSupabaseServerClient, REFRESH_TOKEN_COOKIE } from "@/lib/supabase/server";
import { clearWorkspaceContextCookies } from "@/lib/current-context";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  await recordCurrentAccountSessionLogout().catch(() => undefined);
  // Revoke this Supabase session as well as clearing browser cookies.
  try {
    const refresh = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
    const client = createSupabaseServerClient();
    if (client && refresh) {
      const result = await client.auth.refreshSession({ refresh_token: refresh });
      if (result.data.session) await client.auth.signOut({ scope: "local" });
    }
  } catch { /* Local logout still completes when the auth service is unavailable. */ }
  const response = NextResponse.json({
    redirectTo: "/login?message=You have been logged out.",
  });

  clearSupabaseSessionCookieWriter(
    response.cookies,
    cookieStore.getAll().map((cookie) => cookie.name),
  );
  response.cookies.delete(ACCOUNT_LOGIN_SESSION_COOKIE);
  clearWorkspaceContextCookies(response.cookies);

  return response;
}
