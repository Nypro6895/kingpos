import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";

export type HistoryTicket = {
  ticketId: string; ticketNumber: string; openedAt: string; closedAt: string;
  status: string; currency: string;
  discountType: "fixed_amount" | "percentage"; discountValue: number;
  taxRate: number; tipType: "fixed_amount" | "percentage"; tipValue: number;
  services: Array<{ id: string; name: string; quantity: number; unitPrice: number; lineTotal: number; staffName: string | null }>;
  payments: Array<{ amount: number }>;
  verifiedVisit: unknown;
};
export type HistoryEvidence = {
  bookingId: string; appointmentAt?: string; estimate?: number; appointmentServices?: string[];
  ticket: HistoryTicket | null; checkedInAt: string | null;
  visitId: string | null; manualLink: boolean;
  candidates: Array<{ id: string; kind: "ticket" | "visit"; at: string; label: string; ticket?: HistoryTicket }>;
};

export function historyTicketTotals(ticket: HistoryTicket) {
  return calculateTicketTotals({
    items: ticket.services.map(item => ({ line_total: Number(item.lineTotal) })),
    discountType: ticket.discountType, discountValue: Number(ticket.discountValue),
    taxRate: Number(ticket.taxRate), tipType: ticket.tipType, tipValue: Number(ticket.tipValue),
    payments: ticket.payments.map(payment => ({ amount: Number(payment.amount) })),
  });
}

export function historyBookingLabel(status: string, startAt: string, evidence?: HistoryEvidence | null, now = Date.now()) {
  if (evidence?.ticket) return "Completed · Paid at salon";
  if (status === "cancelled" || status === "no_show") return null;
  if (evidence?.checkedInAt || status === "checked_in") return "Checked in";
  if (status === "in_service") return "In service";
  if (new Date(startAt).getTime() < now) return "Past appointment";
  return null;
}
