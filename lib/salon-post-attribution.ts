import "server-only";
import type { SalonPostAuthorRole } from "@/lib/post-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function loadSalonPostAttribution(ids: string[]) {
  const result = new Map<string, { role: SalonPostAuthorRole; staffId: string | null }>();
  if (!ids.length) return result;
  const client = createSupabaseServerClient();
  if (!client) return result;
  const { data, error } = await client.rpc("get_public_salon_post_attribution", { p_content_ids: [...new Set(ids)] });
  if (error) return result; // Older databases retain salon identity without guessing a staff role.
  for (const row of Array.isArray(data) ? data : []) {
    if (typeof row.content_id === "string" && ["owner", "staff", "salon"].includes(row.author_role)) {
      result.set(row.content_id, { role: row.author_role, staffId: typeof row.staff_id === "string" ? row.staff_id : null });
    }
  }
  return result;
}
