import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({
    redirectTo: "/login?message=You have been logged out.",
  });

  response.cookies.delete(ACCESS_TOKEN_COOKIE);
  response.cookies.delete(REFRESH_TOKEN_COOKIE);

  return response;
}
