import "server-only";
import { createClient } from "@supabase/supabase-js";
import { platformEnabled } from "./server";
export const publishedHeaders = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  Vary: "Authorization",
  "X-Content-Type-Options": "nosniff",
};
export async function publishedRpc(
  request: Request,
  operation: string,
  args: Record<string, unknown>,
) {
  if (!platformEnabled())
    return {
      response: Response.json(
        { error: "Runtime unavailable" },
        { status: 503, headers: publishedHeaders },
      ),
    };
  const bearer = request.headers.get("authorization") ?? "";
  if (!/^Bearer rmp_[A-Za-z0-9_-]{43}$/.test(bearer))
    return {
      response: Response.json(
        { error: "A valid scoped token is required" },
        { status: 401, headers: publishedHeaders },
      ),
    };
  if (new URL(request.url).search)
    return {
      response: Response.json(
        {
          error:
            "Published endpoints do not accept tenant or field query overrides",
        },
        { status: 400, headers: publishedHeaders },
      ),
    };
  // Original storage paths are service-only; app developers never receive them.
  // No new service key is generated here. Missing server config fails closed.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key =
      operation === "published_media_source"
        ? process.env.SUPABASE_SERVICE_ROLE_KEY
        : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    return {
      response: Response.json(
        { error: "Runtime unavailable" },
        { status: 503, headers: publishedHeaders },
      ),
    };
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("market_platform_" + operation, {
    p_token: bearer.slice(7),
    ...args,
  });
  if (error)
    return {
      response: Response.json(
        {
          error: error.code === "PT429" ? "Too many requests. Retry after the current minute." :
            error.code === "PT404"
              ? "Published data is unavailable"
              : "Grant unavailable for this data group",
        },
        {
          status: error.code === "PT429" ? 429 :
            error.code === "42501" ? 403 : error.code === "PT404" ? 404 : 503,
          headers: {...publishedHeaders,...(error.code==="PT429"?{"Retry-After":"60"}:{})},
        },
      ),
    };
  return { data };
}
