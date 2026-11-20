"use server";

import { getCurrentBusinessContext, isOwnerMembership, isSalonManageContext } from "@/lib/current-context";
import { withSettingsTarget } from "@/lib/settings-target-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function saveStaffCustomerContacts(salonId: string, visible: boolean) {
  return withSettingsTarget(salonId, async () => {
    try {
      const context = await getCurrentBusinessContext();
      if (!context.user || !isSalonManageContext(context) || context.currentSalon?.id !== salonId ||
          !isOwnerMembership(context.currentMembership) || typeof visible !== "boolean")
        throw new Error("Only the salon owner can change this setting.");
      const supabase = await createAuthenticatedSupabaseServerClient();
      if (!supabase) throw new Error("Your session is unavailable. Please sign in again.");
      const {error} = await supabase.rpc("salon_staff_customer_contacts", {p_salon: salonId, p_visible: visible});
      if (error) throw new Error(error.message);
      revalidatePath("/", "layout");
      return {ok: true as const};
    } catch (error) {
      return {ok: false as const, error: error instanceof Error ? error.message : "Could not save customer contact settings."};
    }
  }, "manage");
}
