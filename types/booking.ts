import type { Customer } from "@/types/customer";
import type { Staff } from "@/types/staff";

export const CANONICAL_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "checked_in",
  "in_service",
  "completed",
  "cancelled",
  "no_show",
] as const;

export const LEGACY_BOOKING_STATUSES = ["scheduled"] as const;

export const BOOKING_STATUSES = [
  ...CANONICAL_BOOKING_STATUSES,
  ...LEGACY_BOOKING_STATUSES,
] as const;

export const BOOKING_CONFIRMATION_MODES = [
  "request_confirmation",
  "instant_booking",
] as const;

export const BOOKING_CONFIRMATION_STATUSES = [
  "requested",
  "confirmed",
  "declined",
  "cancelled",
  "expired",
  "not_required",
] as const;

export const BOOKING_SOURCES = [
  "public_profile",
  "explore",
  "owner_manual",
  "staff_manual",
  "phone",
  "walk_in",
  "legacy_request",
  "pos",
] as const;

export const BOOKING_PAYMENT_STATUSES = [
  "not_required",
  "pending",
  "authorized",
  "paid",
  "waived",
  "refunded",
] as const;

export const BOOKING_TICKET_CREATION_MODES = [
  "manual",
  "on_check_in",
  "on_service_start",
] as const;

export const BOOKING_LINE_TYPES = ["service", "add_on", "custom"] as const;
export const BOOKING_LINE_STATUSES = [
  "scheduled",
  "in_service",
  "completed",
  "skipped",
  "cancelled",
] as const;

export const BOOKING_EVENT_TYPES = [
  "booking_created",
  "confirmation_requested",
  "confirmed",
  "staff_assigned",
  "staff_reassigned",
  "rescheduled",
  "checked_in",
  "service_started",
  "line_started",
  "line_completed",
  "line_note_updated",
  "completed",
  "cancelled",
  "no_show",
  "converted_to_ticket",
  "overbooking_override",
] as const;

export const BOOKING_ACTOR_SOURCES = [
  "owner",
  "manager",
  "staff",
  "customer",
  "guest",
  "system",
  "public",
  "pos",
] as const;

export type CanonicalBookingStatus =
  (typeof CANONICAL_BOOKING_STATUSES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BookingConfirmationMode =
  (typeof BOOKING_CONFIRMATION_MODES)[number];
export type BookingConfirmationStatus =
  (typeof BOOKING_CONFIRMATION_STATUSES)[number];
export type BookingSource = (typeof BOOKING_SOURCES)[number];
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUSES)[number];
export type BookingTicketCreationMode =
  (typeof BOOKING_TICKET_CREATION_MODES)[number];
export type BookingLineType = (typeof BOOKING_LINE_TYPES)[number];
export type BookingLineStatus = (typeof BOOKING_LINE_STATUSES)[number];
export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];
export type BookingActorSource = (typeof BOOKING_ACTOR_SOURCES)[number];

export type Booking = {
  id: string;
  organization_id: string;
  salon_id: string;
  customer_id: string;
  customer_user_id: string | null;
  customer_account_linked_at: string | null;
  customer_account_linked_by_user_id: string | null;
  customer_account_link_method: string | null;
  customer_account_link_metadata: Record<string, unknown>;
  staff_id: string | null;
  start_at: string;
  end_at: string;
  notes: string | null;
  public_notes: string | null;
  internal_notes: string | null;
  status: BookingStatus;
  source: BookingSource;
  confirmation_mode: BookingConfirmationMode;
  confirmation_status: BookingConfirmationStatus;
  salon_timezone_snapshot: string;
  customer_cancellation_token_hash: string | null;
  pos_ticket_id: string | null;
  source_reference_type: string | null;
  source_reference_id: string | null;
  idempotency_key: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by_user_id: string | null;
  no_show_at: string | null;
  no_show_by_user_id: string | null;
  no_show_reason: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  payment_status: BookingPaymentStatus;
  deposit_policy_snapshot: Record<string, unknown>;
  cancellation_policy_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type BookingWithRelations = Booking & {
  customer: Pick<Customer, "id" | "name" | "phone" | "email"> | null;
  staff: Pick<Staff, "id" | "display_name"> | null;
};

export type BookingLine = {
  id: string;
  organization_id: string;
  salon_id: string;
  booking_id: string;
  parent_booking_line_id: string | null;
  line_type: BookingLineType;
  service_id: string | null;
  service_name_snapshot: string;
  service_category_snapshot: string | null;
  service_description_snapshot: string | null;
  unit_price: string | number;
  quantity: string | number;
  line_total: string | number;
  duration_minutes: number;
  cleanup_buffer_minutes: number;
  display_order: number;
  assigned_staff_id: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  line_status: BookingLineStatus;
  started_at: string | null;
  completed_at: string | null;
  performed_by_staff_id: string | null;
  service_note: string | null;
  internal_staff_note: string | null;
  line_status_updated_at: string | null;
  line_status_updated_by_user_id: string | null;
  overbooking_override_reason: string | null;
  overbooking_override_by_user_id: string | null;
  overbooking_override_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingStatusEvent = {
  id: string;
  organization_id: string;
  salon_id: string;
  booking_id: string;
  event_type: BookingEventType;
  old_status: CanonicalBookingStatus | null;
  new_status: CanonicalBookingStatus | null;
  actor_user_id: string | null;
  actor_staff_id: string | null;
  actor_source: BookingActorSource;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type BookingSettings = {
  id: string;
  organization_id: string;
  salon_id: string;
  booking_enabled: boolean;
  online_booking_visible: boolean;
  confirmation_mode: BookingConfirmationMode;
  minimum_lead_time_minutes: number;
  maximum_advance_window_days: number;
  slot_interval_minutes: number;
  default_cleanup_buffer_minutes: number;
  same_day_booking_enabled: boolean;
  cancellation_window_minutes: number;
  late_cancellation_policy: Record<string, unknown>;
  no_show_policy: Record<string, unknown>;
  any_professional_enabled: boolean;
  split_staff_appointment_enabled: boolean;
  guest_booking_enabled: boolean;
  timezone_iana: string;
  ticket_creation_mode: BookingTicketCreationMode;
  payment_required_enabled: boolean;
  deposit_required_enabled: boolean;
  deposit_policy: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type StaffServiceAssignment = {
  id: string;
  organization_id: string;
  salon_id: string;
  staff_id: string;
  service_id: string;
  is_active: boolean;
  online_bookable: boolean;
  custom_duration_minutes: number | null;
  custom_price: string | number | null;
  effective_start_date: string | null;
  effective_end_date: string | null;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffAvailabilityRule = {
  id: string;
  organization_id: string;
  salon_id: string;
  staff_id: string | null;
  rule_type: "working" | "break";
  day_of_week: number;
  starts_at_local: string;
  ends_at_local: string;
  timezone_iana: string;
  effective_start_date: string | null;
  effective_end_date: string | null;
  is_active: boolean;
  created_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type StaffTimeBlock = {
  id: string;
  organization_id: string;
  salon_id: string;
  staff_id: string | null;
  block_type: "time_off" | "blocked" | "break" | "cleanup";
  starts_at: string;
  ends_at: string;
  timezone_iana: string;
  reason: string | null;
  created_by_user_id: string | null;
  is_active?: boolean;
  cancelled_at?: string | null;
  cancelled_by_user_id?: string | null;
  updated_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeBookingStatus(
  status: BookingStatus,
): CanonicalBookingStatus {
  return status === "scheduled" ? "confirmed" : status;
}
