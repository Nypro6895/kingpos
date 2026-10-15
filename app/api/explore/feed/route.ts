import { NextRequest, NextResponse } from "next/server";
import { normalizeExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import { getExploreVisitorKey } from "@/lib/explore-visitor";
import { classifyExploreSearchError } from "@/lib/explore-search-rpc";
import { exploreFeedErrorMessage } from "@/lib/explore-feed-client";
import { getExploreSocialFeedPage, getExploreSocialFeedUpdates, recordExploreSocialEvents, validateExploreSocialFeedItems } from "@/lib/explore-social-feed";

export async function POST(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const text = await request.text();
    if (text.length > 16384) return NextResponse.json({ error: "Discovery request is too large." }, { status: 400, headers });
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid discovery request." }, { status: 400, headers }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid discovery request." }, { status: 400, headers });
    const visitorKey = await getExploreVisitorKey();
    const cursor = typeof body.cursor === "string" ? body.cursor.slice(0, 4096) : null;
    const discovery = normalizeExploreFeedDiscoveryOptions(body.discovery);
    if (body.mode === "updates") {
      return NextResponse.json(await getExploreSocialFeedUpdates({ cursor, discovery, visitorKey, signal: request.signal }), { headers });
    }
    if (body.mode === "events") {
      const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
      return NextResponse.json(await recordExploreSocialEvents({ cursor, visitorKey, events, signal: request.signal }), { headers });
    }
    if (body.mode === "validate") {
      const contentKeys = Array.isArray(body.contentKeys) ? body.contentKeys.filter((key): key is string => typeof key === "string" && key.length < 160).slice(0, 120) : [];
      // Compact parallel revisions stay below the existing request-size limit.
      const revisions = Array.isArray(body.revisions) ? body.revisions.slice(0, contentKeys.length).flatMap((revision, index) => typeof revision === "string" && /^[0-9a-f]{64}$/.test(revision) ? [{ contentKey: contentKeys[index], revision }] : []) : [];
      return NextResponse.json(await validateExploreSocialFeedItems({ cursor, visitorKey, contentKeys, revisions, signal: request.signal }), { headers });
    }
    const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? Math.min(12, Math.max(1, Math.floor(body.limit))) : 12;
    return NextResponse.json(await getExploreSocialFeedPage({ cursor, discovery, visitorKey, signal: request.signal, limit }), { headers });
  } catch (error) {
    if (request.signal.aborted) return new NextResponse(null, { status: 499, headers });
    const errorKind = classifyExploreSearchError(error);
    console.warn("Explore discovery request failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: exploreFeedErrorMessage(error), errorKind, items: [], hasMore: false, nextCursor: null }, { status: errorKind === "timeout" ? 504 : errorKind === "cursor" ? 409 : 503, headers });
  }
}
