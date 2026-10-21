"use server";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type { OwnerCampaign } from "@/types/owner-campaign";

type PreviewCampaign = Pick<OwnerCampaign,"id"|"salon_id"|"source_type"|"source_id"|"title"|"status"|"area"|"location"|"country"|"state"|"city"|"starts_at"|"ends_at"|"views"|"spent_cents"|"total_price_cents"|"reserved_credits"|"released_credits"|"created_at"|"owner_paused_at"|"pause_episode_id"|"pause_origin">;
type Accounting = {
  campaign: PreviewCampaign;
  returns: {total:number|null;known:number;closure:number;limit:number;complete:boolean;reason:null|"legacy_unattributed_refunds"|"ledger_mismatch"};
  checkedAt: string;
};
type CreativeResult = {creative:{title:string;caption:string;image:string|null}|null;creativeError:string|null};

/** Read-only owner inspection. Never selects an ad, issues a ticket, closes a period or admits a view. */
export async function loadCampaignPreviewAction(id: string) {
  const { client, salonId, userId } = await requireCampaignOwner();
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Choose a valid campaign.");
  const { data, error } = await client.rpc("campaign_owner_accounting",{p_id:id,p_salon:salonId,p_owner:userId});
  if (error || !data) throw new Error("Campaign preview is unavailable.");
  const accounting = data as Accounting;
  const c = accounting.campaign, refunds = accounting.returns;
  if (c?.id !== id || c.salon_id !== salonId || !refunds ||
    typeof refunds.complete !== "boolean" || ![null,"legacy_unattributed_refunds","ledger_mismatch"].includes(refunds.reason) ||
    ![refunds.known,refunds.closure,refunds.limit].every(value=>Number.isSafeInteger(value)&&value>=0) ||
    (refunds.complete ? !Number.isSafeInteger(refunds.total) || refunds.total! < 0 : refunds.total !== null) ||
    !Number.isFinite(Date.parse(accounting.checkedAt))) throw new Error("Campaign preview is unavailable.");
  // Keep optional reads isolated: a late completion cannot alter a returned report.
  async function readCreative():Promise<CreativeResult> {
    let creative: CreativeResult["creative"] = null;
    let creativeError: string | null = null;
    try {
      const { data: post, error: postError } = await client.rpc("owner_campaign_post",{p_type:c.source_type,p_source:c.source_id,p_salon:salonId});
      if (postError) throw new Error("creative read failed");
      if (post) {
        creative = {title:c.title,caption:String(post.caption ?? post.summary ?? ""),image:null};
        if (c.source_type === "custom") {
          const path = typeof post.media_path === "string" ? post.media_path : "";
          if (path) {
            const asset = await client.storage.from("campaign-creatives").createSignedUrl(path.endsWith("/v1/main.webp") ? path.replace(/main\.webp$/,"w960.webp") : path,300);
            if (asset.error || !asset.data?.signedUrl) throw new Error("image signing failed");
            creative.image = asset.data.signedUrl;
          }
        } else if (c.source_type === "beauty_post") {
          const media = await client.from("beauty_post_media").select("object_path").eq("post_id",c.source_id).neq("role","before").order("display_order").limit(1).maybeSingle();
          if (media.error) throw new Error("media read failed");
          creative.image = media.data?.object_path ? client.storage.from("beauty-profile-media").getPublicUrl(media.data.object_path).data.publicUrl : null;
        } else {
          creative.image = getSalonProfileMediaUrl(post.media_path);
        }
      }
    } catch {
      creativeError = "Preview media could not load. Accounting totals are still available.";
    }
    return {creative,creativeError};
  }
  // Bound the entire optional read/sign chain; accounting must also survive a hung service.
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const media = await Promise.race([
    readCreative(),
    new Promise<CreativeResult>(resolve=>{
      deadline=setTimeout(()=>resolve({creative:null,creativeError:"Preview media is taking longer than expected. Accounting totals are still available."}),2500);
    })
  ]).finally(()=>clearTimeout(deadline));
  return {campaign:c,returns:refunds,checkedAt:accounting.checkedAt,...media};
}
