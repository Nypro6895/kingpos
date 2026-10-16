import "server-only";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Staff } from "@/types/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { isTrustedStaffOfflineBinding, type StaffOfflineBinding } from "./staff-offline-binding";
import { runReadWithDeadline } from "@/lib/bounded-get";

type Identity = { context: CurrentBusinessContext; staff: Pick<Staff, "id" | "salon_id"> };
export type StaffOfflineBindingAuthorization = { state: "approved"; binding: StaffOfflineBinding } | { state: "unconfirmed" | "revoked"; binding: null };
export async function getStaffOfflineBindingAuthorization({ context, staff }: Identity): Promise<StaffOfflineBindingAuthorization> {
  if (!context.user || context.currentSalon?.id !== staff.salon_id) return { state: "unconfirmed", binding: null };
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Staff account approval is temporarily unavailable.");
  const { data, error } = await runReadWithDeadline(Promise.resolve(client.rpc("get_my_staff_offline_binding", { p_staff_id: staff.id })), 8000);
  if (error) throw new Error("Staff account approval is temporarily unavailable.");
  if (data && typeof data === "object" && data.revoked === true) return { state: "revoked", binding: null };
  if (!isTrustedStaffOfflineBinding(data, { staffId: staff.id, viewerId: context.user.id, salonId: staff.salon_id })) return { state: "unconfirmed", binding: null };
  return { state: "approved", binding: data };
}
export async function getTrustedStaffOfflineBinding(identity: Identity) { return (await getStaffOfflineBindingAuthorization(identity)).binding; }

export async function getManagedStaffOfflineBinding(context: CurrentBusinessContext, staffId: string) {
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client || !context.currentSalon) return null;
  const { data, error } = await client.from("staff_offline_bindings").select("viewer_user_id,revision,approved_at,revoked_at").eq("staff_id", staffId).eq("salon_id", context.currentSalon.id).maybeSingle();
  if (error || !data || data.revoked_at) return null;
  return { viewerId: data.viewer_user_id as string, revision: data.revision as string, approvedAt: data.approved_at as string };
}
