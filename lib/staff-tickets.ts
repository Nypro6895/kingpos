export type StaffTicketHistory = {
  id: string; at: string; actor: string; source: string;
  before: Record<string, string | number | boolean | null>;
  after: Record<string, string | number | boolean | null>;
};
export type StaffTicket = {
  id: string; ticketNumber: string; openedAt: string; closedAt: string | null;
  status: string; customerName: string | null;
  services: Array<{ id: string; name: string; quantity: number; unitPrice: number; price: number; removed: boolean }>;
  serviceTotal: number; tip: number | null;
  history: StaffTicketHistory[];
  activity: Array<{ id: string; at: string; actor: string; action: string }>;
};
export type StaffTicketsData = { date: string; staffId: string; tickets: StaffTicket[] };

export function validStaffTicketDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const parsed = new Date(`${value}T12:00:00Z`);
  return year >= 1 && year <= 9999 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const STAFF_TICKET_FIELDS: Record<string, string> = {
  service_name_snapshot: "Service", quantity: "Quantity", unit_price: "Unit price", line_total: "Price",
  is_removed: "Removed", assigned_staff_id: "Staff assignment", service_total: "Services", tip_amount: "Tip",
  total_earning: "Ticket earnings", big_turn_count: "Big turns", small_turn_count: "Small turns",
  work_date: "Work date", status: "Status", customer_id: "Customer", opened_at: "Opened", closed_at: "Closed",
};
export function staffTicketChanges(history: StaffTicketHistory) {
  return [...new Set([...Object.keys(history.before), ...Object.keys(history.after)])]
    .filter(key => history.before[key] !== history.after[key])
    .map(key => ({ key, label: STAFF_TICKET_FIELDS[key] ?? key, before: history.before[key], after: history.after[key] }));
}
