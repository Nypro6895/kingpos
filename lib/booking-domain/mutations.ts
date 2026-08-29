import "server-only";

import {
  listStaffBookingConflicts,
} from "@/lib/booking-domain/availability";
import {
  bookingFailure,
  bookingFailureFromUnknown,
  bookingOk,
  type BookingDomainResult,
} from "@/lib/booking-domain/errors";
import { resolveBookingCustomer } from "@/lib/booking-domain/customer-identity";
import { deriveBookingLineSnapshots } from "@/lib/booking-domain/service-snapshots";
import type {
  BookingCancellationInput,
  BookingNoShowInput,
  BookingRescheduleInput,
  BookingStaffAssignmentInput,
  BookingStatusTransitionInput,
  BookingTicketConversionInput,
  CreateCanonicalBookingInput,
  CreateCanonicalBookingResult,
} from "@/lib/booking-domain/types";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BookingConfirmationStatus,
  BookingLine,
  CanonicalBookingStatus,
} from "@/types/booking";

const ALLOWED_TRANSITIONS: Record<CanonicalBookingStatus, CanonicalBookingStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_service", "cancelled"],
  in_service: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

type MutableBookingRow = {
  end_at: string;
  id: string;
  staff_id: string | null;
  start_at: string;
  status: CanonicalBookingStatus | "scheduled";
};

type MutableBookingLineRow = Pick<
  BookingLine,
  | "assigned_staff_id"
  | "id"
  | "overbooking_override_reason"
  | "scheduled_end_at"
  | "scheduled_start_at"
  | "service_id"
>;

function normalizeMutableStatus(
  status: CanonicalBookingStatus | "scheduled",
): CanonicalBookingStatus {
  return status === "scheduled" ? "confirmed" : status;
}

function trimmedOrNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function isTerminalStatus(status: CanonicalBookingStatus) {
  return status === "completed" || status === "cancelled" || status === "no_show";
}

function confirmationStatusForTransition(
  status: CanonicalBookingStatus,
): BookingConfirmationStatus | null {
  if (status === "cancelled" || status === "no_show") {
    return "cancelled";
  }

  if (status !== "pending") {
    return "confirmed";
  }

  return null;
}

async function ensureLineHasNoBlockingConflict(input: {
  bookingId: string;
  bookingLineId: string;
  endAt: string;
  overrideReason: string | null;
  salonId: string;
  staffId: string | null;
  startAt: string;
  supabase: Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>;
}): Promise<BookingDomainResult<{ conflictCount: number }>> {
  if (!input.staffId || !input.supabase) {
    return bookingOk({ conflictCount: 0 });
  }

  const conflicts = await listStaffBookingConflicts({
    bookingIdToIgnore: input.bookingId,
    bookingLineIdToIgnore: input.bookingLineId,
    endAt: input.endAt,
    salonId: input.salonId,
    staffId: input.staffId,
    startAt: input.startAt,
    supabase: input.supabase,
  });

  if (!conflicts.ok) {
    return conflicts;
  }

  if (conflicts.data.length > 0 && !input.overrideReason) {
    return bookingFailure(
      "availability_conflict",
      "Assigned staff already has a booking in this interval.",
      "overbookingOverrideReason",
    );
  }

  return bookingOk({ conflictCount: conflicts.data.length });
}

async function requireManageBookingDomainContext() {
  const [context, supabase] = await Promise.all([
    getCurrentBusinessContext(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!context.user || !supabase) {
    return {
      error: {
        code: "unauthenticated" as const,
        message: "Sign in required.",
      },
      ok: false as const,
    };
  }

  if (!isSalonManageContext(context) || !context.currentAccount || !context.currentSalon) {
    return {
      error: {
        code: "invalid_context" as const,
        message: "Open bookings from a Business workspace.",
      },
      ok: false as const,
    };
  }

  try {
    await requirePermission("booking.manage", context);
  } catch {
    return {
      error: {
        code: "forbidden" as const,
        message: "Missing required permission: booking.manage",
      },
      ok: false as const,
    };
  }

  return {
    context,
    Account: context.currentAccount,
    salon: context.currentSalon,
    supabase,
    user: context.user,
    ok: true as const,
  };
}

function defaultStatus(input: CreateCanonicalBookingInput): CanonicalBookingStatus {
  if (input.status) {
    return input.status;
  }

  return input.confirmationMode === "instant_booking" ? "confirmed" : "pending";
}

function defaultConfirmationStatus(input: CreateCanonicalBookingInput) {
  if (input.confirmationStatus) {
    return input.confirmationStatus;
  }

  return input.confirmationMode === "instant_booking" ? "confirmed" : "requested";
}

export async function createCanonicalBookingForCurrentSalon(
  input: CreateCanonicalBookingInput,
): Promise<BookingDomainResult<CreateCanonicalBookingResult>> {
  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const customerResolution = await resolveBookingCustomer({
      actorUserId: context.user.id,
      bookingSource: input.source ?? "owner_manual",
      customer: input.customer,
      salonId: context.salon.id,
      supabase: context.supabase,
    });

    if (!customerResolution.ok) {
      return customerResolution;
    }

    const lineSnapshots = await deriveBookingLineSnapshots({
      lines: input.lines,
      salonId: context.salon.id,
      supabase: context.supabase,
    });

    if (!lineSnapshots.ok) {
      return lineSnapshots;
    }

    const { data, error } = await context.supabase.rpc("create_canonical_booking", {
      p_actor_source: "manager",
      p_confirmation_mode: input.confirmationMode ?? "request_confirmation",
      p_confirmation_status: defaultConfirmationStatus(input),
      p_customer_id: customerResolution.data.customer.id,
      p_customer_user_id: customerResolution.data.customerUserId,
      p_end_at: input.endAt,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_internal_notes: input.internalNotes ?? null,
      p_lines: lineSnapshots.data,
      p_overbooking_override_reason: input.overbookingOverrideReason ?? null,
      p_public_notes: input.publicNotes ?? null,
      p_salon_id: context.salon.id,
      p_source: input.source ?? "owner_manual",
      p_start_at: input.startAt,
      p_status: defaultStatus(input),
    });

    if (error) {
      throw error;
    }

    if (typeof data !== "string") {
      return bookingFailure("database_error", "Booking RPC returned no id.");
    }

    const sourceReferenceType = trimmedOrNull(input.sourceReferenceType);
    const sourceReferenceId = trimmedOrNull(input.sourceReferenceId);

    if (sourceReferenceType || sourceReferenceId) {
      const { error: referenceError } = await context.supabase
        .from("bookings")
        .update({
          source_reference_id: sourceReferenceId,
          source_reference_type: sourceReferenceType,
          updated_by_user_id: context.user.id,
        })
        .eq("id", data)
        .eq("salon_id", context.salon.id);

      if (referenceError) {
        throw referenceError;
      }
    }

    return bookingOk({
      bookingId: data,
      customerId: customerResolution.data.customer.id,
      customerUserId: customerResolution.data.customerUserId,
    });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

async function updateCurrentSalonBooking(
  bookingId: string,
  values: Record<string, unknown>,
): Promise<BookingDomainResult<{ bookingId: string; changed?: boolean }>> {
  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const { error } = await context.supabase
      .from("bookings")
      .update({
        ...values,
        updated_by_user_id: context.user.id,
      })
      .eq("id", bookingId)
      .eq("salon_id", context.salon.id);

    if (error) {
      throw error;
    }

    return bookingOk({ bookingId, changed: true });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function transitionBookingStatus(
  input: BookingStatusTransitionInput,
): Promise<BookingDomainResult<{ bookingId: string; changed?: boolean }>> {
  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const { data: currentBooking, error: loadError } = await context.supabase
      .from("bookings")
      .select("status, confirmation_status")
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .maybeSingle<{
        confirmation_status: BookingConfirmationStatus | null;
        status: CanonicalBookingStatus | "scheduled";
      }>();

    if (loadError) {
      throw loadError;
    }

    if (!currentBooking) {
      return bookingFailure("not_found", "Booking was not found.");
    }

    const currentStatus =
      currentBooking.status === "scheduled" ? "confirmed" : currentBooking.status;
    const confirmationStatus = confirmationStatusForTransition(input.nextStatus);
    const needsStatusUpdate = currentBooking.status !== input.nextStatus;
    const needsConfirmationUpdate =
      confirmationStatus !== null &&
      currentBooking.confirmation_status !== confirmationStatus;

    if (currentStatus === input.nextStatus) {
      if (!needsStatusUpdate && !needsConfirmationUpdate) {
        return bookingOk({ bookingId: input.bookingId, changed: false });
      }
    } else {
      const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? [];

      if (!allowed.includes(input.nextStatus)) {
        return bookingFailure(
          "invalid_input",
          `Cannot transition booking from ${currentStatus} to ${input.nextStatus}.`,
          "nextStatus",
        );
      }
    }

    const nextValues = {
      status: input.nextStatus,
      ...(confirmationStatus ? { confirmation_status: confirmationStatus } : {}),
      updated_by_user_id: context.user.id,
    };

    let updateQuery = context.supabase
      .from("bookings")
      .update(nextValues)
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .eq("status", currentBooking.status);

    updateQuery =
      currentBooking.confirmation_status === null
        ? updateQuery.is("confirmation_status", null)
        : updateQuery.eq(
            "confirmation_status",
            currentBooking.confirmation_status,
          );

    const { data: updatedBooking, error: updateError } = await updateQuery
      .select("id")
      .maybeSingle<{ id: string }>();

    if (updateError) {
      throw updateError;
    }

    if (updatedBooking) {
      return bookingOk({ bookingId: input.bookingId, changed: true });
    }

    const { data: latestBooking, error: latestError } = await context.supabase
      .from("bookings")
      .select("status, confirmation_status")
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .maybeSingle<{
        confirmation_status: BookingConfirmationStatus | null;
        status: CanonicalBookingStatus | "scheduled";
      }>();

    if (latestError) {
      throw latestError;
    }

    if (!latestBooking) {
      return bookingFailure("not_found", "Booking was not found.");
    }

    const latestStatus = normalizeMutableStatus(latestBooking.status);

    if (
      latestStatus === input.nextStatus &&
      (confirmationStatus === null ||
        latestBooking.confirmation_status === confirmationStatus)
    ) {
      return bookingOk({ bookingId: input.bookingId, changed: false });
    }

    return bookingFailure(
      "conflict",
      "Booking status changed. Refresh and try again.",
      "status",
    );
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function rescheduleBooking(
  input: BookingRescheduleInput,
): Promise<BookingDomainResult<{ bookingId: string }>> {
  if (new Date(input.endAt).getTime() <= new Date(input.startAt).getTime()) {
    return bookingFailure("invalid_input", "End time must be after start time.");
  }

  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const { data, error } = await context.supabase.rpc(
      "reschedule_canonical_booking",
      {
        p_booking_id: input.bookingId,
        p_end_at: input.endAt,
        p_overbooking_override_reason:
          trimmedOrNull(input.overbookingOverrideReason),
        p_start_at: input.startAt,
      },
    );

    if (error) {
      throw error;
    }

    if (typeof data !== "string") {
      return bookingFailure("database_error", "Reschedule RPC returned no id.");
    }

    return bookingOk({ bookingId: input.bookingId });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function assignBookingStaff(
  input: BookingStaffAssignmentInput,
): Promise<BookingDomainResult<{ bookingId: string }>> {
  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const { data: booking, error: bookingError } = await context.supabase
      .from("bookings")
      .select("id, staff_id, start_at, end_at, status")
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .maybeSingle<MutableBookingRow>();

    if (bookingError) {
      throw bookingError;
    }

    if (!booking) {
      return bookingFailure("not_found", "Booking was not found.");
    }

    if (isTerminalStatus(normalizeMutableStatus(booking.status))) {
      return bookingFailure("invalid_input", "Terminal bookings cannot be reassigned.");
    }

    const explicitAssignments = input.lineAssignments ?? null;
    const { data: bookingLines, error: linesError } = await context.supabase
      .from("booking_lines")
      .select(
        "id, service_id, assigned_staff_id, scheduled_start_at, scheduled_end_at, overbooking_override_reason",
      )
      .eq("booking_id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .order("display_order", { ascending: true })
      .returns<MutableBookingLineRow[]>();

    if (linesError) {
      throw linesError;
    }

    const linesById = new Map((bookingLines ?? []).map((line) => [line.id, line]));
    const targetAssignments =
      explicitAssignments && explicitAssignments.length > 0
        ? explicitAssignments
        : (bookingLines ?? []).map((line) => ({
            bookingLineId: line.id,
            staffId: input.staffId,
          }));
    const overrideReason = trimmedOrNull(input.overbookingOverrideReason);
    const assignmentChanges: Array<{
      booking_line_id: string;
      new_staff_id: string | null;
      old_staff_id: string | null;
    }> = [];

    for (const assignment of targetAssignments) {
      const line = linesById.get(assignment.bookingLineId);

      if (!line) {
        return bookingFailure(
          "relationship_invalid",
          "Booking line was not found for this booking.",
          "lineAssignments",
        );
      }

      const conflict = await ensureLineHasNoBlockingConflict({
        bookingId: input.bookingId,
        bookingLineId: line.id,
        endAt: line.scheduled_end_at ?? booking.end_at,
        overrideReason,
        salonId: context.salon.id,
        staffId: assignment.staffId,
        startAt: line.scheduled_start_at ?? booking.start_at,
        supabase: context.supabase,
      });

      if (!conflict.ok) {
        return conflict;
      }

      const oldStaffId = line.assigned_staff_id ?? null;
      const newStaffId = assignment.staffId ?? null;

      if (oldStaffId !== newStaffId) {
        assignmentChanges.push({
          booking_line_id: line.id,
          new_staff_id: newStaffId,
          old_staff_id: oldStaffId,
        });
      }
    }

    for (const assignment of targetAssignments) {
      const { error: lineUpdateError } = await context.supabase
        .from("booking_lines")
        .update({
          assigned_staff_id: assignment.staffId,
          ...(overrideReason
            ? {
                overbooking_override_at: new Date().toISOString(),
                overbooking_override_by_user_id: context.user.id,
                overbooking_override_reason: overrideReason,
              }
            : {}),
        })
        .eq("id", assignment.bookingLineId)
        .eq("booking_id", input.bookingId)
        .eq("salon_id", context.salon.id);

      if (lineUpdateError) {
        throw lineUpdateError;
      }
    }

    const representativeStaffId =
      targetAssignments.find((assignment) => assignment.staffId)?.staffId ?? null;
    const { error: bookingUpdateError } = await context.supabase
      .from("bookings")
      .update({
        staff_id: representativeStaffId,
        updated_by_user_id: context.user.id,
      })
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id);

    if (bookingUpdateError) {
      throw bookingUpdateError;
    }

    if (assignmentChanges.length > 0) {
      const { error: eventError } = await context.supabase
        .from("booking_status_events")
        .insert({
          actor_source: "manager",
          actor_user_id: context.user.id,
          booking_id: input.bookingId,
          event_type: "staff_reassigned",
          metadata: {
            line_assignments: assignmentChanges,
            representative_staff_id: representativeStaffId,
          },
          new_status: normalizeMutableStatus(booking.status),
          old_status: normalizeMutableStatus(booking.status),
          salon_id: context.salon.id,
        });

      if (eventError) {
        throw eventError;
      }
    }

    return bookingOk({ bookingId: input.bookingId });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function cancelCanonicalBooking(
  input: BookingCancellationInput,
): Promise<BookingDomainResult<{ bookingId: string }>> {
  if (!input.reason.trim()) {
    return bookingFailure("invalid_input", "Cancellation reason is required.");
  }

  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const { data: currentBooking, error: loadError } = await context.supabase
      .from("bookings")
      .select("status")
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .maybeSingle<{ status: CanonicalBookingStatus | "scheduled" }>();

    if (loadError) {
      throw loadError;
    }

    if (!currentBooking) {
      return bookingFailure("not_found", "Booking was not found.");
    }

    const currentStatus = normalizeMutableStatus(currentBooking.status);

    if (!ALLOWED_TRANSITIONS[currentStatus]?.includes("cancelled")) {
      return bookingFailure(
        "invalid_input",
        `Cannot transition booking from ${currentStatus} to cancelled.`,
        "status",
      );
    }

    const { error } = await context.supabase
      .from("bookings")
      .update({
        cancellation_reason: input.reason.trim(),
        cancelled_at: new Date().toISOString(),
        cancelled_by_user_id: context.user.id,
        confirmation_status: "cancelled",
        status: "cancelled",
        updated_by_user_id: context.user.id,
      })
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id);

    if (error) {
      throw error;
    }

    return bookingOk({ bookingId: input.bookingId });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function markBookingNoShow(
  input: BookingNoShowInput,
): Promise<BookingDomainResult<{ bookingId: string }>> {
  try {
    const context = await requireManageBookingDomainContext();

    if (!context.ok) {
      return context;
    }

    const { data: currentBooking, error: loadError } = await context.supabase
      .from("bookings")
      .select("status")
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id)
      .maybeSingle<{ status: CanonicalBookingStatus | "scheduled" }>();

    if (loadError) {
      throw loadError;
    }

    if (!currentBooking) {
      return bookingFailure("not_found", "Booking was not found.");
    }

    const currentStatus = normalizeMutableStatus(currentBooking.status);

    if (!ALLOWED_TRANSITIONS[currentStatus]?.includes("no_show")) {
      return bookingFailure(
        "invalid_input",
        `Cannot transition booking from ${currentStatus} to no_show.`,
        "status",
      );
    }

    const { error } = await context.supabase
      .from("bookings")
      .update({
        confirmation_status: "cancelled",
        no_show_at: new Date().toISOString(),
        no_show_by_user_id: context.user.id,
        no_show_reason: input.reason?.trim() || null,
        status: "no_show",
        updated_by_user_id: context.user.id,
      })
      .eq("id", input.bookingId)
      .eq("salon_id", context.salon.id);

    if (error) {
      throw error;
    }

    return bookingOk({ bookingId: input.bookingId });
  } catch (error) {
    return bookingFailureFromUnknown(error);
  }
}

export async function convertBookingToTicket(
  input: BookingTicketConversionInput,
): Promise<BookingDomainResult<{ bookingId: string }>> {
  return updateCurrentSalonBooking(input.bookingId, {
    pos_ticket_id: input.ticketId,
  });
}
