import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
import { getAccessTokenFromRequest } from "@/lib/supabase/server";
import { ADMIN_SESSION_COOKIE, sessionCookieOptions, touchAdminSession } from "@/lib/supabase/session-policy";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const token = await getAccessTokenFromRequest();
  const value = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!token || !value || !await getCurrentPlatformAdminContext()) {
    return NextResponse.json({ adminExpired: true }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const touched = touchAdminSession(value, token);
  if (!touched) return NextResponse.json({ adminExpired: true }, { status: 401 });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ADMIN_SESSION_COOKIE, touched, sessionCookieOptions(false));
  return response;
}
