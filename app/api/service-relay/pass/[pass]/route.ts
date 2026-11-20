import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function GET(_: Request, { params }: { params: Promise<{ pass: string }> }) {
  const { pass } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(pass)) return NextResponse.json({ error: "Invalid pass" }, { status: 400 });
  const client = createSupabaseServerClient();
  if (!client) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const { data, error } = await client.rpc("service_relay_public_pass", { p_pass: pass });
  return NextResponse.json(data && !error ? data : { error: "Pass unavailable" }, { status: data && !error ? 200 : 404, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
