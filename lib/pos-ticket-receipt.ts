import type { Customer } from "@/types/customer";
import type { Location } from "@/types/location";
import type { PosPayment } from "@/types/pos-payment";
import type { PosTicket } from "@/types/pos-ticket";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import { ticketFinancialView } from "@/lib/pos-ticket-financial-view";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";
import type { PosTicketReceipt } from "@/types/pos-ticket-receipt";
import type { calculateTicketTotals } from "@/lib/pos-ticket-calculations";

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
  salon,
  ticket,
  totals,
}: {
  customer: Pick<Customer, "name"> | null;
  items: PosTicketItemWithRelations[];
  payments: PosPayment[];
  salon: Location;
  ticket: PosTicketWithRelations;
  totals: ReturnType<typeof calculateTicketTotals>;
}): PosTicketReceipt {
  const view = ticketFinancialView(ticket, totals);
  const retailTotals = view.totals;
  return {
    footer: {
      message: "Thank you.",
    },
    header: {
      closed_time: ticket.closed_at,
      created_time: ticket.created_at,
      customer_name: customer?.name ?? "Walk-in",
      receipt_status: getReceiptStatus(ticket.status),
      salon_name: salon.name,
      salon_phone: salon.phone,
      ticket_number: ticket.ticket_number,
      ticket_status: TICKET_STATUS_LABELS[ticket.status],
    },
    items: [...items.map((item) => ({
      assigned_staff: item.assigned_staff?.display_name ?? "-",
      line_total: item.line_total,
      quantity: item.quantity,
      service_name: item.service?.name ?? item.notes?.split(" | ")[0] ?? "Desk service",
      unit_price: item.unit_price,
    })), ...view.giftSales.map(sale=>({service_name:`Gift card · •••• ${sale.last4}${sale.status === "voided" ? " · Voided" : ""}`,assigned_staff:"",quantity:1,unit_price:sale.amountCents/100,line_total:sale.amountCents/100}))],
    payments: view.payments,
    totals: {
      discount: view.ordinaryDiscount,
      reward: view.reward,
      grand_total: retailTotals.total,
      paid: retailTotals.paid,
      remaining: retailTotals.remaining,
      subtotal: retailTotals.subtotal,
      tax: totals.tax_amount,
      tip: totals.tip_amount,
    },
  };
}
