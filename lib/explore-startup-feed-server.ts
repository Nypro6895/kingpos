import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { ExploreFeedDiscoveryOptions } from "@/lib/explore-feed-discovery";
import { getExploreSocialFeedPage } from "@/lib/explore-social-feed";
import { EXPLORE_VISITOR_COOKIE } from "@/lib/explore-visitor";

export async function prepareExploreStartupFeed(context: CurrentBusinessContext, discovery: ExploreFeedDiscoveryOptions) {
  let visitorKey: string;
  if (context.user) visitorKey = `user:${context.user.id}`;
  else {
    // Server Components cannot issue the guest cookie. New guests initialize
    // through the existing authorized route; returning guests can reuse it.
    const visitor = (await cookies()).get(EXPLORE_VISITOR_COOKIE)?.value ?? "";
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(visitor)) return null;
    visitorKey = `guest:${createHmac("sha256", secret).update(visitor).digest("hex")}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try { return await getExploreSocialFeedPage({ visitorKey, discovery, limit: 4, signal: controller.signal }); }
  catch { return null; }
  finally { clearTimeout(timer); }
}
