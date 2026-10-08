"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { assertUuid, readReason, readRequiredFormString } from "@/lib/platform-admin/validation";
import { suspendPlatformAdminUser, restorePlatformAdminUser } from "@/lib/platform-admin/users";
import { updatePlatformAdminLocationStatus } from "@/lib/platform-admin/locations";
import type { AdminActionResult } from "../_components/action-form";
export async function dashboardAccountAction(form: FormData): Promise<AdminActionResult> {
  try {
    const kind = String(form.get("kind")), operation = String(form.get("operation"));
    if (kind !== "user" && kind !== "location") throw new Error("Invalid record type.");
    if (!["lock", "unlock", "mark", "unmark"].includes(operation)) throw new Error("Invalid operation.");
    const id = assertUuid(readRequiredFormString(form, "target_id", "Record")), reason = readReason(form);
    const permission = operation === "mark" || operation === "unmark" ? kind === "user" ? P.usersUpdate : P.locationsUpdateStatus : kind === "user" ? operation === "lock" ? P.usersSuspend : P.usersRestore : P.locationsUpdateStatus;
    await requirePlatformAdmin(permission);
    if (operation === "mark" || operation === "unmark") await callPlatformAdminRpc("set_platform_admin_attention", { p_target_type: kind, p_target_id: id, p_marked: operation === "mark", p_reason: reason });
    else if (kind === "user") await (operation === "lock" ? suspendPlatformAdminUser : restorePlatformAdminUser)({ userId: id, reason });
    else await updatePlatformAdminLocationStatus({ locationId: id, status: operation === "lock" ? "inactive" : "active", reason });
    for (const path of ["/admin", "/admin/attention", `/admin/${kind === "user" ? "users" : "locations"}`, `/admin/${kind === "user" ? "users" : "locations"}/${id}`, "/admin/audit"]) revalidatePath(path);
    return { ok: true, message: operation === "mark" ? "Added to the attention list." : operation === "unmark" ? "Removed from the attention list." : operation === "lock" ? "Access disabled." : "Access restored." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to update this record." }; }
}
export async function saveDashboardFollowupAction(form: FormData): Promise<AdminActionResult> {
  try {
    const kind = String(form.get("kind"));
    if (kind !== "user" && kind !== "location") throw new Error("Invalid follow-up type.");
    await requirePlatformAdmin(kind === "user" ? P.usersUpdate : P.locationsUpdateStatus);
    const id = assertUuid(readRequiredFormString(form, "target_id", "Record"));
    const assignee = String(form.get("assigned_user_id") || "");
    const due = String(form.get("due_at") || "");
    const expected = String(form.get("expected_updated_at") || "");
    if ((due && !Number.isFinite(Date.parse(due))) || (expected && !Number.isFinite(Date.parse(expected)))) throw new Error("Invalid follow-up date.");
    await callPlatformAdminRpc("save_platform_admin_followup", { p_kind: kind, p_id: id, p_reason: readReason(form), p_assignee: assignee ? assertUuid(assignee) : null, p_due_at: due ? new Date(due).toISOString() : null, p_expected_updated_at: expected || null });
    for (const path of ["/admin", "/admin/attention", `/admin/${kind === "user" ? "users" : "locations"}/${id}`]) revalidatePath(path);
    return { ok: true, message: "Follow-up saved. Assignment and due date are recorded in history." };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Unable to save follow-up." }; }
}
