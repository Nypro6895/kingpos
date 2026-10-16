import "server-only";
import { createHash } from "node:crypto";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { requireSalonManagePageContext, type SalonManagePageContext } from "@/lib/route-context-guards";
import { requirePermission } from "@/lib/permissions";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import { getCurrentSalonPosSettings } from "@/lib/pos-settings";
import { getContextBusinessDate, getContextBusinessTimezone } from "@/lib/salon-business-clock";
import { isMissingSupabaseColumnError } from "@/lib/supabase/postgrest-errors";
import type { PortableCheckInData } from "@/app/pos/portable/actions";

export const ownerReadEtag = (value: unknown) => `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
export function ownerStaffIds(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  if (!values.length || values.length > 100 || values.some(id => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))) throw Object.assign(new Error("Invalid staff selection"), { status: 400 });
  return [...new Set(values as string[])].sort();
}

/** Check-in never needs services, waiting visits, ticket items or financial totals. */
export async function loadOwnerCheckInData(options: { context?: SalonManagePageContext; ids?: string[] } = {}): Promise<PortableCheckInData> {
  const context = options.context ?? await requireSalonManagePageContext("/pos/check-in");
  await requirePermission(POS_TICKET_PERMISSIONS.manage, context);
  const ids = ownerStaffIds(options.ids), salonId = context.currentSalon.id;
  const [db, today, timezone, settings] = await Promise.all([
    createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), getContextBusinessDate(context),
    getContextBusinessTimezone(context), getCurrentSalonPosSettings(context),
  ]);
  if (!db) throw new Error("Please reconnect and try again.");
  let staffQuery = db.from("staff").select("id,display_name,job_title,passcode_is_default").eq("salon_id", salonId).eq("is_active", true).eq("pos_enabled", true).order("display_name");
  if (ids) staffQuery = staffQuery.in("id", ids);
  const workdays = (legacy = false) => {
    let query = db.from("staff_workdays").select(legacy ? "staff_id,status,check_in_at" : "staff_id,status,check_in_at,check_in_sequence,queue_turn_count").eq("salon_id", salonId).eq("work_date", today);
    if (ids) query = query.in("staff_id", ids);
    return query;
  };
  const [staff, firstWorkdays] = await Promise.all([staffQuery, workdays()]);
  let rows = firstWorkdays;
  if (rows.error && ["check_in_sequence", "queue_turn_count"].some(column => isMissingSupabaseColumnError(rows.error, column))) rows = await workdays(true);
  if (staff.error || rows.error) throw new Error(staff.error?.message ?? rows.error!.message);
  type Workday = { staff_id: string; status: string; check_in_at: string | null; check_in_sequence?: number | null; queue_turn_count?: number | null };
  const byId = new Map((rows.data ?? []).map(row => { const item = row as unknown as Workday; return [item.staff_id, item] as const; }));
  return {
    salonId, salonName: context.currentSalon.name, salonLogoUrl: null, timezone, today, checkInEnabled: settings.staffCheckInEnabled,
    staff: (staff.data ?? []).map(member => {
      const day = byId.get(member.id);
      return { id: member.id, displayName: member.display_name, jobTitle: member.job_title, avatarUrl: null,
        isPasscodeDefault: Boolean(member.passcode_is_default), status: day?.status ?? "not_checked_in",
        checkInAt: day?.check_in_at ?? null, checkInSequence: day?.check_in_sequence ?? null, queueTurnCount: day?.queue_turn_count ?? 0 };
    }),
  };
}
