import { createClient } from "@supabase/supabase-js";
import { platformEnabled } from "@/lib/market-platform/server";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "Pragma": "no-cache", "Vary": "Authorization" };
  if (!platformEnabled()) return Response.json({ error: "Runtime unavailable" }, { status: 503, headers });
  const bearer = request.headers.get("authorization") ?? "";
  if (!/^Bearer rmp_[A-Za-z0-9_-]{43}$/.test(bearer)) return Response.json({ error: "A valid scoped token is required" }, { status: 401, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Runtime unavailable" }, { status: 503, headers });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("market_platform_runtime", { p_token: bearer.slice(7) });
  if(error?.code==="PT429")return Response.json({error:"Too many requests. Retry after the current minute."},{status:429,headers:{...headers,"Retry-After":"60"}});
  if (error) return Response.json({ error: "Token expired, revoked or lacks permission" }, { status: error.code === "42501" ? 403 : 503, headers });
  return Response.json(data, { headers });
}
