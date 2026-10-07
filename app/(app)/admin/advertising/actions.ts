"use server";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { advertisingClient } from "@/lib/explore-advertising";
import {
  parseCampaign,
  CampaignValidationError,
} from "@/lib/explore-advertising-rules";
import { revalidatePath } from "next/cache";
export async function campaignImageUploadAction(mime: string, size: number) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.businessesUpdate);
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime) ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > 10485760
  )
    throw new Error("Choose a JPG, PNG, WebP or GIF under 10 MB.");
  const client = advertisingClient();
  const path = `uploads/${crypto.randomUUID()}.${mime.split("/")[1]}`;
  const { data, error } = await client.storage
    .from("explore-advertising")
    .createSignedUploadUrl(path);
  if (error || !data) throw new Error("Image upload is unavailable.");
  return {
    path,
    token: data.token,
    url: client.storage.from("explore-advertising").getPublicUrl(path).data
      .publicUrl,
  };
}
export async function saveCampaignAction(
  _previous: { ok: boolean; message: string; id?: string },
  form: FormData,
) {
  const actor = await requirePlatformAdmin(
    PLATFORM_ADMIN_PERMISSIONS.businessesUpdate,
  );
  try {
    const file = form.get("image");
    if (file instanceof File && file.size)
      form.set("imageUrl", "/advertising-upload-pending");
    const campaign = parseCampaign(form);
    if (file instanceof File && file.size) {
      if (
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          file.type,
        ) ||
        file.size > 10485760
      )
        throw new Error("Choose a JPG, PNG, WebP or GIF under 10 MB.");
      const path = `${campaign.id}/${crypto.randomUUID()}.${file.type.split("/")[1]}`;
      const { error } = await advertisingClient()
        .storage.from("explore-advertising")
        .upload(path, file, { contentType: file.type });
      if (error) throw new Error("Image upload failed.");
      campaign.imageUrl = advertisingClient()
        .storage.from("explore-advertising")
        .getPublicUrl(path).data.publicUrl;
    }
    const { error } = await advertisingClient()
      .from("explore_campaigns")
      .upsert({
        id: campaign.id,
        config: campaign,
        updated_by: actor.userId,
        updated_at: new Date().toISOString(),
      });
    if (error) throw new Error("Campaign could not be saved.");
    revalidatePath("/admin/advertising");
    return { ok: true, message: "Campaign saved.", id: campaign.id };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Unable to save campaign.",
      id: _previous.id,
      errors: error instanceof CampaignValidationError ? error.fields : {},
    };
  }
}
export async function deleteCampaignAction(form: FormData) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.businessesUpdate);
  const { error } = await advertisingClient()
    .from("explore_campaigns")
    .delete()
    .eq("id", String(form.get("id")));
  if (error) throw new Error("Campaign could not be deleted.");
  revalidatePath("/admin/advertising");
}
