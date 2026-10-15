"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { assertUuid, readReason, readRequiredFormString } from "@/lib/platform-admin/validation";
import { reviewBusinessClaimAction } from "@/app/claim/actions";
import { reviewSalonVerificationAction } from "@/app/settings/salon-verification-actions";
import { updateRecoveryBackOfficeCaseAction, secureRecoveryBackOfficeAccountAction } from "@/app/settings/recovery-back-office/actions";
import { assignAdminReportAction, updateAdminReportAction, resolveAdminReportAction, closeAdminReportAction, createAdminNoteAction } from "../actions";
import { cancelAdminDeletionAction } from "../workflow-actions";
import { updateSupportThreadAction } from "../inbox/actions";
import { getSupportThread } from "@/lib/platform-admin/inbox";
import { getPlatformAdminReportDetail } from "@/lib/platform-admin/reports";
import { reviewPostSafetyAction } from "../post-safety/actions";
import type { AdminActionResult } from "../_components/action-form";
import type { BusinessClaimRequest } from "@/lib/business-claims";
import type { SalonVerificationRequest } from "@/lib/salon-identity";

export async function reviewDashboardRequestAction(form: FormData): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.locationsUpdateStatus);
  try {
    const id = assertUuid(readRequiredFormString(form, "request_id", "Request"));
    const kind = String(form.get("kind"));
    if (kind !== "claims" && kind !== "verification") throw new Error("Invalid request type.");
    const rows = kind === "claims" ? await callPlatformAdminRpc<BusinessClaimRequest[]>("get_business_claim_requests") : await callPlatformAdminRpc<SalonVerificationRequest[]>("get_salon_verification_requests");
    const row = rows.find(row => row.id === id);
    if (!row || row.status !== "waiting") throw new Error("This request is no longer waiting. Refresh the queue.");
    const decision = String(form.get("decision"));
    if (decision === "request_info") {
      if (!actor.permissions.includes(P.notificationsSend)) throw new Error("Notification permission is required to request information.");
      const body = readRequiredFormString(form, "body", "Message");
      if (body.length > 2000) throw new Error("Message must be 2000 characters or fewer.");
      const outcome = await callPlatformAdminRpc<{ status: string }>("send_platform_admin_notification", {
        p_user_id: row.applicant_user_id, p_title: `More information needed: ${kind === "claims" ? "ownership claim" : "salon verification"}`,
        p_body: body, p_reason: readReason(form), p_request_id: assertUuid(readRequiredFormString(form, "notification_request_id", "Notification request")),
      });
      revalidatePath("/admin"); revalidatePath("/admin/notifications");
      return { ok: true, message: outcome.status === "suppressed" ? "Request recorded; delivery was suppressed by the applicant's preferences. The application remains waiting." : "Information request delivered to the applicant's in-app inbox. The application remains waiting." };
    }
    if (!["approved", "rejected", ...(kind === "verification" ? ["blocked"] : [])].includes(decision)) throw new Error("Choose a valid decision.");
    readReason(form);
    const result = kind === "claims" ? await reviewBusinessClaimAction(form) : await reviewSalonVerificationAction(form);
    if (result.error) return { ok: false, message: result.error };
    revalidatePath("/admin");
    return { ok: true, message: decision === "approved" ? "Application approved." : decision === "blocked" ? "Verification requests blocked." : "Application rejected." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to review this request." }; }
}

export async function dashboardCaseAction(form: FormData): Promise<AdminActionResult> {
  const operation = String(form.get("operation"));
  const permission = operation === "assign" ? P.reportsAssign : operation === "update" ? P.reportsUpdate : operation === "note" ? P.notesCreate : P.reportsResolve;
  await requirePlatformAdmin(permission);
  if (operation === "assign") return assignAdminReportAction(form);
  if (operation === "update") return updateAdminReportAction(form);
  if (operation === "resolve") return resolveAdminReportAction(form);
  if (operation === "resolve_close") {
    const resolved = await resolveAdminReportAction(form);
    if (!resolved.ok) return resolved;
    const closed = await closeAdminReportAction(form);
    return closed.ok ? { ok: true, message: "Case resolved and closed." } : { ok: false, message: `Case resolved, but could not be closed: ${closed.message}` };
  }
  if (operation === "close") return closeAdminReportAction(form);
  if (operation === "note") return createAdminNoteAction(form);
  return { ok: false, message: "Invalid case action." };
}
export async function dashboardCancelDeletionAction(form: FormData) {
  await requirePlatformAdmin(P.usersDelete);
  return cancelAdminDeletionAction(form);
}
export async function dashboardSafetyAction(form: FormData) {
  await requirePlatformAdmin(P.reportsUpdate);
  if (form.get("action") === "block") await requirePlatformAdmin(P.usersSuspend);
  const result = await reviewPostSafetyAction(form);
  if (result.ok) revalidatePath("/admin");
  return result;
}
export async function dashboardRecoveryAction(form: FormData): Promise<AdminActionResult> {
  await requirePlatformAdmin(P.recoveryManage);
  const secure = form.get("operation") === "secure";
  try {
    assertUuid(readRequiredFormString(form, "request_id", "Request"));
    const note = String(form.get("note") || "").trim();
    if (note.length < 3 || note.length > 1000) throw new Error("Provide a reason between 3 and 1000 characters.");
    const result = secure ? await secureRecoveryBackOfficeAccountAction(form) : await updateRecoveryBackOfficeCaseAction(form);
    if (!result.error) revalidatePath("/admin");
    return { ok: !result.error, message: result.error || result.message || "Recovery case updated." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to update recovery case." }; }
}
export async function dashboardLocationNoteAction(form: FormData): Promise<AdminActionResult> {
  await requirePlatformAdmin(P.locationsRead);
  await requirePlatformAdmin(P.notesCreate);
  return createAdminNoteAction(form);
}

export async function dashboardBulkAssignAction(form: FormData): Promise<AdminActionResult> {
  const actor = await requirePlatformAdmin(P.dashboardRead);
  try {
    const selection: unknown = JSON.parse(String(form.get("selection") || "[]"));
    if (!Array.isArray(selection) || selection.length < 1 || selection.length > 25) throw new Error("Select between 1 and 25 conversations or cases.");
    const items = selection.map((item: { id?: string; kind?: string }) => {
      if (!item || (item.kind !== "inbox" && item.kind !== "cases")) throw new Error("Only conversations and support cases can be assigned together.");
      if (!actor.permissions.includes(item.kind === "inbox" ? P.inboxManage : P.reportsAssign)) throw new Error("Assignment permission is required for every selected item.");
      return { id: assertUuid(item.id), kind: item.kind };
    });
    const reason = readReason(form);
    const assignment = String(form.get("assignment"));
    if (!['me', 'unassign'].includes(assignment)) throw new Error("Invalid assignment.");
    let saved = 0;
    for (const item of items) {
      const data = new FormData();
      if (item.kind === "inbox") {
        const detail = await getSupportThread(item.id);
        if (!['new', 'in_progress'].includes(detail.thread.status)) continue;
        data.set("thread_id", item.id); data.set("status", detail.thread.status); data.set("assignment", assignment);
        const result = await updateSupportThreadAction(data);
        if (!result.ok) return { ok: false, message: `${saved} item(s) updated. ${result.message} Refresh before retrying.` };
      } else {
        const detail = await getPlatformAdminReportDetail(item.id);
        if (!['new', 'under_review', 'action_required'].includes(detail.report.status)) continue;
        data.set("report_id", item.id); data.set("reason", reason); data.set("assigned_membership_id", assignment === "me" ? actor.membershipId : "");
        const result = await assignAdminReportAction(data);
        if (!result.ok) return { ok: false, message: `${saved} item(s) updated. ${result.message} Refresh before retrying.` };
      }
      saved++;
    }
    revalidatePath("/admin");
    return { ok: true, message: `${saved} item(s) updated.${saved < items.length ? " Completed items were skipped." : ""}` };
  } catch (error) { revalidatePath("/admin"); return { ok: false, message: error instanceof Error ? error.message : "Unable to assign selected items. Refresh before retrying." }; }
}
