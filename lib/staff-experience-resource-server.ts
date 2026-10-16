import "server-only";

import { getExperienceContext } from "@/lib/experience-context";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { getCurrentStaffAppointments, type StaffAppointmentsSearchParams } from "@/lib/staff-appointments";
import { getCurrentSalonStaffActivitySummaries, getTodaysStaffWorkday } from "@/lib/staff-workdays";

export class StaffExperienceReadError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function loadStaffExperienceResource(query: URLSearchParams) {
  const kind = query.get("kind") ?? "schedule";
  if (kind === "workday") {
    // Match the existing workday page, including its legacy staff resolution.
    const { context, staff, today, workday } = await getTodaysStaffWorkday();
    if (!context.user) throw new StaffExperienceReadError(401, "Unauthorized");
    if (!context.currentSalon || !staff) throw new StaffExperienceReadError(403, "Staff access changed");
    if (query.get("scope") !== getExperienceContext(context).scope || query.get("staffId") !== staff.id) throw new StaffExperienceReadError(409, "Staff workspace changed");
    const summaries = await getCurrentSalonStaffActivitySummaries([staff.id], context, { workDate: today });
    return { kind, salonId: context.currentSalon.id, staffId: staff.id, result: {
      today, salonName: context.currentSalon.name, activity: summaries.get(staff.id) ?? null,
      workday: workday ? { id: workday.id, status: workday.status, checkInAt: workday.check_in_at, checkOutAt: workday.check_out_at } : null,
    } };
  }
  const identity = await getStaffPortalIdentity();
  if (!identity.context.user) throw new StaffExperienceReadError(401, "Unauthorized");
  if (!identity.context.currentSalon || !identity.staff) throw new StaffExperienceReadError(403, "Staff access changed");
  const scope = getExperienceContext(identity.context).scope;
  if (query.get("scope") !== scope || query.get("staffId") !== identity.staff.id) throw new StaffExperienceReadError(409, "Staff workspace changed");
  if (kind === "schedule") {
    const params: StaffAppointmentsSearchParams = {};
    for (const key of ["range", "status", "bookingId", "date", "quickId", "view"] as const) {
      const value = query.get(key);
      if (value !== null) { if (value.length > 100) throw new StaffExperienceReadError(400, "Invalid schedule filter"); params[key] = value; }
    }
    const { context, ...view } = await getCurrentStaffAppointments(params);
    if (getExperienceContext(context).scope !== scope || view.staff?.id !== identity.staff.id) throw new StaffExperienceReadError(409, "Staff workspace changed");
    return { kind, salonId: identity.context.currentSalon.id, staffId: identity.staff.id, result: view };
  }
  throw new StaffExperienceReadError(400, "Invalid staff view");
}
