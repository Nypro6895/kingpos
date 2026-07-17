import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type {
  PosTicketTimelineEventType,
  PosTicketTimelineItem,
} from "@/types/pos-ticket-timeline";

const TIMELINE_LABELS: Record<PosTicketTimelineEventType, string> = {
  booking_converted: "Booking Converted",
  discount_updated: "Discount Updated",
  payment_added: "Payment Added",
  payment_deleted: "Payment Deleted",
  receipt_printed: "Receipt Printed",
  service_added: "Service Added",
  service_removed: "Service Removed",
  staff_assigned: "Staff Assigned",
  ticket_cancelled: "Ticket Cancelled",
  ticket_checked_out: "Checked Out",
  ticket_created: "Ticket Created",
  ticket_created_from_booking: "Created From Appointment",
  ticket_reopened: "Ticket Reopened",
  ticket_voided: "Ticket Voided",
  tax_updated: "Tax Updated",
  tip_updated: "Tip Updated",
};

function formatTimelineUser(
  user: PosTicketWithRelations["audit_logs"][number]["created_by_user"],
) {
  return user?.display_name ?? user?.email ?? "-";
}

export function getTicketTimeline(
  ticket: PosTicketWithRelations,
): PosTicketTimelineItem[] {
  const auditItems: PosTicketTimelineItem[] = (ticket.audit_logs ?? []).map(
    (log) => ({
      action: log.action,
      id: log.id,
      label: TIMELINE_LABELS[log.action],
      note: log.note || null,
      timestamp: log.created_at,
      user: formatTimelineUser(log.created_by_user),
    }),
  );
  const timelineItems: PosTicketTimelineItem[] = [
    ...auditItems,
    {
      action: "ticket_created",
      id: `ticket-created-${ticket.id}`,
      label: TIMELINE_LABELS.ticket_created,
      note: null,
      timestamp: ticket.created_at,
      user: "-",
    },
  ];

  return timelineItems.sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  );
}
