"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/lib/platform-admin/permissions";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { assertUuid, readRequiredFormString } from "@/lib/platform-admin/validation";
import { getSupportEmailConfig, supportEmailReady, sendSupportEmail } from "@/lib/support-email";
import { supportServiceClient } from "@/lib/support-server";
import { supportText } from "@/lib/support-rules";
import type { AdminActionResult } from "../_components/action-form";

function refresh(id?: string) { revalidatePath("/admin"); revalidatePath("/admin/inbox"); if (id) revalidatePath(`/admin/inbox/${id}`); }
function field(form: FormData, name: string) { return readRequiredFormString(form, name, name.replaceAll("_", " ")); }

export async function updateSupportThreadAction(form: FormData): Promise<AdminActionResult> {
  await requirePlatformAdmin(P.inboxManage);
  try {
    const id = assertUuid(field(form, "thread_id"));
    await callPlatformAdminRpc("update_platform_support_thread", { p_thread_id: id, p_status: field(form, "status"), p_assignment: String(form.get("assignment") || "keep") });
    refresh(id); return { ok: true, message: "Conversation updated." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to update this conversation." }; }
}

export async function addSupportNoteAction(form: FormData): Promise<AdminActionResult> {
  await requirePlatformAdmin(P.inboxManage);
  try {
    const id = assertUuid(field(form, "thread_id"));
    await callPlatformAdminRpc("record_platform_support_note", { p_thread_id: id, p_request_id: assertUuid(field(form, "request_id")), p_body: supportText(form.get("body"), "Note", 5000), p_kind: String(form.get("kind") || "note") });
    refresh(id); return { ok: true, message: "Recorded in this conversation. No email was sent." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save this note." }; }
}

export async function sendSupportReplyAction(form: FormData): Promise<AdminActionResult & { rotateRequest?: boolean }> {
  const actor = await requirePlatformAdmin(P.inboxReply);
  let threadId: string | undefined;
  try {
    threadId = assertUuid(field(form, "thread_id"));
    const config = await getSupportEmailConfig();
    if (!supportEmailReady(config)) return { ok: false, message: "Support email is not connected. Ask a platform owner to connect it in Settings, or use Open email." };
    const reply = await callPlatformAdminRpc<{ should_send: boolean; id: string; status: string; to: string; subject: string; body: string; name: string }>("prepare_platform_support_reply", { p_thread_id: threadId, p_request_id: assertUuid(field(form, "request_id")), p_body: supportText(form.get("body"), "Reply", 5000) });
    if (!reply.should_send) {
      refresh(threadId);
      return { ok: reply.status === "sent", rotateRequest: reply.status === "failed", message: reply.status === "sent" ? "This reply has already been accepted by the email service." : reply.status === "failed" ? "The previous attempt failed. Review the connection and try again." : "This reply is awaiting delivery confirmation. Check the delivery history before sending again." };
    }
    const outcome = await sendSupportEmail(config, reply);
    const { error } = await supportServiceClient().rpc("finish_support_reply", { p_message_id: reply.id, p_actor_id: actor.userId, p_status: outcome.status, p_provider_id: outcome.providerId ?? null, p_failure_reason: outcome.reason ?? null });
    if (error) {
      console.error("Support reply outcome could not be saved", { code: error.code, messageId: reply.id });
      refresh(threadId);
      return { ok: false, message: "Delivery may have completed, but the result could not be saved. Check the email provider before sending again." };
    }
    refresh(threadId);
    return { ok: outcome.status === "sent", rotateRequest: outcome.status === "failed", message: outcome.status === "sent" ? "Reply accepted by the email service. The customer's mailbox delivery is managed by the provider." : outcome.reason || "Delivery is unconfirmed. Check the email provider before sending again." };
  } catch (error) {
    refresh(threadId);
    return { ok: false, message: error instanceof Error ? error.message : "Unable to send this reply." };
  }
}

export async function resolveSupportDeliveryAction(form: FormData): Promise<AdminActionResult> {
  await requirePlatformAdmin(P.inboxReply);
  try {
    await callPlatformAdminRpc("resolve_platform_support_delivery", { p_message_id: assertUuid(field(form, "message_id")), p_delivered: field(form, "outcome") === "sent", p_reason: supportText(form.get("reason"), "Review reason", 500) });
    refresh(); return { ok: true, message: "Delivery review recorded. No email was sent." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to record delivery review." }; }
}
