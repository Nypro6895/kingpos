import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token || token.length > 200) return NextResponse.json({ entry: null });
  const client = createSupabaseServerClient();
  const result = await client?.rpc("service_relay_entry", { p_token: token });
  return NextResponse.json({ entry: result?.error ? null : result?.data ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
