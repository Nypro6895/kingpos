import type { Staff } from "@/types/staff";

export const STAFF_WORKDAY_STATUSES = [
  "not_checked_in",
  "checked_in",
  "working",
  "break",
  "unavailable",
  "checked_out",
] as const;

export type StaffWorkdayStatus = (typeof STAFF_WORKDAY_STATUSES)[number];

export type StaffWorkday = {
  id: string;
  organization_id: string;
  salon_id: string;
  staff_id: string;
  work_date: string;
  status: StaffWorkdayStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffWorkdayWithStaff = StaffWorkday & {
  staff: Pick<Staff, "id" | "display_name" | "job_title"> | null;
};
