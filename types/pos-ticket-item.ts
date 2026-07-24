import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

export type PosTicketItem = {
  id: string;
  salon_id: string;
  pos_ticket_id: string;
  service_id: string | null;
  assigned_staff_id: string | null;
  performed_by_staff_id: string | null;
  source_booking_id: string | null;
  source_booking_line_id: string | null;
  source_kind: "booking" | "manual";
  service_name_snapshot: string | null;
  service_category_snapshot: string | null;
  booked_unit_price_snapshot: number | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
  is_removed?: boolean;
  removed_at?: string | null;
  removed_by?: string | null;
  removal_reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type PosTicketItemWithRelations = PosTicketItem & {
  assigned_staff: Pick<Staff, "id" | "display_name" | "job_title"> | null;
  performed_staff: Pick<Staff, "id" | "display_name" | "job_title"> | null;
  running_turns?: {
    big: number | null;
    small: number | null;
  };
  service: Pick<
    Service,
    "id" | "name" | "category" | "base_price" | "duration_minutes"
  > | null;
  turn_parts?: Array<{
    amount: number;
    created_at?: string;
    id: string;
    staff_id?: string;
    ticket_id?: string;
    ticket_item_id?: string;
    turn_index: number;
    turn_type: "large" | "small";
    work_date?: string;
  }>;
};
