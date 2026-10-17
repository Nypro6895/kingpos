"use server";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { normalizeImage } from "@/lib/normalize-image";
import { createHash } from "node:crypto";

export async function createCampaignCreativeAction(form:FormData) {
  try {
    const {client,salonId,userId}=await requireCampaignOwner();
    const id=String(form.get("id")??"");
    const title=String(form.get("title")??"").trim();
    const caption=String(form.get("caption")??"").trim();
    if(!/^[0-9a-f-]{36}$/i.test(id)||!title||title.length>120||!caption||caption.length>2200)throw new Error("Add a title and a short message for your ad.");
    const {data:existing}=await client.from("owner_campaign_creatives").select("id,title").eq("id",id).eq("salon_id",salonId).eq("author_user_id",userId).maybeSingle();
    if(existing)return {ok:true,target:{sourceType:"custom" as const,sourceId:id,salonId,title:existing.title}};
    const file=form.get("image");
    if(!(file instanceof File)||file.size<1||file.size>5242880||!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Choose a JPG, PNG or WebP image under 5 MB.");
    const { data: bytes } = await normalizeImage(new Uint8Array(await file.arrayBuffer()));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const folder = `${salonId}/${userId}/${id}/optimized-${digest}/v1`;
    const path=`${folder}/main.webp`;
    const {error:upload}=await client.storage.from("campaign-creatives").upload(path,bytes,{contentType:"image/webp",upsert:false});
    if(upload && upload.message!=="The resource already exists")throw new Error("Your image could not upload. Please try again.");
    for (const edge of [480, 960]) {
      const variant = await normalizeImage(bytes, { maxWidth: edge, maxHeight: edge, targetBytes: edge === 480 ? 80 * 1024 : 180 * 1024 });
      const { error } = await client.storage.from("campaign-creatives").upload(`${folder}/w${edge}.webp`, variant.data, { contentType: "image/webp", upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error("Your image could not upload. Please try again.");
    }
    const {error}=await client.from("owner_campaign_creatives").upsert({id,salon_id:salonId,author_user_id:userId,title,caption,media_path:path},{onConflict:"id",ignoreDuplicates:true});
    if(error)throw new Error("Your ad could not be saved. Please try again.");
    const {data:saved}=await client.from("owner_campaign_creatives").select("title").eq("id",id).eq("salon_id",salonId).eq("author_user_id",userId).single();
    if(!saved)throw new Error("Please reopen the ad and try again.");
    return {ok:true,target:{sourceType:"custom" as const,sourceId:id,salonId,title:saved.title}};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:"Your image could not be opened."};}
}
