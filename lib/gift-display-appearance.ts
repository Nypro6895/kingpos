import type { GiftReply } from "@/types/gift-card";
import { normalizeGiftDesign, hasSavedGiftDesign } from "@/types/gift-card";

type AppearanceClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: unknown}> };
/** Resolve the salon from the paired display bearer, never from client-supplied salon IDs. */
export async function getGiftDisplayAppearance(client: AppearanceClient, token: unknown): Promise<GiftReply> {
  if (typeof token !== "string" || !token.trim()) throw new Error("Display unavailable");
  const draft = await client.rpc("get_pos_live_draft_by_token", {p_token: token.trim()});
  const row = Array.isArray(draft.data) ? draft.data[0] : null;
  if (draft.error || !row?.salon_id) throw new Error("Display unavailable");
  const catalog = await client.rpc("gift_card_catalog", {p_salon: row.salon_id});
  if (catalog.error || !catalog.data || typeof catalog.data !== "object") throw new Error("Gift card design unavailable");
  const data = catalog.data as GiftReply;
  return {installed: data.installed === true, salonName: data.salonName,
    design: hasSavedGiftDesign(data.design) ? normalizeGiftDesign(data.design) : undefined};
}
