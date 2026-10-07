"use server";
import { withSettingsTarget } from "@/lib/settings-target-context";


import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";

export async function deleteUnusedRecordAction(kind: "staff" | "services", id: string, expectedSalonId?: string) {
 return withSettingsTarget(expectedSalonId, async () => {
  try {
    if (!['staff', 'services'].includes(kind) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error("Invalid record.");
    }
    const context = await getCurrentBusinessContext();
    if (!context.user || !isSalonManageContext(context) || !context.currentSalon) {
      throw new Error("Open a Business salon workspace before deleting.");
    }
    await requirePermission(`${kind}.manage`, context);
    const supabase = await createAuthenticatedSupabaseServerClient();
    if (!supabase) throw new Error("This feature is temporarily unavailable.");
    const { error } = await supabase.rpc("delete_unused_salon_record", {
      p_kind: kind, p_id: id, p_salon_id: context.currentSalon.id,
    });
    if (error) {
      if (error.code === "23503") {
        if (error.details === "financial_history") throw new Error("Cannot delete: recorded payments, earnings, or payroll must be preserved. Hide this record instead.");
        if (error.details === "booking_history") throw new Error("Cannot delete: this record is used by a booking. Cancel or reassign pending bookings first; hide records needed for completed booking history.");
        throw new Error("Cannot delete: this record is used by a POS session or protected history. Finish or remove draft work first, or hide this record.");
      }
      if (error.code === "42501") throw new Error("You do not have permission to delete this record.");
      throw new Error("Could not delete this record. Refresh and try again.");
    }
    for (const path of ["/staff", "/services", "/settings", "/salon-profile", "/explore", "/bookings", "/pos", `/book/${context.currentSalon.id}`]) revalidatePath(path);
    if (kind === "staff") await broadcastPosStaffChange(context.currentSalon.id, "staff");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : "Could not delete this record." };
  }

 }, "manage");
}
