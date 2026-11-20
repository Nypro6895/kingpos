import { createHash, randomBytes, randomUUID } from "node:crypto";
import { marketPluginContext, MarketOwnerContextError } from "@/lib/market-plugins";
import { unstable_rethrow } from "next/navigation";
import { platformEnabled, platformRpc, PlatformError } from "@/lib/market-platform/server";
import { runtimeFailure } from "@/lib/market-platform/runtime-diagnostics";
export async function GET(request: Request) {
  const requestId=randomUUID();
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff","X-Request-Id":requestId };
  if (!platformEnabled()) return Response.json({ error: "Marketplace connections unavailable" }, { status: 503, headers });
  const query = new URL(request.url).searchParams;
  const client = query.get("client_id"), installation = query.get("installation_id"), challenge = query.get("code_challenge"), state = query.get("state");
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!client || !uuid.test(client) || !installation || !uuid.test(installation) || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge) || query.get("code_challenge_method") !== "S256" || !state || !/^[A-Za-z0-9_-]{32,128}$/.test(state) || query.get("response_type") !== "code") return Response.json({ error: "Invalid authorization request" }, { status: 400, headers });
  try {
    const code = `rma_${randomBytes(32).toString("base64url")}`;
    const common = { p_installation: installation, p_client: client, p_challenge: challenge, p_code_hash: createHash("sha256").update(code).digest("hex") };
    const synthetic = query.get("sandbox") === "true";
    if (query.has("sandbox") && !synthetic) return Response.json({ error: "Invalid sandbox mode" }, { status: 400, headers });
    const info = synthetic
      ? await platformRpc<{ launchUrl: string }>("sandbox_authorize", common)
      : await platformRpc<{ launchUrl: string }>("authorize", { ...common, p_salon: (await marketPluginContext()).salonId });
    const callback = new URL(info.launchUrl);callback.searchParams.set("code", code);callback.searchParams.set("state", state);
    return new Response(null, { status: 303, headers: { ...headers, Location: callback.href } });
  } catch(error) {
    unstable_rethrow(error);
    if(error instanceof PlatformError && error.code==="AUTH_REQUIRED" || error instanceof MarketOwnerContextError && error.reason==="signin")return Response.json({error:"Sign in to your Reylumi account, then reopen this connection."},{status:401,headers});
    runtimeFailure("authorize",error instanceof PlatformError?error.code:undefined,requestId);
    if(error instanceof PlatformError && error.code==="PT429")return Response.json({error:"Too many requests. Retry after the current minute."},{status:429,headers:{...headers,"Retry-After":"60"}});
    if(!(error instanceof MarketOwnerContextError) && (!(error instanceof PlatformError) || error.outcome==="unknown"))return Response.json({error:"Connection temporarily unavailable. Try again later."},{status:503,headers});
    return Response.json({ error: query.get("sandbox")==="true" ? "Synthetic connection unavailable. Reset the synthetic test salon in Testing & readiness and prepare the connection again." : "This connection is unavailable for your current active Owner salon. Return to Market and reconnect." }, { status: 403, headers });
  }
}
