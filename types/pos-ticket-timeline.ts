export const POS_TICKET_TIMELINE_EVENT_TYPES = [
  "ticket_created",
  "ticket_created_from_booking",
  "ticket_cancelled",
  "ticket_checked_out",
  "ticket_voided",
  "ticket_reopened",
  "service_added",
  "service_removed",
  "staff_assigned",
  "discount_updated",
  "tax_updated",
  "tip_updated",
  "payment_added",
  "payment_deleted",
  "booking_converted",
  "receipt_printed",
] as const;

export type PosTicketTimelineEventType =
  (typeof POS_TICKET_TIMELINE_EVENT_TYPES)[number];

export type PosTicketTimelineItem = {
  id: string;
  action: PosTicketTimelineEventType;
  label: string;
  note: string | null;
  timestamp: string;
  user: string;
};
