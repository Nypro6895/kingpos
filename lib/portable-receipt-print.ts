import type { PortableTicketRow } from "@/app/pos/portable/actions";
import type { PrintableReceipt } from "@/types/receipt-print";
import { calculateTicketTotals } from "./pos-ticket-calculations";
import { ticketFinancialView } from "./pos-ticket-financial-view";

/** Project authorized captured ticket data; never use editor/draft values. */
export function portableTicketPrintReceipt(ticket: PortableTicketRow, salonName: string): PrintableReceipt {
  if (ticket.status !== "closed") throw new Error("Only a saved, closed ticket can be printed as a receipt.");
  if (!ticket.financial_sources?.recordedPayments) throw new Error("Reconnect to load this ticket's recorded payments before printing.");
  const payments = ticket.financial_sources.recordedPayments.map(p => ({ amount: p.amount, payment_method: p.paymentMethod, created_at: p.createdAt }));
  const captured = { financial_sources: ticket.financial_sources, discount_type: ticket.discountType, discount_value: ticket.discountValue,
    tax_rate: ticket.taxRate, tip_type: ticket.tipType, tip_value: ticket.tipValue, opened_at: ticket.openedAt, closed_at: ticket.closedAt,
    created_at: ticket.createdAt, ticket_items: ticket.items.map(i => ({ line_total: i.lineTotal })) };
  const amounts = calculateTicketTotals({ items: captured.ticket_items, payments, discountType: ticket.discountType, discountValue: ticket.discountValue,
    taxRate: ticket.taxRate, tipType: ticket.tipType, tipValue: ticket.tipValue });
  const financial = ticketFinancialView(captured, amounts);
  // The RPC's captured retail totals remain authority. Refuse partial/inconsistent
  // sources instead of printing an invented zero or a second Gift amount.
  for (const [a, b] of [[financial.totals.total, ticket.total], [financial.totals.paid, ticket.paid], [financial.totals.remaining, ticket.remaining]]) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 0.005) throw new Error("Receipt details changed or are incomplete. Reconnect and reload this ticket before printing.");
  }
  return { header: { salon_name: salonName, salon_phone: null, ticket_number: ticket.ticketNumber, customer_name: ticket.customerName || "Walk-in",
    created_time: ticket.createdAt, closed_time: ticket.closedAt, ticket_status: "Closed", receipt_status: "Final Receipt" },
    items: [...ticket.items.map(i => ({ service_name: i.serviceName, assigned_staff: i.staffName || "Unassigned", line_total: i.lineTotal })),
      ...financial.giftSales.map(s => ({ service_name: `Gift card · •••• ${s.last4}${s.status === "voided" ? " · Voided" : ""}`, assigned_staff: "", line_total: s.amountCents / 100 }))],
    totals: { subtotal: ticket.subtotal, discount: financial.ordinaryDiscount, reward: financial.reward, tax: ticket.taxAmount, tip: ticket.tipAmount,
      grand_total: ticket.total, paid: ticket.paid, remaining: ticket.remaining }, payments: financial.payments, footer: { message: "Thank you." } };
}
