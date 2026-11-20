import type { ExploreFeedItem } from "@/types/explore";

export type ExploreFeedRevision = { contentKey: string; revision: string };
export type ExploreFeedValidation = {
  error?: string | null;
  contentKeys?: string[];
  unchangedKeys?: string[];
  items?: ExploreFeedItem[];
};

// Include every display/action field, including prices, visibility and viewer
// state. Key ordering must not depend on server/client JSON serialization.
export function serializeExploreFeedItem(item: ExploreFeedItem): string {
  return JSON.stringify(item, (key, value: unknown) => {
    // Time-decaying ranking telemetry is not displayed or used by client
    // actions; the server already freezes the ranking queue for this session.
    if (key === "rankingSignals") return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
}

export async function exploreFeedRevisions(items: ExploreFeedItem[]): Promise<ExploreFeedRevision[]> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return [];
  try {
    return await Promise.all(items.filter(item => item.contentKey).map(async item => {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(serializeExploreFeedItem(item)));
      return { contentKey: item.contentKey!, revision: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
    }));
  } catch {
    // Unsupported/denied crypto falls back to ordinary authoritative hydration.
    return [];
  }
}

export function retainValidatedExploreItems(stored: ExploreFeedItem[], validation: ExploreFeedValidation, revisions: ExploreFeedRevision[]): ExploreFeedItem[] {
  if (validation.error) return [];
  const allowed = new Set(validation.contentKeys ?? []);
  const supplied = new Set(revisions.map(row => row.contentKey));
  const unchanged = new Set((validation.unchangedKeys ?? []).filter(key => supplied.has(key)));
  const fresh = new Map((validation.items ?? []).map(item => [item.contentKey, item]));
  return stored.flatMap(item => {
    if (!item.contentKey || !allowed.has(item.contentKey)) return [];
    const current = fresh.get(item.contentKey);
    return current ? [current] : unchanged.has(item.contentKey) ? [item] : [];
  });
}
