"use server";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { advertisingClient } from "@/lib/explore-advertising";
import { revalidatePath } from "next/cache";
import { normalizeOwnerCampaignSettings } from "@/lib/owner-campaign-rules";
import type { OwnerCampaignSettings } from "@/types/owner-campaign";

export async function saveOwnerCampaignSettingsAction(raw: OwnerCampaignSettings) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.advertisingManage);
  const config = normalizeOwnerCampaignSettings(raw);
  if (Object.keys(config).some(key => config[key as keyof OwnerCampaignSettings] !== raw[key as keyof OwnerCampaignSettings])) return { ok: false, message: "Check the values and try again." };
  const { error } = await advertisingClient().from("owner_campaign_settings").update({ config, updated_at: new Date().toISOString() }).eq("id", true).select("id").single();
  if (error) return { ok: false, message: "Settings could not be saved. Please try again." };
  revalidatePath("/admin/advertising"); revalidatePath("/campaigns"); revalidatePath("/", "layout");
  return { ok: true, message: "Owner campaign settings saved." };
}
export async function reviewOwnerCampaignAction(id: string, approve: boolean) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.advertisingManage);
  const { error } = await advertisingClient().rpc("owner_campaign_review", { p_id: id, p_approve: approve });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/admin/advertising"); revalidatePath("/campaigns");
  return { ok: true, message: approve ? "Campaign approved." : "Campaign not approved. Unused credits have been returned to the owner." };
}

export async function previewOwnerCampaignAction(id:string){
 await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.advertisingManage);
 const client=advertisingClient();
 const {data:c}=await client.from("owner_campaigns").select("source_type,source_id,salon_id").eq("id",id).single();
 if(!c)throw new Error("Ad not found.");
 if(c.source_type!=="custom")return{href:c.source_type==="salon_profile_look"?`/explore/looks/${c.source_id}`:`/explore/salons/${c.salon_id}`,caption:"",image:null};
 const {data:creative}=await client.from("owner_campaign_creatives").select("caption,media_path").eq("id",c.source_id).eq("salon_id",c.salon_id).single();
 if(!creative)throw new Error("Ad not found.");
 const {data:asset}=await client.storage.from("campaign-creatives").createSignedUrl(creative.media_path,600);
 return{href:null,caption:creative.caption,image:asset?.signedUrl??null};
}
