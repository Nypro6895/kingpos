import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getAccessTokenFromRequest } from "@/lib/supabase/server";
import { cookies, headers } from "next/headers";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/supabase/session-policy";

export async function GET(request: Request) {
  if ((await headers()).get("x-reylumi-auth-unavailable") === "1") {
    return Response.json({ error: "Authentication temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  let client;
  try {
    client = await createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
  } catch {
    return Response.json({ error: "Authentication temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const adminScope = new URL(request.url).searchParams.get("scope") === "admin";
  const token = await getAccessTokenFromRequest();
  const adminExpired = adminScope && Boolean(client) && (!token || !readAdminSession((await cookies()).get(ADMIN_SESSION_COOKIE)?.value, token));
  return Response.json(
    { authenticated: Boolean(client), adminExpired },
    { headers: { "Cache-Control": "no-store" } },
  );
}
