import type { Customer } from "@/types/customer";
import type { PosPayment } from "@/types/pos-payment";
import type { PosTicketAuditLogWithUser } from "@/types/pos-ticket-audit-log";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";
import type { PosTicketStaffEarningWithStaff } from "@/types/pos-ticket-staff-earning";

export const POS_TICKET_STATUSES = ["open", "closed", "cancelled", "voided"] as const;
export const POS_TICKET_DISCOUNT_TYPES = ["fixed_amount", "percentage"] as const;
export const POS_TICKET_TIP_TYPES = ["fixed_amount", "percentage"] as const;

export type PosTicketStatus = (typeof POS_TICKET_STATUSES)[number];
export type PosTicketDiscountType = (typeof POS_TICKET_DISCOUNT_TYPES)[number];
export type PosTicketTipType = (typeof POS_TICKET_TIP_TYPES)[number];

export type PosTicket = {
  id: string;
  organization_id: string;
  salon_id: string;
  ticket_number: string;
  ticket_sequence: number;
  customer_id: string;
  opened_at: string;
  closed_at: string | null;
  status: PosTicketStatus;
  discount_type: PosTicketDiscountType;
  discount_value: number;
  tax_rate: number;
  tip_type: PosTicketTipType;
  tip_value: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PosTicketWithRelations = PosTicket & {
  audit_logs: PosTicketAuditLogWithUser[];
  customer: Pick<Customer, "id" | "name" | "phone" | "email"> | null;
  payments: PosPayment[];
  staff_earnings?: PosTicketStaffEarningWithStaff[];
  ticket_items: PosTicketItemWithRelations[];
};
