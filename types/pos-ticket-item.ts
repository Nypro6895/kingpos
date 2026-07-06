import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

export type PosTicketItem = {
  id: string;
  organization_id: string;
  salon_id: string;
  pos_ticket_id: string;
  service_id: string | null;
  assigned_staff_id: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PosTicketItemWithRelations = PosTicketItem & {
  assigned_staff: Pick<Staff, "id" | "display_name" | "job_title"> | null;
  service: Pick<
    Service,
    "id" | "name" | "category" | "base_price" | "duration_minutes"
  > | null;
};
