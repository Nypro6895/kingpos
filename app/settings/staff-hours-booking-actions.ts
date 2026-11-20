"use server";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { withSettingsTarget } from "@/lib/settings-target-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function saveStaffHoursBooking(input: {
  salonId: string; staffId: string;
  enabled?: boolean;
  serviceIds?: string[];
}) {
  return withSettingsTarget(input.salonId, async () => {
    try {
      const context = await getCurrentBusinessContext();
      if (!context.user || context.currentSalon?.id !== input.salonId) throw new Error("Choose the selected salon again.");
      await requirePermission(input.serviceIds !== undefined ? "services.manage" : "salon_settings.manage", context);
      const client = await createAuthenticatedSupabaseServerClient();
      if (!client) throw new Error("Your session is unavailable.");
      const staff = await client.from("staff").select("id,is_active").eq("salon_id", input.salonId).eq("id", input.staffId).single();
      if (staff.error || !staff.data) throw new Error("Staff is no longer available in this salon.");
      if (input.serviceIds !== undefined) {
        if (input.enabled !== undefined || !Array.isArray(input.serviceIds) || input.serviceIds.length > 500 || input.serviceIds.some(id => typeof id !== "string")) throw new Error("Invalid service selection.");
        const services = await client.from("services").select("id,is_active,online_booking_enabled").eq("salon_id", input.salonId);
        if (services.error) throw services.error;
        const allowed = new Set((services.data ?? []).filter(s => s.is_active && s.online_booking_enabled).map(s => s.id));
        const ids = new Set(input.serviceIds);
        if ([...ids].some(id => !allowed.has(id))) throw new Error("One of these services is no longer available for online booking. Reload and try again.");
        const existing = await client.from("staff_service_assignments").select("*").eq("salon_id", input.salonId).eq("staff_id", input.staffId);
        if (existing.error) throw existing.error;
        const rows = existing.data ?? [];
        // Preserve custom pricing, durations, effective dates and non-online assignments.
        const changes = rows.filter(row => allowed.has(row.service_id) && (ids.has(row.service_id) !== Boolean(row.is_active && row.online_bookable))).map(row => ({...row, online_bookable: ids.has(row.service_id), is_active: ids.has(row.service_id) ? true : row.is_active, updated_by_user_id: context.user!.id}));
        for (const id of ids) if (!rows.some(row => row.service_id === id)) changes.push({salon_id:input.salonId,staff_id:input.staffId,service_id:id,is_active:true,online_bookable:true,created_by_user_id:context.user.id,updated_by_user_id:context.user.id});
        if (changes.length) {
          const result = await client.from("staff_service_assignments").upsert(changes, {onConflict:"staff_id,service_id",defaultToNull:false});
          if (result.error) throw result.error;
        }
      } else {
        if (typeof input.enabled !== "boolean") throw new Error("Invalid online booking status.");
        if (input.enabled && !staff.data.is_active) throw new Error("Activate this staff member before enabling online booking.");
        const result = await client.from("staff").update({online_booking_enabled:input.enabled}).eq("salon_id",input.salonId).eq("id",input.staffId).select("id").single();
        if (result.error) throw result.error;
      }
      for (const path of ["/settings","/bookings","/services","/staff","/salon-profile","/explore",`/book/${input.salonId}`]) revalidatePath(path);
      return {ok:true as const};
    } catch (error) { return {ok:false as const,error:error instanceof Error ? error.message : "Could not save online booking. Please try again."}; }
  }, "manage");
}
