import type { KingUser } from "@/types/user";

export const POS_TICKET_AUDIT_ACTIONS = [
  "ticket_cancelled",
  "ticket_voided",
  "ticket_reopened",
  "ticket_checked_out",
] as const;

export type PosTicketAuditAction = (typeof POS_TICKET_AUDIT_ACTIONS)[number];

export type PosTicketAuditLog = {
  id: string;
  organization_id: string;
  salon_id: string;
  ticket_id: string;
  action: PosTicketAuditAction;
  note: string;
  created_by: string;
  created_at: string;
};

export type PosTicketAuditLogWithUser = PosTicketAuditLog & {
  created_by_user: Pick<KingUser, "id" | "display_name" | "email"> | null;
};
