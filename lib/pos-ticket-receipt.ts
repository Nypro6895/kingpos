import type { Customer } from "@/types/customer";
import type { Location } from "@/types/location";
import type { PosPayment, PosPaymentMethod } from "@/types/pos-payment";
import type { PosTicket } from "@/types/pos-ticket";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";
import type { PosTicketReceipt } from "@/types/pos-ticket-receipt";
import type { calculateTicketTotals } from "@/lib/pos-ticket-calculations";

const PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  cash: "Cash",
  credit_card: "Credit Card",
  debit_card: "Debit Card",
  gift_card: "Gift Card",
  other: "Other",
};

const TICKET_STATUS_LABELS = {
  cancelled: "Cancelled",
  closed: "Closed",
  open: "Open",
  voided: "Voided",
} as const;

function getReceiptStatus(status: PosTicket["status"]) {
  if (status === "open") {
    return "Draft";
  }

  if (status === "closed") {
    return "Final Receipt";
  }

  if (status === "cancelled") {
    return "Cancelled";
  }

  return "Voided";
}

export function buildTicketReceipt({
  customer,
  items,
  payments,
  salon,
  ticket,
  totals,
}: {
  customer: Pick<Customer, "name"> | null;
  items: PosTicketItemWithRelations[];
  payments: PosPayment[];
  salon: Location;
  ticket: PosTicket;
  totals: ReturnType<typeof calculateTicketTotals>;
}): PosTicketReceipt {
  return {
    footer: {
      message: "Thank you.",
    },
    header: {
      closed_time: ticket.closed_at,
      created_time: ticket.created_at,
      customer_name: customer?.name ?? "Unknown customer",
      receipt_status: getReceiptStatus(ticket.status),
      salon_name: salon.name,
      salon_phone: salon.phone,
      ticket_number: ticket.ticket_number,
      ticket_status: TICKET_STATUS_LABELS[ticket.status],
    },
    items: items.map((item) => ({
      assigned_staff: item.assigned_staff?.display_name ?? "-",
      line_total: item.line_total,
      quantity: item.quantity,
      service_name: item.service?.name ?? item.notes?.split(" | ")[0] ?? "Desk service",
      unit_price: item.unit_price,
    })),
    payments: payments.map((payment) => ({
      amount: payment.amount,
      created_time: payment.created_at,
      method: PAYMENT_METHOD_LABELS[payment.payment_method],
    })),
    totals: {
      discount: totals.discount_amount,
      grand_total: totals.total,
      paid: totals.paid,
      remaining: totals.remaining,
      subtotal: totals.subtotal,
      tax: totals.tax_amount,
      tip: totals.tip_amount,
    },
  };
}
