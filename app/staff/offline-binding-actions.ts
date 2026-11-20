"use server";

import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { getExperienceContext } from "@/lib/experience-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type StaffBindingActionState = { status: "idle" | "saved" | "error"; message: string; approved: boolean; revision: string | null };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export async function confirmStaffAccountAccess(previous: StaffBindingActionState, data: FormData): Promise<StaffBindingActionState> {
  try {
    const context = await getCurrentBusinessContext();
    if (!context.user || !context.currentSalon || !isSalonManageContext(context) || !await hasPermission("staff.manage", context)) throw new Error("Open Staff from your business workspace to review this account.");
    if (data.get("scope") !== getExperienceContext(context).scope) throw new Error("Your workspace changed. Open this staff profile again.");
    const staffId = data.get("staff_id"), viewerId = data.get("viewer_id"), decision = data.get("decision");
    if (!uuid(staffId) || !uuid(viewerId) || !["approve", "revoke"].includes(String(decision))) throw new Error("Open this staff profile again.");
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) throw new Error("Please reconnect and try again.");
    const { data: member, error: memberError } = await client.from("staff").select("id").eq("id", staffId).eq("salon_id", context.currentSalon.id).maybeSingle();
    if (memberError || !member) throw new Error("This staff profile changed. Open it again.");
    if (decision === "approve") {
      if (data.get("confirmed") !== "yes") throw new Error("Confirm that this account belongs to this staff member.");
      const { data: revision, error } = await client.rpc("attest_staff_offline_binding", { p_staff_id: staffId, p_expected_viewer_id: viewerId });
      if (error || !uuid(revision)) throw new Error(error?.code === "P0001" ? error.message : "This account could not be confirmed. Please reconnect and try again.");
      revalidatePath("/staff");
      return { status: "saved", message: "Staff account confirmed.", approved: true, revision };
    }
    const revision = data.get("revision");
    if (!uuid(revision)) throw new Error("The approval changed. Open this profile again.");
    const { error } = await client.rpc("revoke_staff_offline_binding", { p_staff_id: staffId, p_expected_revision: revision });
    if (error) throw new Error(error.code === "P0001" ? error.message : "Access could not be updated. Please reconnect and try again.");
    revalidatePath("/staff");
    return { status: "saved", message: "Device access removed. Online staff access is unchanged.", approved: false, revision: null };
  } catch (error) {
    return { ...previous, status: "error", message: error instanceof Error ? error.message : "Please try again." };
  }
}
