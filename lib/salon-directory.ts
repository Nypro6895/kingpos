import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SalonDirectoryListing = {
  listingId: string;
  claimState: "unclaimed" | "claimed";
  sourceUrl: string;
  sourceType: "business_website" | "directory";
  categories: string[];
  collectedOn: string;
  referencePostId: string | null;
  notes: string;
};

export async function getPublicSalonDirectoryListing(salonId: string): Promise<SalonDirectoryListing | null> {
  const client = await createSupabaseServerClient();
  if (!client) return null;
  const { data, error } = await client.rpc("get_public_salon_directory_listing", { target_salon_id: salonId });
  if (error || !Array.isArray(data) || !data[0]) return null;
  const row = data[0];
  return {
    listingId: row.listing_id,
    claimState: row.claim_state,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    categories: row.source_categories ?? [],
    collectedOn: row.collected_on,
    referencePostId: row.reference_post_id,
    notes: row.source_notes ?? "",
  };
}

export async function getDirectorySalonLinks(listingIds: string[]): Promise<Map<string, { salonId: string; claimState: "unclaimed" | "claimed" }>> {
  const client = await createSupabaseServerClient();
  const links = new Map<string, { salonId: string; claimState: "unclaimed" | "claimed" }>();
  if (!client || !listingIds.length) return links;
  const { data, error } = await client.rpc("get_public_directory_salon_links", { p_listing_ids: listingIds });
  if (error || !Array.isArray(data)) return links;
  for (const row of data) links.set(row.listing_id, { salonId: row.salon_id, claimState: row.claim_state });
  return links;
}
