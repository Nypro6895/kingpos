import "server-only";

import type { CreateCanonicalBookingInput } from "@/lib/booking-domain/types";

export type SalonProfileBookingRequestContract = {
  customer_user_id: string;
  id: string;
  look_id: string | null;
  private_note: string | null;
  requested_start_at: string | null;
  service_id: string | null;
  staff_id: string | null;
};

export function mapLegacyProfileRequestToCanonicalDraft(
  request: SalonProfileBookingRequestContract,
): Partial<CreateCanonicalBookingInput> {
  return {
    confirmationMode: "request_confirmation",
    confirmationStatus: "requested",
    customer: {
      customerUserId: request.customer_user_id,
    },
    internalNotes: request.private_note,
    lines: request.service_id
      ? [
          {
            assignedStaffId: request.staff_id,
            serviceId: request.service_id,
          },
        ]
      : [],
    source: "legacy_request",
    status: "pending",
  };
}
