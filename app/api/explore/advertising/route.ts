import { getCampaigns, advertisingClient } from "@/lib/explore-advertising";
import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
function visitorHash(request: NextRequest) {
  const configured = process.env.VERCEL
    ? "x-vercel-forwarded-for"
    : (process.env.ADVERTISING_TRUSTED_IP_HEADER ?? "x-forwarded-for");
  const ip = [
    "cf-connecting-ip",
    "x-vercel-forwarded-for",
    "x-forwarded-for",
  ].includes(configured)
    ? request.headers.get(configured)?.split(",")[0]?.trim()
    : null;
  // Production must use IP headers provided and overwritten by the trusted hosting proxy.
  const identity =
    ip ??
    request.cookies.get("reylumi-ad-visitor")?.value ??
    crypto.randomUUID();
  const secret =
    process.env.ADVERTISING_IP_HASH_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Advertising is unavailable.");
  return {
    hash: createHmac("sha256", secret).update(identity).digest("hex"),
    identity,
    ip,
  };
}
export async function GET(request: NextRequest) {
  try {
    const campaigns = await getCampaigns(true);
    const visitor = visitorHash(request);
    const ids = campaigns
      .filter((c) => c.kind === "popup" && c.repeat !== "always")
      .map((c) => c.id);
    const { data, error } = ids.length
      ? await advertisingClient()
          .from("explore_campaign_impressions")
          .select("campaign_id,last_seen")
          .eq("visitor_hash", visitor.hash)
          .in("campaign_id", ids)
      : { data: [], error: null };
    if (error) throw error;
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
    }).format(new Date());
    const allowed = campaigns.filter((c) => {
      const seen = data?.find((row) => row.campaign_id === c.id);
      return (
        !seen ||
        c.repeat === "always" ||
        (c.repeat === "daily" &&
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "America/Chicago",
          }).format(new Date(seen.last_seen)) !== today)
      );
    });
    const response = NextResponse.json(
      { campaigns: allowed },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (!visitor.ip)
      response.cookies.set("reylumi-ad-visitor", visitor.identity, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 31536000,
      });
    return response;
  } catch {
    return NextResponse.json(
      { campaigns: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ allowed: false }, { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id))
      return NextResponse.json({ allowed: false }, { status: 400 });
    const visitor = visitorHash(request);
    const { data, error } = await advertisingClient().rpc(
      "claim_explore_popup",
      { p_campaign: body.id, p_visitor: visitor.hash },
    );
    if (error) throw error;
    return NextResponse.json(
      { allowed: data === true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ allowed: false }, { status: 503 });
  }
}
