import "server-only";

import type {
  Booking,
  BookingActorSource,
  BookingConfirmationMode,
  BookingConfirmationStatus,
  BookingLine,
  BookingLineType,
  BookingSource,
  BookingStatusEvent,
  CanonicalBookingStatus,
} from "@/types/booking";
import type { Customer } from "@/types/customer";

export type BookingCustomerResolutionInput = {
  customerId?: string | null;
  customerUserId?: string | null;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
};

export type BookingCustomerResolution = {
  created: boolean;
  customer: Customer;
  customerUserId: string | null;
  matchedBy: "customer_id" | "customer_user" | "phone" | "email" | "created";
};

export type BookingDomainLineInput = {
  assignedStaffId?: string | null;
  cleanupBufferMinutes?: number | null;
  displayOrder?: number | null;
  durationMinutes?: number | null;
  lineType?: BookingLineType;
  parentBookingLineId?: string | null;
  quantity?: number | null;
  scheduledEndAt?: string | null;
  scheduledStartAt?: string | null;
  serviceCategorySnapshot?: string | null;
  serviceDescriptionSnapshot?: string | null;
  serviceId?: string | null;
  serviceNameSnapshot?: string | null;
  unitPrice?: number | null;
};

export type CanonicalBookingRpcLine = {
  assigned_staff_id: string | null;
  cleanup_buffer_minutes: number;
  display_order: number;
  duration_minutes: number;
  line_type: BookingLineType;
  parent_booking_line_id: string | null;
  quantity: number;
  scheduled_end_at: string | null;
  scheduled_start_at: string | null;
  service_category_snapshot: string | null;
  service_description_snapshot: string | null;
  service_id: string | null;
  service_name_snapshot: string;
  unit_price: number;
};

export type CreateCanonicalBookingInput = {
  confirmationMode?: BookingConfirmationMode;
  confirmationStatus?: BookingConfirmationStatus;
  customer: BookingCustomerResolutionInput;
  endAt: string;
  idempotencyKey?: string | null;
  internalNotes?: string | null;
  lines: BookingDomainLineInput[];
  overbookingOverrideReason?: string | null;
  publicNotes?: string | null;
  source?: BookingSource;
  sourceReferenceId?: string | null;
  sourceReferenceType?: string | null;
  startAt: string;
  status?: CanonicalBookingStatus;
};

export type CreateCanonicalBookingResult = {
  bookingId: string;
  customerId: string;
  customerUserId: string | null;
};

export type BookingStatusTransitionInput = {
  bookingId: string;
  nextStatus: CanonicalBookingStatus;
};

export type BookingRescheduleInput = {
  bookingId: string;
  endAt: string;
  overbookingOverrideReason?: string | null;
  reason?: string | null;
  startAt: string;
};

export type BookingStaffAssignmentInput = {
  bookingId: string;
  lineAssignments?: {
    bookingLineId: string;
    staffId: string | null;
  }[];
  overbookingOverrideReason?: string | null;
  reason?: string | null;
  staffId: string | null;
};

export type BookingCancellationInput = {
  bookingId: string;
  reason: string;
};

export type BookingNoShowInput = {
  bookingId: string;
  reason?: string | null;
};

export type BookingTicketConversionInput = {
  bookingId: string;
  ticketId: string;
};

export type BookingDomainDetail = Booking & {
  booking_lines?: BookingLine[];
  booking_status_events?: BookingStatusEvent[];
};

export type StaffBookingProjection = Pick<
  Booking,
  | "id"
  | "salon_id"
  | "customer_id"
  | "staff_id"
  | "start_at"
  | "end_at"
  | "status"
  | "source"
  | "confirmation_status"
> & {
  booking_lines?: Pick<
    BookingLine,
    | "id"
    | "assigned_staff_id"
    | "duration_minutes"
    | "scheduled_end_at"
    | "scheduled_start_at"
    | "service_name_snapshot"
  >[];
};

export type BookingDomainActor = {
  actorSource: BookingActorSource;
  userId: string | null;
};
