import type { Customer } from "@/types/customer";
import type { PosTicketDiscountType } from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import type { StaffWorkdayStatus } from "@/types/staff-workday";

export type PosDeskTurnType = "large" | "small";

export type PosDeskTurnSummary = {
  largeTurns: number;
  smallTurns: number;
  totalTurns: number;
};

export type PosDeskStaff = Pick<
  Staff,
  "id" | "display_name" | "job_title" | "is_active"
> & {
  today_status: StaffWorkdayStatus | "not_checked_in";
  turns: PosDeskTurnSummary;
};

export type PosDeskCustomer = Pick<
  Customer,
  "id" | "name" | "phone" | "email"
>;

export type PosDeskService = Pick<
  Service,
  "id" | "name" | "category" | "base_price"
>;

export type PosDeskSubmitLine = {
  amountInput: string;
  amountParts: number[];
  serviceId: string | null;
  serviceLabel: string;
  staffId: string;
  total: number;
};

export type PosDeskSubmitInput = {
  customerId?: string | null;
  customerLookup?: string | null;
  customerName?: string | null;
  discountType?: PosTicketDiscountType;
  discountValue?: number;
  lines: PosDeskSubmitLine[];
  note?: string | null;
  tipAmount?: number;
};

export type PosDeskSessionStatus =
  | "active"
  | "pending_confirmation"
  | "submitted"
  | "cancelled"
  | "expired";

export type PosDeskSessionLine = {
  amount: number;
  amount_input: string;
  amount_parts: number[];
  id: string;
  service_id: string | null;
  service_label: string;
  sort_order: number;
  staff_id: string;
  staff_name: string | null;
  turn_large_count: number;
  turn_small_count: number;
};

export type PosDeskSessionView = {
  customer_confirmed_at: string | null;
  customer_display_token: string;
  customer_id: string | null;
  customer_lookup_value: string | null;
  customer_name_snapshot: string | null;
  expires_at: string;
  id: string;
  lines: PosDeskSessionLine[];
  note: string | null;
  salon_id: string;
  salon_name: string | null;
  status: PosDeskSessionStatus;
  submitted_ticket_id: string | null;
  tip_amount: number;
  updated_at: string;
};

export type PosDeskSessionLineInput = {
  amountInput: string;
  lineId?: string | null;
  serviceId?: string | null;
  serviceLabel: string;
  sessionId: string;
  staffId: string;
};

export type PosDisplayReceiptLine = {
  amount: number;
  id: string;
  name: string;
  parts: string;
  staffName: string | null;
};

export type PosDisplayReceiptPayload = {
  action: "receipt_submitted";
  customer: {
    id: string | null;
    lookup: string | null;
    name: string | null;
  } | null;
  lines: PosDisplayReceiptLine[];
  salonName: string;
  sentAt: string;
  sessionId: string | null;
  totals: {
    discount: number;
    giftCard: number;
    subtotal: number;
    tax: number;
    tip: number;
    totalBeforeTip: number;
  };
};

export type PosDisplayCustomerMessage = {
  action: "tip_confirmed";
  confirmedAt: string;
  finalTotal: number;
  tipAmount: number;
};

export type PosDisplayChannelStatus =
  | "waiting"
  | "receipt_sent"
  | "customer_confirmed"
  | "finalized";

export type PosDisplayChannelView = {
  customer_message: PosDisplayCustomerMessage | null;
  customer_message_version: number;
  id: string;
  pos_message: PosDisplayReceiptPayload | null;
  pos_message_version: number;
  salon_id: string;
  status: PosDisplayChannelStatus;
  token: string;
  updated_at: string;
};

export type PosLiveDraftCustomer = {
  id: string | null;
  name: string;
  phone: string | null;
};

export type PosLiveDraftReceiptLine = {
  amount: number;
  amountInput?: string;
  amountParts?: number[];
  id: string;
  label: string;
  serviceId?: string | null;
  sortOrder?: number;
  staffId: string;
  staffName: string;
};

export type PosLiveDraftView = {
  customer: PosLiveDraftCustomer | null;
  id: string;
  selected_staff_id: string | null;
  salon_id: string;
  staff_lines: PosLiveDraftReceiptLine[];
  status: "draft" | "closed";
  subtotal: number;
  tip: number;
  token: string;
  total: number;
  updated_at: string;
  version: number;
};
