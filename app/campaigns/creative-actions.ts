"use server";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import sharp from "sharp";

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
    const bytes=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:40000000}).rotate().resize(1600,1600,{fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
    const path=`${salonId}/${userId}/${id}.webp`;
    const {error:upload}=await client.storage.from("campaign-creatives").upload(path,bytes,{contentType:"image/webp",upsert:false});
    if(upload && upload.message!=="The resource already exists")throw new Error("Your image could not upload. Please try again.");
    const {error}=await client.from("owner_campaign_creatives").upsert({id,salon_id:salonId,author_user_id:userId,title,caption,media_path:path},{onConflict:"id",ignoreDuplicates:true});
    if(error)throw new Error("Your ad could not be saved. Please try again.");
    const {data:saved}=await client.from("owner_campaign_creatives").select("title").eq("id",id).eq("salon_id",salonId).eq("author_user_id",userId).single();
    if(!saved)throw new Error("Please reopen the ad and try again.");
    return {ok:true,target:{sourceType:"custom" as const,sourceId:id,salonId,title:saved.title}};
  }catch(error){return {ok:false,message:error instanceof Error?error.message:"Your image could not be opened."};}
}
