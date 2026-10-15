"use server";
import { revalidatePath } from "next/cache";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { assertUuid, readReason, readRequiredFormString } from "@/lib/platform-admin/validation";
import type { AdminActionResult } from "./_components/action-form";

async function run(form: FormData, operation: (userId: string) => Promise<AdminActionResult>): Promise<AdminActionResult> {
  try {
    const userId = assertUuid(readRequiredFormString(form, "user_id", "User"));
    const result = await operation(userId);
    if (result.ok) { revalidatePath("/admin"); revalidatePath("/admin/users"); revalidatePath(`/admin/users/${userId}`); revalidatePath("/admin/notifications"); }
    return result;
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unable to complete the admin request." };
  }
}
export async function sendAdminNotificationAction(form: FormData) {
  return run(form, async userId => {
    const result = await callPlatformAdminRpc<{ status: string }>("send_platform_admin_notification", {
      p_user_id: userId, p_title: readRequiredFormString(form, "title", "Title"), p_body: readRequiredFormString(form, "body", "Message"), p_reason: readReason(form), p_request_id: assertUuid(readRequiredFormString(form,"request_id","Request")),
    });
    return { ok: true, message: result.status === "suppressed" ? "Saved. Delivery was suppressed by the recipient's notification preferences." : "Delivered to the user's in-app inbox." };
  });
}
export async function scheduleAdminDeletionAction(form: FormData) {
  return run(form, async userId => {
    await callPlatformAdminRpc("schedule_platform_admin_user_deletion", { p_user_id: userId, p_reason: readReason(form), p_confirmation: String(form.get("confirmation") ?? ""), p_backup_acknowledged: form.get("backup_acknowledged") === "on" });
    return { ok: true, message: "Deletion scheduled with the existing 30-day grace period." };
  });
}
export async function cancelAdminDeletionAction(form: FormData) {
  return run(form, async userId => {
    await callPlatformAdminRpc("cancel_platform_admin_user_deletion", { p_user_id: userId, p_reason: readReason(form) });
    return { ok: true, message: "Pending deletion cancelled. The previous account status was restored." };
  });
}
export async function revokeAdminSessionsAction(form: FormData) {
  return run(form, async userId => {
    const result = await callPlatformAdminRpc<{ revoked: number }>("revoke_platform_admin_user_sessions", { p_user_id: userId, p_reason: readReason(form) });
    return { ok: true, message: `${result.revoked} session(s) revoked.` };
  });
}
export async function updateAdminUserMembershipAction(form: FormData) {
  return run(form, async userId => {
    await callPlatformAdminRpc("update_platform_admin_user_membership",{ p_user_id:userId,p_membership_id:assertUuid(readRequiredFormString(form,"membership_id","Membership")),p_scope:readRequiredFormString(form,"scope","Scope"),p_role:readRequiredFormString(form,"role","Role"),p_status:readRequiredFormString(form,"status","Status"),p_reason:readReason(form) });
    revalidatePath("/admin/businesses"); revalidatePath("/admin/locations");
    return {ok:true,message:"Membership updated. Owner changes require the ownership transfer workflow."};
  });
}
