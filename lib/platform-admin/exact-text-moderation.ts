import "server-only";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { ExactTextModerationState, ExactTextVisibilityInput, ExactTextVisibilityResult } from "@/types/admin-exact-text-moderation";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function unavailableExactTextModeration(message = "The current text could not be verified. Refresh this case before recording a content decision."): ExactTextModerationState {
  return { status: "unavailable", kind: null, contentId: null, parentId: null, salonId: null, body: null, evidenceVersion: null,
    revision: 0, moderationStatus: "unavailable", canHide: false, canRestore: false, blockedReason: message, availabilityVerified: false, history: [] };
}
export async function loadExactTextModeration(reportId: string): Promise<ExactTextModerationState> {
  if (!UUID.test(reportId)) throw new Error("Invalid report.");
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Admin data service is unavailable.");
  const { data, error } = await client.rpc("get_admin_exact_text_moderation", { p_report_id: reportId });
  if (error || !data || !["available", "unavailable"].includes(data.status)) throw new Error("The current text could not be verified. Refresh this case.");
  return data as ExactTextModerationState;
}
export async function setExactTextVisibility(input: ExactTextVisibilityInput): Promise<ExactTextVisibilityResult> {
  if (!input || !UUID.test(input.reportId) || !UUID.test(input.requestId) || !/^[a-f0-9]{64}$/.test(input.expectedVersion) ||
    !["hide", "restore"].includes(input.action) || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.trim().length > 2000) {
    return { ok: false, code: "conflict", message: "Use the current verified text and a reason between 3 and 2000 characters." };
  }
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) return { ok: false, code: "unavailable", message: "Admin data service is unavailable." };
  try {
    const { data, error } = await client.rpc("set_admin_exact_text_visibility", {
      p_report_id: input.reportId, p_request_id: input.requestId, p_expected_version: input.expectedVersion,
      p_action: input.action, p_reason: input.reason.trim(),
    });
    if (error) {
      if (error.code === "42501") return { ok: false, code: "permission", message: "You do not have permission to record this content decision." };
      if (["PGRST202", "42883"].includes(error.code)) return { ok: false, code: "unavailable", message: "The admin data service needs an update. Contact a platform owner." };
      // A transport or unclassified response is not proof the transaction failed.
      return { ok: false, code: "unknown", message: "The decision could not be confirmed. Retry the same decision to check its result." };
    }
    if (!data || typeof data.ok !== "boolean") return { ok: false, code: "unknown", message: "The decision could not be confirmed. Retry the same decision." };
    return data as ExactTextVisibilityResult;
  } catch {
    return { ok: false, code: "unknown", message: "The decision could not be confirmed. Retry the same decision to check its result." };
  }
}
