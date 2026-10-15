import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getExploreShowcaseLookPage } from "@/lib/explore-showcase-content";
import { nailLookById } from "@/lib/nail-inspiration-catalog";

export type ReferenceFavorite = { key: string; name: string; href: string; nailLookId?: string };
const favoriteKeyPattern = /^(?:directory:|look:|salon:showcase-)[a-zA-Z0-9:_-]{1,170}$/;
const salonIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validReferenceFavoriteKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= 180 && favoriteKeyPattern.test(key);
}

function showcaseFavorite(key: string): ReferenceFavorite | null {
  if (key.startsWith("look:nail-")) {
    const look = nailLookById(key.slice(10));
    return look ? { key, name: look.title, href: `/explore/inspiration/${look.id}`, nailLookId: look.id } : null;
  }
  if (key.startsWith("salon:showcase-")) {
    const id = key.slice(6);
    for (let rank = 1; rank <= 20; rank++) {
      const look = getExploreShowcaseLookPage(`showcase-look-${rank}`);
      if (look && (id === `showcase-${rank}` || id === `showcase-${look.salonName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)) {
        return { key, name: look.salonName, href: `/explore/looks/${look.id}` };
      }
    }
  }
  if (key.startsWith("look:")) {
    const look = getExploreShowcaseLookPage(key.slice(5));
    if (look) return { key, name: `${look.service} · ${look.salonName}`, href: `/explore/looks/${look.id}` };
  }
  return null;
}

export async function resolveReferenceFavorites(keys: string[]): Promise<{ items: ReferenceFavorite[]; error: string | null }> {
  if (keys.length > 40) return { items: [], error: "Too many saved items were requested." };
  const validKeys = [...new Set(keys.filter(validReferenceFavoriteKey))];
  const current = new Map<string, ReferenceFavorite>();
  for (const key of validKeys) {
    const favorite = showcaseFavorite(key);
    if (favorite) current.set(key, favorite);
  }
  const listingIds = validKeys.filter(key => key.startsWith("directory:")).map(key => key.slice(10));
  let error: string | null = null;
  if (listingIds.length) {
    const client = createSupabaseServerClient();
    if (!client) error = "Saved places could not be loaded. Please try again.";
    else {
      const response = await client.rpc("get_public_explore_directory_references", { p_listing_ids: listingIds });
      if (response.error) error = "Saved places could not be loaded. Please try again.";
      else if (Array.isArray(response.data)) {
        for (const row of response.data) {
          if (typeof row?.listing_id !== "string" || !listingIds.includes(row.listing_id)
            || typeof row.salon_id !== "string" || !salonIdPattern.test(row.salon_id)
            || typeof row.salon_name !== "string" || !row.salon_name.trim()) continue;
          const key = `directory:${row.listing_id}`;
          current.set(key, { key, name: row.salon_name.trim(), href: `/explore/salons/${row.salon_id}` });
        }
      }
    }
  }
  return { items: validKeys.flatMap(key => current.has(key) ? [current.get(key)!] : []), error };
}

export async function referenceFavorite(key: string): Promise<ReferenceFavorite | null> {
  return (await resolveReferenceFavorites([key])).items[0] ?? null;
}

export type ReferenceFavoriteCursor = { createdAt: string; itemKey: string };
export function referenceFavoriteCursor(value: string | undefined): ReferenceFavoriteCursor | null {
  if (!value || value.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof cursor.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)
      || !Number.isFinite(Date.parse(cursor.createdAt)) || !validReferenceFavoriteKey(cursor.itemKey)) return null;
    return { createdAt: cursor.createdAt, itemKey: cursor.itemKey };
  } catch { return null; }
}
export function encodeReferenceFavoriteCursor(cursor: ReferenceFavoriteCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
