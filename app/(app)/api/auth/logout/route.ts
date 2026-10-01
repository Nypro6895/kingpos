import { ACCOUNT_LOGIN_SESSION_COOKIE } from "@/lib/account-security-shared";
import { recordCurrentAccountSessionLogout } from "@/lib/account-security";
import { clearSupabaseSessionCookieWriter } from "@/lib/supabase/server";
import { clearWorkspaceContextCookies } from "@/lib/current-context";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  await recordCurrentAccountSessionLogout();
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
