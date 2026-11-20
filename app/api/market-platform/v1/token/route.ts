import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { platformEnabled } from "@/lib/market-platform/server";
import { sealRefreshPair, openRefreshPair } from "@/lib/market-platform/refresh-retry";
import { runtimeFailure } from "@/lib/market-platform/runtime-diagnostics";
export async function POST(request: Request) {
  const requestId=randomUUID();
  const headers = { "Cache-Control": "private, no-store", "Pragma": "no-cache","X-Request-Id":requestId };
  if (!platformEnabled()) return Response.json({ error: "Runtime unavailable" }, { status: 503, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Use a JSON refresh request" }, { status: 415, headers });
  const reader = request.body?.getReader();if (!reader) return Response.json({ error: "Missing refresh request" }, { status: 400, headers });
  const chunks: Uint8Array[] = [];let size = 0;
  try { while (true) { const part = await reader.read();if (part.done) break;size += part.value.byteLength;if (size > 2048) { await reader.cancel();return Response.json({ error: "Request too large" }, { status: 413, headers }); }chunks.push(part.value); } }
  catch { return Response.json({ error: "Invalid request body" }, { status: 400, headers }); }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400, headers }); }
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const isCode = body?.grant_type === "authorization_code", isRefresh = body?.grant_type === "refresh_token";
  const hasRetry = isRefresh && (Object.hasOwn(body,"request_id") || Object.hasOwn(body,"retry_key"));
  const fields = [...(isCode ? ["grant_type", "client_id", "client_secret", "code", "code_verifier"] : ["grant_type", "client_id", "client_secret", "refresh_token"]),...(hasRetry?["request_id","retry_key"]:[])];
  if (!body || (!isCode && !isRefresh) || Object.keys(body).length !== fields.length || Object.keys(body).some(k => !fields.includes(k))
    || typeof body.client_id !== "string" || !uuid.test(body.client_id) || typeof body.client_secret !== "string" || !/^rmc_[A-Za-z0-9_-]{43}$/.test(body.client_secret)
    || (isCode && (typeof body.code !== "string" || !/^rma_[A-Za-z0-9_-]{43}$/.test(body.code) || typeof body.code_verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)))
    || (isRefresh && (typeof body.refresh_token !== "string" || !/^rmr_[A-Za-z0-9_-]{43}$/.test(body.refresh_token)))
    || (hasRetry && (typeof body.request_id!=="string" || !uuid.test(body.request_id) || typeof body.retry_key!=="string" || !/^rmk_[A-Za-z0-9_-]{43}$/.test(body.retry_key)))) return Response.json({ error: "Invalid application grant" }, { status: 400, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ error: "Runtime unavailable" }, { status: 503, headers });
  const access = `rmp_${randomBytes(32).toString("base64url")}`, refresh = `rmr_${randomBytes(32).toString("base64url")}`;
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const common = { p_client: body.client_id, p_client_secret: body.client_secret, p_access_hash: digest(access), p_refresh_hash: digest(refresh) };
  const { data, error } = isCode
    ? await client.rpc("market_platform_exchange_code", { ...common, p_code: body.code, p_verifier: body.code_verifier })
    : hasRetry ? await client.rpc("market_platform_refresh_client_retry",{...common,p_refresh_token:body.refresh_token,p_request:body.request_id,p_retry_hash:digest(body.retry_key),p_receipt:sealRefreshPair({access,refresh},body.retry_key,body.client_id,body.request_id)})
    : await client.rpc("market_platform_refresh_client", { ...common, p_refresh_token: body.refresh_token });
  if(error)runtimeFailure("token",error.code,requestId);
  if(error?.code==="PT429")return Response.json({error:"Too many requests. Retry after the current minute."},{status:429,headers:{...headers,"Retry-After":"60"}});
  if (error) return Response.json({ error: error.code === "42501" ? "Connection expired or revoked. Restart the Owner or synthetic test connection." : "Connection temporarily unavailable. Retry the same refresh attempt with the same request_id and retry_key." }, { status: error.code === "42501" ? 403 : 503, headers });
  if(!data || typeof data.refreshExpiresAt!=="string" || !Number.isFinite(Date.parse(data.refreshExpiresAt)))return Response.json({error:"Connection confirmation unavailable. Retry the same refresh attempt or reconnect."},{status:503,headers});
  let pair={access,refresh};
  try{if(hasRetry)pair=openRefreshPair(data.receipt,body.retry_key,body.client_id,body.request_id);}catch{return Response.json({error:"Connection confirmation unavailable. Retry the same refresh attempt or reconnect."},{status:503,headers});}
  const remaining=typeof data.accessExpiresAt==="string"?Math.max(0,Math.min(900,Math.ceil((Date.parse(data.accessExpiresAt)-Date.now())/1000))):900;
  return Response.json({ token_type: "Bearer", access_token: pair.access, refresh_token: pair.refresh, expires_in: Number.isFinite(remaining)?remaining:900, refresh_expires_at: data.refreshExpiresAt }, { headers });
}
