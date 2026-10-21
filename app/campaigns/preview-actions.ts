"use server";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type { OwnerCampaign } from "@/types/owner-campaign";

/** Read-only owner inspection. Never selects an ad, issues a ticket, closes a period or admits a view. */
export async function loadCampaignPreviewAction(id: string) {
  const { client, salonId } = await requireCampaignOwner();
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Choose a valid campaign.");
  const { data, error } = await client.from("owner_campaigns")
    .select("id,salon_id,source_type,source_id,title,status,area,location,country,state,city,starts_at,ends_at,views,spent_cents,total_price_cents,reserved_credits,released_credits")
    .eq("id",id).eq("salon_id",salonId).single();
  if (error || !data) throw new Error("Campaign preview is unavailable.");
  const c = data as Pick<OwnerCampaign,"id"|"salon_id"|"source_type"|"source_id"|"title"|"status"|"area"|"location"|"country"|"state"|"city"|"starts_at"|"ends_at"|"views"|"spent_cents"|"total_price_cents"|"reserved_credits"|"released_credits">;
  const { data: post, error: postError } = await client.rpc("owner_campaign_post",{p_type:c.source_type,p_source:c.source_id,p_salon:salonId});
  if (postError) throw new Error("Campaign preview is unavailable.");
  let image: string | null = null;
  if (post) {
    image = getSalonProfileMediaUrl(post.media_path);
    if (c.source_type === "custom") {
      const path = typeof post.media_path === "string" ? post.media_path : "";
      if (path) {
        const asset = await client.storage.from("campaign-creatives").createSignedUrl(path.endsWith("/v1/main.webp") ? path.replace(/main\.webp$/,"w960.webp") : path,300);
        if (asset.error) throw new Error("Campaign preview image is unavailable.");
        image = asset.data?.signedUrl ?? null;
      }
    } else if (c.source_type === "beauty_post") {
      const media = await client.from("beauty_post_media").select("object_path").eq("post_id",c.source_id).neq("role","before").order("display_order").limit(1).maybeSingle();
      if (media.error) throw new Error("Campaign preview image is unavailable.");
      image = media.data?.object_path ? client.storage.from("beauty-profile-media").getPublicUrl(media.data.object_path).data.publicUrl : null;
    }
  }
  return { campaign:c, creative:post ? {title:c.title,caption:String(post.caption ?? post.summary ?? ""),image} : null, checkedAt:new Date().toISOString() };
}
