"use server";
import { requireCampaignOwner } from "@/lib/owner-campaigns";
import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { assertAbuseRequest } from "@/lib/abuse-server";

import { createAuthenticatedSupabaseServerClient, createSafetySupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { PostCommentTarget } from "@/types/post-comments";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { updateBeautyProfile } from "@/lib/beauty";
import { cookies } from "next/headers";

export async function loadHiddenPostIdentitiesAction() {
  const client = await createAuthenticatedSupabaseServerClient() ?? await createSafetySupabaseServerClient();
  if (!client) throw new Error("Unable to load hidden posts.");
  const { data, error } = await client.rpc("get_my_hidden_posts");
  if (error) throw new Error("Unable to load hidden posts.");
  return (data ?? []).map((row: {source_type: string; source_id: string}) => `${row.source_type}:${row.source_id}`);
}

export async function postModerationAction(target: PostCommentTarget, action: string, payload: Record<string, unknown> = {}) {
  try {
    if (action === "report") await assertAbuseRequest("report");
    if (action === "edit") await assertAbuseRequest("post");
    const client = await createAuthenticatedSupabaseServerClient() ?? await createSafetySupabaseServerClient();
    if (!client) throw new Error("Post service is unavailable.");
    if (action === "report" || action === "hide") {
      const jar = await cookies();
      const stored = jar.get("reylumi-report-session")?.value;
      const guestId = stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : crypto.randomUUID();
      if (guestId !== stored) jar.set("reylumi-report-session", guestId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
      payload = { ...payload, guestId };
    }
    if (action === "feature" && target.sourceType === "beauty_post") {
      const user = await getCurrentKingUser();
      if (user?.status === "suspended" || user?.status === "deleted") throw new Error("Account is restricted.");
      const { data: post } = await client.from("beauty_posts").select("author_user_id,safety_hold,deleted_at").eq("id", target.sourceId).single();
      if (!user || post?.author_user_id !== user.id || post.safety_hold || post.deleted_at) throw new Error("This post cannot be featured.");
      const { data: media } = await client.from("beauty_post_media").select("object_path").eq("post_id", target.sourceId).neq("role", "before").order("display_order").limit(1).single();
      if (!media) throw new Error("This post has no photo.");
      const path = `${user.id}/beauty/cover/${crypto.randomUUID()}.webp`;
      const { error: copyError } = await client.storage.from("beauty-profile-media").copy(media.object_path, path);
      if (copyError) throw new Error("Could not copy this photo to your profile.");
      const result = await updateBeautyProfile({ coverMediaPath: path });
      if (!result.ok) {
        await client.storage.from("beauty-profile-media").remove([path]);
        throw new Error(result.message);
      }
      revalidatePath("/beauty"); revalidatePath("/explore");
      return { data: { ok: true, coverImageUrl: result.data.coverImageUrl, coverMediaPath: result.data.coverMediaPath }, error: null };
    }
    if (action === "block") {
      const result = await client.rpc("post_user_block", {p_type: target.sourceType, p_id: target.sourceId, p_block: true});
      if (result.error) throw new Error(result.error.message);
      revalidatePath("/explore"); revalidatePath("/beauty"); revalidatePath("/salon-profile");
      return {data: result.data, error: null};
    }
    const { data, error } = await client.rpc("post_safety_action", {
      p_type: target.sourceType, p_id: target.sourceId, p_action: action, p_payload: payload,
    });
    if (error) throw new Error(error.code === "PGRST202" ? "Post safety requires a database update." : error.message);
    if (action === "report") { revalidatePath("/admin/reports"); revalidatePath("/admin/post-safety"); }
    if (action === "permissions") {
      const [blockState, context, campaignOwner] = await Promise.all([
        client.rpc("post_user_block", {p_type: target.sourceType, p_id: target.sourceId, p_block: false}),
        getCurrentBusinessContext(),
        requireCampaignOwner().then(()=>true).catch(()=>false),
      ]);
      // Canonical editor text comes from the authorized RPC, never the
      // potentially shortened title supplied by a feed card.
      const permissions = { ...data };
      if (!permissions.canManage) delete permissions.caption;
      return { data: { ...permissions, canBlock: Boolean(!blockState.error && blockState.data?.canBlock), canPromote: Boolean(campaignOwner && isSalonManageContext(context) && isOwnerMembership(context.currentMembership) && context.currentSalon?.id === target.salonId) }, error: null };
    }
    if (action !== "permissions") { revalidatePath("/explore"); revalidatePath("/salon-profile"); revalidatePath("/beauty"); }
    if(action==="report" && await getCurrentKingUser()) {
      const conversation=await client.rpc("get_my_post_report_conversation",{p_type:target.sourceType,p_id:target.sourceId});
      return {data:{...data,supportHref:conversation.data?`/support/${conversation.data}`:null},error:null};
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Unable to update post." };
  }
}
