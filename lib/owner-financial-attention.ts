import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { isOwnerMembership, type CurrentBusinessContext } from "@/lib/current-context";
import type { OwnerAttentionData } from "@/types/owner-financial-attention";

export async function readOwnerFinancialAttention(context: CurrentBusinessContext, item?: string, page = 0) {
  if (!context.user || !context.currentSalon || !isOwnerMembership(context.currentMembership)) throw new Error("Owner access required");
  if ((item !== undefined && item.length > 180) || !Number.isSafeInteger(page) || page < 0 || page > 100000) throw new Error("Invalid item or page");
  const db = await createAuthenticatedSupabaseServerClient();
  if (!db) throw new Error("Authentication unavailable");
  const result = await db.rpc("owner_financial_attention", { p_salon: context.currentSalon.id, p_item: item ?? null, p_page: page });
  if (result.error) throw new Error("Financial checks could not load. Please retry.");
  const data = result.data as OwnerAttentionData | null;
  if (!data || data.salonId !== context.currentSalon.id || !Array.isArray(data.items)) throw new Error("Financial checks unavailable");
  return { ...data, viewerId: context.user.id };
}
