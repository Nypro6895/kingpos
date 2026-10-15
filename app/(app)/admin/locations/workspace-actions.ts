"use server";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import {
  assertUuid,
  readReason,
  readRequiredFormString,
} from "@/lib/platform-admin/validation";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import type { AdminActionResult } from "../_components/action-form";
export async function takeBusinessReviewAction(
  form: FormData,
): Promise<AdminActionResult> {
  try {
    await requirePlatformAdmin(P.locationsUpdateStatus);
    const kind = readRequiredFormString(form, "kind", "Review type");
    if (kind !== "claims" && kind !== "verification")
      throw new Error("Invalid review type.");
    await callPlatformAdminRpc("take_platform_admin_business_review", {
      p_kind: kind,
      p_id: assertUuid(readRequiredFormString(form, "request_id", "Request")),
    });
    revalidatePath("/admin/locations");
    revalidatePath("/admin");
    return { ok: true, message: "Request assigned to you." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Unable to take this request.",
    };
  }
}
export async function bulkBusinessFollowupAction(
  form: FormData,
): Promise<AdminActionResult> {
  try {
    await requirePlatformAdmin(P.locationsUpdateStatus);
    const ids = form.getAll("ids").map((v) => assertUuid(String(v)));
    if (ids.length < 1 || ids.length > 25)
      throw new Error("Select 1–25 businesses.");
    await callPlatformAdminRpc("bulk_platform_admin_business_followup", {
      p_ids: ids,
      p_reason: readReason(form),
    });
    for (const p of ["/admin/locations", "/admin", "/admin/attention"])
      revalidatePath(p);
    return { ok: true, message: "Selected businesses added to follow-up." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Unable to save follow-up.",
    };
  }
}
export async function businessStatusAction(
  form: FormData,
): Promise<AdminActionResult> {
  try {
    await requirePlatformAdmin(P.locationsUpdateStatus);
    await callPlatformAdminRpc("set_platform_admin_business_workspace_status", {
      p_id: assertUuid(readRequiredFormString(form, "target_id", "Business")),
      p_status: readRequiredFormString(form, "status", "Status"),
      p_expected_status: readRequiredFormString(
        form,
        "expected_status",
        "Current status",
      ),
      p_reason: readReason(form),
    });
    for (const p of ["/admin", "/admin/locations", "/admin/attention"])
      revalidatePath(p);
    return { ok: true, message: "Business status updated." };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Unable to change status.",
    };
  }
}
