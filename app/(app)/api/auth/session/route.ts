import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const client = await createAuthenticatedSupabaseServerClient();
  return Response.json(
    { authenticated: Boolean(client) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
