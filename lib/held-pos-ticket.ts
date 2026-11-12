import type { RelayTicket } from "@/types/service-relay";
import type { PosDeskSessionLine } from "@/types/pos-desk";
import { portableDeviceStorage } from "@/lib/portable-device-storage";

export function savedPosDraft<T>(value: T, label: string) {
  return { id: crypto.randomUUID(), at: Date.now(), label, value };
}

export function preserveHeldEdits<T>(scope: string, value: T, label: string) {
  const key = `kingpos:parked-tickets:v1:${scope}`;
  const rows = JSON.parse(portableDeviceStorage.getItem(key) ?? "[]");
  if (!Array.isArray(rows)) throw new Error("Unable to read saved tickets.");
  portableDeviceStorage.setItem(key, JSON.stringify([...rows, savedPosDraft(value, label)]));
}

export function archiveClosedHeldEdits<T>(scope: string, value: T, label: string) {
  const key = `kingpos:closed-ticket-edits:v1:${scope}`;
  const rows = JSON.parse(portableDeviceStorage.getItem(key) ?? "[]");
  if (!Array.isArray(rows)) throw new Error("Unable to preserve closed ticket edits.");
  portableDeviceStorage.setItem(key, JSON.stringify([...rows, savedPosDraft(value, label)]));
}

export function heldTicketCustomer(ticket: RelayTicket) {
  if (!ticket.customerId) throw new Error("Refresh Saved tickets before opening this customer.");
  if (["completed", "cancelled"].includes(ticket.status)) throw new Error("This ticket is already closed.");
  return { id: ticket.customerId, name: ticket.customerName, phone: null, email: null, visitId: ticket.visitId };
}
export function heldTicketOwnerCart(ticket: RelayTicket) {
  return { id: crypto.randomUUID(), amount: "", staffId: null, serviceId: null, inputTarget: "amount" as const,
    requestedServices: ticket.requestedServices, customer: heldTicketCustomer(ticket), heldTicket: { visitId: ticket.visitId, revision: ticket.revision },
    lines: ticket.lines.map(l => ({ id: l.id, staffId: l.staffId, staffName: l.staffName, serviceId: l.serviceId, serviceLabel: l.serviceName, total: l.amount, amountInput: String(l.amount), amountParts: [l.amount] })),
    note: ticket.draftNote ?? "", tip: String(ticket.draftTip || ""), discount: String(ticket.draftDiscount || ""), activeLineId: ticket.lines[0]?.id ?? null };
}
export function heldTicketSessionLines(ticket: RelayTicket): PosDeskSessionLine[] {
  return ticket.lines.map((l, i) => ({ id: l.id, staff_id: l.staffId, staff_name: l.staffName, service_id: l.serviceId, service_label: l.serviceName,
    amount: l.amount, amount_input: String(l.amount), amount_parts: [l.amount], sort_order: i, turn_large_count: 0, turn_small_count: 0 }));
}
