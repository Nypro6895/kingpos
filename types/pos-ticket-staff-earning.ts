import type { Staff } from "@/types/staff";

export type PosTicketStaffEarning = {
  big_turn_count: number;
  bonus_amount: number;
  calculation_version: number;
  commission_amount: number;
  created_at: string;
  deduction_amount: number;
  first_big_turn_sequence: number | null;
  first_small_turn_sequence: number | null;
  id: string;
  last_big_turn_sequence: number | null;
  last_small_turn_sequence: number | null;
  locked_at: string | null;
  organization_id: string;
  payroll_batch_id: string | null;
  salon_id: string;
  service_total: number;
  small_turn_count: number;
  staff_id: string;
  ticket_id: string;
  tip_amount: number;
  total_earning: number;
  updated_at: string;
  work_date: string;
};

export type PosTicketStaffEarningWithStaff = PosTicketStaffEarning & {
  staff: Pick<Staff, "id" | "display_name" | "job_title"> | null;
};
