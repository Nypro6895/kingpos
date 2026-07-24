"use server";

import {
  assignBookingStaff,
  cancelCanonicalBooking,
  createCanonicalBookingForCurrentSalon,
  markBookingNoShow,
  rescheduleBooking,
  transitionBookingStatus,
} from "@/lib/booking-domain/mutations";
import {
  BOOKING_PERMISSIONS,
  BOOKING_SETTINGS_SELECT,
  deriveBookingCreationSchedule,
  localDateTimeToUtcIso,
} from "@/lib/bookings";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BookingConfirmationMode,
  BookingSource,
  BookingTicketCreationMode,
  CanonicalBookingStatus,
} from "@/types/booking";
import { BOOKING_SOURCES, BOOKING_TICKET_CREATION_MODES } from "@/types/booking";
import { revalidatePath } from "next/cache";

export type BookingActionResult = {
  bookingId?: string;
  code?: string;
  field?: string;
  message: string;
  ok: boolean;
  ticketId?: string;
};

export type OwnerAppointmentLineInput = {
  serviceId: string;
  staffId?: string | null;
};

export type CreateOwnerAppointmentInput = {
  confirmationMode?: BookingConfirmationMode;
  customerEmail?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerUserId?: string | null;
  idempotencyKey: string;
  internalNotes?: string | null;
  lines: OwnerAppointmentLineInput[];
  overbookingOverrideReason?: string | null;
  publicNotes?: string | null;
  source?: BookingSource;
  sourceReferenceId?: string | null;
  sourceReferenceType?: string | null;
  startLocal: string;
};

export type BookingStatusActionInput = {
  bookingId: string;
  command:
    | "cancel"
    | "check_in"
    | "complete"
    | "confirm"
    | "mark_no_show"
    | "start_service";
  reason?: string | null;
};

export type BookingRescheduleActionInput = {
  bookingId: string;
  endLocal: string;
  overbookingOverrideReason?: string | null;
  startLocal: string;
};

export type BookingReassignActionInput = {
  bookingId: string;
  lineAssignments: {
    bookingLineId: string;
    staffId: string | null;
  }[];
  overbookingOverrideReason?: string | null;
};

export type UpdateBookingSettingsInput = {
  anyProfessionalEnabled: boolean;
  bookingEnabled: boolean;
  cancellationWindowMinutes: number;
  confirmationMode: BookingConfirmationMode;
  defaultCleanupBufferMinutes: number;
  guestBookingEnabled: boolean;
  maximumAdvanceWindowDays: number;
  minimumLeadTimeMinutes: number;
  onlineBookingVisible: boolean;
  sameDayBookingEnabled: boolean;
  slotIntervalMinutes: number;
  splitStaffAppointmentEnabled: boolean;
  ticketCreationMode: BookingTicketCreationMode;
  timezoneIana: string;
};

type BookingActionContext = {
  Account: NonNullable<
    Awaited<ReturnType<typeof getCurrentBusinessContext>>["currentAccount"]
  >;
  salon: NonNullable<
    Awaited<ReturnType<typeof getCurrentBusinessContext>>["currentSalon"]
  >;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
};

function failure(
  message: string,
  options?: { code?: string; field?: string },
): BookingActionResult {
  return {
    code: options?.code,
    field: options?.field,
    message,
    ok: false,
  };
}

function success(
  message: string,
  bookingId?: string,
  ticketId?: string,
): BookingActionResult {
  return {
    bookingId,
    message,
    ok: true,
    ticketId,
  };
}

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

function cleanId(value: string | null | undefined) {
  const trimmed = cleanString(value);

  return trimmed || null;
}

function normalizeSource(value: BookingSource | undefined) {
  if (value && BOOKING_SOURCES.includes(value)) {
    return value;
  }

  return "owner_manual";
}

async function requireBookingActionContext(): Promise<
  | { data: BookingActionContext; ok: true }
  | { error: BookingActionResult; ok: false }
> {
  const [context, supabase] = await Promise.all([
    getCurrentBusinessContext(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!context.user || !supabase) {
    return {
      error: failure("Sign in required.", { code: "unauthenticated" }),
      ok: false,
    };
  }

  if (
    !isSalonManageContext(context) ||
    !context.currentAccount ||
    !context.currentSalon
  ) {
    return {
      error: failure("Open bookings from a Business workspace.", {
        code: "invalid_context",
      }),
      ok: false,
    };
  }

  try {
    await requirePermission(BOOKING_PERMISSIONS.manage, context);
  } catch {
    return {
      error: failure("You do not have permission to manage bookings.", {
        code: "forbidden",
      }),
      ok: false,
    };
  }

  return {
    data: {
      Account: context.currentAccount,
      salon: context.currentSalon,
      supabase,
    },
    ok: true,
  };
}

async function loadBookingSettings(context: BookingActionContext) {
  const { data, error } = await context.supabase
    .from("booking_settings")
    .select(BOOKING_SETTINGS_SELECT)
    .eq("salon_id", context.salon.id)
    .maybeSingle<{
      default_cleanup_buffer_minutes: number;
      ticket_creation_mode: BookingTicketCreationMode;
      timezone_iana: string;
    }>();

  if (error) {
    throw error;
  }

  return {
    cleanupBufferMinutes: Math.max(0, data?.default_cleanup_buffer_minutes ?? 0),
    ticketCreationMode: data?.ticket_creation_mode ?? "manual",
    timezone: data?.timezone_iana || "America/Chicago",
  };
}

async function convertBookingToTicketWithContext(
  context: BookingActionContext,
  bookingId: string,
): Promise<BookingActionResult> {
  const { data, error } = await context.supabase.rpc("convert_booking_to_pos_ticket", {
    p_booking_id: bookingId,
  });

  if (error) {
    return failure(error.message, { code: error.code });
  }

  if (typeof data !== "string") {
    return failure("Ticket conversion returned no ticket id.", {
      code: "database_error",
    });
  }

  revalidatePath("/bookings");
  revalidatePath("/pos");
  revalidatePath("/pos-tickets");
  revalidatePath(`/pos-tickets/${data}`);

  return success("POS ticket is ready.", bookingId, data);
}

function validateAppointmentInput(input: CreateOwnerAppointmentInput) {
  const idempotencyKey = cleanString(input.idempotencyKey);
  const serviceLines = input.lines
    .map((line) => ({
      serviceId: cleanId(line.serviceId),
      staffId: cleanId(line.staffId),
    }))
    .filter((line) => line.serviceId);

  if (!idempotencyKey) {
    return failure("Idempotency key is required.", {
      field: "idempotencyKey",
    });
  }

  if (serviceLines.length === 0) {
    return failure("Select at least one service.", { field: "services" });
  }

  if (!cleanId(input.customerId) && !cleanId(input.customerUserId)) {
    const hasQuickCustomer =
      cleanString(input.customerName) ||
      cleanString(input.customerPhone) ||
      cleanString(input.customerEmail);

    if (!hasQuickCustomer) {
      return failure("Choose or quick-create a customer.", { field: "customer" });
    }
  }

  return {
    idempotencyKey,
    serviceLines: serviceLines as { serviceId: string; staffId: string | null }[],
  };
}

export async function createOwnerAppointmentAction(
  input: CreateOwnerAppointmentInput,
): Promise<BookingActionResult> {
  try {
    const context = await requireBookingActionContext();

    if (!context.ok) {
      return context.error;
    }

    const validated = validateAppointmentInput(input);

    if ("message" in validated) {
      return validated;
    }

    const settings = await loadBookingSettings(context.data);
    const startAt = localDateTimeToUtcIso(input.startLocal, settings.timezone);

    if (!startAt) {
      return failure("Select a valid appointment start time.", {
        field: "startLocal",
      });
    }

    const schedule = await deriveBookingCreationSchedule({
      cleanupBufferMinutes: settings.cleanupBufferMinutes,
      accountId: context.data.Account.id,
      salonId: context.data.salon.id,
      serviceIds: validated.serviceLines.map((line) => line.serviceId),
      staffIds: validated.serviceLines.map((line) => line.staffId),
      startAt,
    });
    const confirmationMode = input.confirmationMode ?? "request_confirmation";
    const createResult = await createCanonicalBookingForCurrentSalon({
      confirmationMode,
      confirmationStatus:
        confirmationMode === "instant_booking" ? "confirmed" : "requested",
      customer: {
        customerId: cleanId(input.customerId),
        customerUserId: cleanId(input.customerUserId),
        email: cleanString(input.customerEmail),
        name: cleanString(input.customerName),
        phone: cleanString(input.customerPhone),
      },
      endAt: schedule.endAt,
      idempotencyKey: validated.idempotencyKey,
      internalNotes: cleanString(input.internalNotes),
      lines: schedule.lines.map((line, index) => ({
        assignedStaffId: line.staffId,
        cleanupBufferMinutes: line.cleanupBufferMinutes,
        displayOrder: index,
        scheduledEndAt: line.scheduledEndAt,
        scheduledStartAt: line.scheduledStartAt,
        serviceId: line.serviceId,
      })),
      overbookingOverrideReason: cleanString(input.overbookingOverrideReason),
      publicNotes: cleanString(input.publicNotes),
      source: normalizeSource(input.source),
      sourceReferenceId: cleanId(input.sourceReferenceId),
      sourceReferenceType: cleanString(input.sourceReferenceType),
      startAt,
      status: confirmationMode === "instant_booking" ? "confirmed" : "pending",
    });

    if (!createResult.ok) {
      return failure(createResult.error.message, {
        code: createResult.error.code,
        field: createResult.error.field,
      });
    }

    if (
      cleanString(input.sourceReferenceType) === "salon_profile_booking_request" &&
      cleanId(input.sourceReferenceId)
    ) {
      const { error: requestUpdateError } = await context.data.supabase
        .from("salon_profile_booking_requests")
        .update({ status: "approved" })
        .eq("id", cleanId(input.sourceReferenceId))
        .eq("salon_id", context.data.salon.id)
        .eq("status", "requested");

      if (requestUpdateError) {
        throw requestUpdateError;
      }
    }

    revalidatePath("/bookings");
    return success("Appointment created.", createResult.data.bookingId);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Appointment could not be created.",
      { code: "database_error" },
    );
  }
}

function statusForCommand(
  command: BookingStatusActionInput["command"],
): CanonicalBookingStatus | null {
  switch (command) {
    case "confirm":
      return "confirmed";
    case "check_in":
      return "checked_in";
    case "start_service":
      return "in_service";
    case "complete":
      return "completed";
    default:
      return null;
  }
}

export async function runBookingStatusAction(
  input: BookingStatusActionInput,
): Promise<BookingActionResult> {
  const bookingId = cleanId(input.bookingId);

  if (!bookingId) {
    return failure("Booking id is required.", { field: "bookingId" });
  }

  const context = await requireBookingActionContext();

  if (!context.ok) {
    return context.error;
  }

  const result =
    input.command === "cancel"
      ? await cancelCanonicalBooking({
          bookingId,
          reason: cleanString(input.reason) ?? "Cancelled by owner.",
        })
      : input.command === "mark_no_show"
        ? await markBookingNoShow({
            bookingId,
            reason: cleanString(input.reason),
          })
        : await transitionBookingStatus({
            bookingId,
            nextStatus: statusForCommand(input.command) ?? "confirmed",
          });

  if (!result.ok) {
    return failure(result.error.message, {
      code: result.error.code,
      field: result.error.field,
    });
  }

  revalidatePath("/bookings");

  if (input.command === "check_in" || input.command === "start_service") {
    const settings = await loadBookingSettings(context.data);
    const shouldAutoCreateTicket =
      (input.command === "check_in" &&
        settings.ticketCreationMode === "on_check_in") ||
      (input.command === "start_service" &&
        settings.ticketCreationMode === "on_service_start");

    if (shouldAutoCreateTicket) {
      const ticketResult = await convertBookingToTicketWithContext(
        context.data,
        bookingId,
      );

      if (ticketResult.ok) {
        return success(
          "Appointment updated and POS ticket is ready.",
          bookingId,
          ticketResult.ticketId,
        );
      }

      return {
        bookingId,
        code: ticketResult.code,
        message: `Appointment updated. POS ticket was not created: ${ticketResult.message}`,
        ok: true,
      };
    }
  }

  return success("Appointment updated.", bookingId);
}

export async function createBookingPosTicketAction(input: {
  bookingId: string;
}): Promise<BookingActionResult> {
  const bookingId = cleanId(input.bookingId);

  if (!bookingId) {
    return failure("Booking id is required.", { field: "bookingId" });
  }

  try {
    const context = await requireBookingActionContext();

    if (!context.ok) {
      return context.error;
    }

    const result = await convertBookingToTicketWithContext(context.data, bookingId);

    if (!result.ok) {
      return result;
    }

    return success("POS ticket is ready.", bookingId, result.ticketId);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "POS ticket could not be created.",
      { code: "database_error" },
    );
  }
}

export async function rescheduleOwnerBookingAction(
  input: BookingRescheduleActionInput,
): Promise<BookingActionResult> {
  const bookingId = cleanId(input.bookingId);

  if (!bookingId) {
    return failure("Booking id is required.", { field: "bookingId" });
  }

  try {
    const context = await requireBookingActionContext();

    if (!context.ok) {
      return context.error;
    }

    const settings = await loadBookingSettings(context.data);
    const startAt = localDateTimeToUtcIso(input.startLocal, settings.timezone);
    const endAt = localDateTimeToUtcIso(input.endLocal, settings.timezone);

    if (!startAt || !endAt) {
      return failure("Select a valid start and end time.", {
        field: "startLocal",
      });
    }

    const result = await rescheduleBooking({
      bookingId,
      endAt,
      overbookingOverrideReason: cleanString(input.overbookingOverrideReason),
      startAt,
    });

    if (!result.ok) {
      return failure(result.error.message, {
        code: result.error.code,
        field: result.error.field,
      });
    }

    revalidatePath("/bookings");
    return success("Appointment rescheduled.", bookingId);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Appointment could not be rescheduled.",
      { code: "database_error" },
    );
  }
}

export async function reassignOwnerBookingAction(
  input: BookingReassignActionInput,
): Promise<BookingActionResult> {
  const bookingId = cleanId(input.bookingId);

  if (!bookingId) {
    return failure("Booking id is required.", { field: "bookingId" });
  }

  const context = await requireBookingActionContext();

  if (!context.ok) {
    return context.error;
  }

  const result = await assignBookingStaff({
    bookingId,
    lineAssignments: input.lineAssignments.map((assignment) => ({
      bookingLineId: assignment.bookingLineId,
      staffId: cleanId(assignment.staffId),
    })),
    overbookingOverrideReason: cleanString(input.overbookingOverrideReason),
    staffId:
      input.lineAssignments.find((assignment) => cleanId(assignment.staffId))
        ?.staffId ?? null,
  });

  if (!result.ok) {
    return failure(result.error.message, {
      code: result.error.code,
      field: result.error.field,
    });
  }

  revalidatePath("/bookings");
  return success("Staff assignment updated.", bookingId);
}

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function validateIntegerRange(input: {
  label: string;
  max: number;
  min: number;
  value: number;
}) {
  if (
    !Number.isInteger(input.value) ||
    input.value < input.min ||
    input.value > input.max
  ) {
    return `${input.label} must be between ${input.min} and ${input.max}.`;
  }

  return null;
}

export async function updateBookingSettingsAction(
  input: UpdateBookingSettingsInput,
): Promise<BookingActionResult> {
  try {
    const context = await requireBookingActionContext();

    if (!context.ok) {
      return context.error;
    }

    const slotIntervals = new Set([5, 10, 15, 20, 30, 60]);
    const rangeErrors = [
      validateIntegerRange({
        label: "Minimum lead time",
        max: 10080,
        min: 0,
        value: input.minimumLeadTimeMinutes,
      }),
      validateIntegerRange({
        label: "Maximum advance window",
        max: 730,
        min: 1,
        value: input.maximumAdvanceWindowDays,
      }),
      validateIntegerRange({
        label: "Cleanup buffer",
        max: 240,
        min: 0,
        value: input.defaultCleanupBufferMinutes,
      }),
      validateIntegerRange({
        label: "Cancellation window",
        max: 10080,
        min: 0,
        value: input.cancellationWindowMinutes,
      }),
    ].filter((message): message is string => Boolean(message));

    if (rangeErrors.length > 0) {
      return failure(rangeErrors[0], { field: "settings" });
    }

    if (!slotIntervals.has(input.slotIntervalMinutes)) {
      return failure("Slot interval must be 5, 10, 15, 20, 30, or 60 minutes.", {
        field: "slotIntervalMinutes",
      });
    }

    if (!isValidTimeZone(input.timezoneIana)) {
      return failure("Timezone is invalid.", { field: "timezoneIana" });
    }

    if (!BOOKING_TICKET_CREATION_MODES.includes(input.ticketCreationMode)) {
      return failure("Ticket creation mode is invalid.", {
        field: "ticketCreationMode",
      });
    }

    if (input.confirmationMode === "instant_booking") {
      const [
        assignmentsResult,
        servicesResult,
        staffResult,
        availabilityResult,
      ] = await Promise.all([
        context.data.supabase
          .from("staff_service_assignments")
          .select("service_id, staff_id")
          .eq("salon_id", context.data.salon.id)
          .eq("is_active", true)
          .eq("online_bookable", true),
        context.data.supabase
          .from("services")
          .select("id")
          .eq("salon_id", context.data.salon.id)
          .eq("is_active", true)
          .eq("online_booking_enabled", true),
        context.data.supabase
          .from("staff")
          .select("id")
          .eq("salon_id", context.data.salon.id)
          .eq("is_active", true)
          .eq("online_booking_enabled", true)
          .eq("owner_public_enabled", true)
          .eq("public_profile_visible", true)
          .eq("staff_public_consent_status", "granted"),
        context.data.supabase
          .from("staff_availability_rules")
          .select("id")
          .eq("salon_id", context.data.salon.id)
          .eq("is_active", true)
          .eq("rule_type", "working")
          .limit(1),
      ]);

      for (const result of [
        assignmentsResult,
        servicesResult,
        staffResult,
        availabilityResult,
      ]) {
        if (result.error) {
          throw result.error;
        }
      }

      const onlineServiceIds = new Set(
        (servicesResult.data ?? []).map((service) => service.id),
      );
      const readyStaffIds = new Set(
        (staffResult.data ?? []).map((member) => member.id),
      );
      const hasReadyAssignment = (assignmentsResult.data ?? []).some(
        (assignment) =>
          onlineServiceIds.has(assignment.service_id) &&
          readyStaffIds.has(assignment.staff_id),
      );

      if (
        !hasReadyAssignment ||
        (availabilityResult.data ?? []).length === 0
      ) {
        return failure(
          "Instant booking requires an online service with Booking staff and working hours.",
          { field: "confirmationMode" },
        );
      }
    }

    const { error } = await context.data.supabase
      .from("booking_settings")
      .upsert(
        {
          any_professional_enabled: input.anyProfessionalEnabled,
          booking_enabled: input.bookingEnabled,
          cancellation_window_minutes: input.cancellationWindowMinutes,
          confirmation_mode: input.confirmationMode,
          default_cleanup_buffer_minutes: input.defaultCleanupBufferMinutes,
          guest_booking_enabled: input.guestBookingEnabled,
          maximum_advance_window_days: input.maximumAdvanceWindowDays,
          minimum_lead_time_minutes: input.minimumLeadTimeMinutes,
          online_booking_visible: input.onlineBookingVisible,
          same_day_booking_enabled: input.sameDayBookingEnabled,
          salon_id: context.data.salon.id,
          slot_interval_minutes: input.slotIntervalMinutes,
          split_staff_appointment_enabled: input.splitStaffAppointmentEnabled,
          ticket_creation_mode: input.ticketCreationMode,
          timezone_iana: input.timezoneIana,
        },
        { onConflict: "salon_id" },
      );

    if (error) {
      throw error;
    }

    revalidatePath("/bookings");
    return success("Booking settings saved.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Booking settings could not be saved.",
      { code: "database_error" },
    );
  }
}
