import "server-only";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { Staff } from "@/types/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getExperienceContext } from "@/lib/experience-context";
import { runReadWithDeadline } from "@/lib/bounded-get";

type Identity = { context: CurrentBusinessContext; staff: Pick<Staff, "id" | "salon_id"> | null };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Fresh online presentation only. This never creates an offline binding/lease. */
export async function getStaffOnlineOnlyAccess({ context, staff }: Identity) {
  const { user, currentSalon: salon, currentAccount: account, currentWorkspace: workspace } = context;
  if (!user || !salon || !account || !staff || !workspace
    || ![user.id, salon.id, account.id, staff.id].every(uuid)
    || user.status !== "active" || salon.status !== "active" || account.status !== "active"
    || context.workspaceType !== "salon" || context.salonMode !== "staff"
    || staff.salon_id !== salon.id || context.currentStaffSalon?.id !== salon.id
    || salon.account_id !== account.id || context.accountId !== account.id
    || workspace.type !== "salon" || workspace.salonMode !== "staff"
    || workspace.id !== `staff:${salon.id}` || workspace.salonId !== salon.id || workspace.accountId !== account.id) return null;
  const client = await createAuthenticatedSupabaseServerClient();
  if (!client) throw new Error("Staff online access is temporarily unavailable.");
  const { data, error } = await runReadWithDeadline(Promise.resolve(client.rpc("get_my_staff_online_access", {
    p_staff_id: staff.id, p_salon_id: salon.id, p_account_id: account.id,
  })), 8000);
  if (error) throw new Error("Staff online access is temporarily unavailable.");
  if (!data || typeof data !== "object" || Array.isArray(data)
    || data.version !== 1 || data.state !== "missing" || data.staffId !== staff.id
    || data.viewerId !== user.id || data.salonId !== salon.id || data.accountId !== account.id) return null;
  return { version: 1 as const, staffId: staff.id, viewerId: user.id, salonId: salon.id, scope: getExperienceContext(context).scope };
}
