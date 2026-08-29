import { clearSupabaseSessionCookieWriter } from "@/lib/supabase/server";
import { clearWorkspaceContextCookies } from "@/lib/current-context";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const cookieStore = await cookies();
  const response = NextResponse.json({
    redirectTo: "/login?message=You have been logged out.",
  });

  clearSupabaseSessionCookieWriter(
    response.cookies,
    cookieStore.getAll().map((cookie) => cookie.name),
  );
  clearWorkspaceContextCookies(response.cookies);

  return response;
}
