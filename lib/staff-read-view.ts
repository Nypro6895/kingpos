import type { StaffAppointmentsData } from "@/lib/staff-appointments";
import type { StaffDailyActivitySummary } from "@/lib/staff-workdays";
import type { StaffWorkdayStatus } from "@/types/staff-workday";

export type StaffScheduleReadData = Omit<StaffAppointmentsData, "context">;
export type StaffScheduleResource = { kind: "schedule"; salonId: string; staffId: string; result: StaffScheduleReadData };
export type StaffWorkdayReadData = {
  today: string;
  salonName: string;
  activity: StaffDailyActivitySummary | null;
  workday: { id: string; status: StaffWorkdayStatus; checkInAt: string | null; checkOutAt: string | null } | null;
};
export type StaffWorkdayResource = { kind: "workday"; salonId: string; staffId: string; result: StaffWorkdayReadData };

export const STAFF_WORKDAY_READ_LABELS = {
  auto_checked_out: "Auto checked out", break: "On break", checked_in: "Checked in", checked_out: "Checked out",
  not_checked_in: "Not checked in", unavailable: "Unavailable", working: "Working",
} as const;
