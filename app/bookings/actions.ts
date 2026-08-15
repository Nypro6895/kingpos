"use server";

import {
  listStaffBookingConflicts,
} from "@/lib/booking-domain/availability";
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

export type BookingServicesActionInput = {
  bookingId: string;
  overbookingOverrideReason?: string | null;
  serviceIds: string[];
  staffIds?: (string | null)[];
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
  user: NonNullable<Awaited<ReturnType<typeof getCurrentBusinessContext>>["user"]>;
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
      user: context.user,
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

  revalidateBookingChange(bookingId);
  revalidatePath("/pos");
  revalidatePath("/pos-tickets");
  revalidatePath(`/pos-tickets/${data}`);

  return success("POS ticket is ready.", bookingId, data);
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [
    ...new Set(
      ids
        .map((id) => cleanId(id))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function revalidateBookingChange(bookingId: string) {
  revalidatePath("/bookings");
  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${bookingId}`);
  revalidatePath("/staff/appointments");
  revalidatePath("/notifications");
}

async function notifyBookingChange(
  context: BookingActionContext,
  input: {
    bookingId: string;
    changeType: string;
    newStaffIds?: string[];
    oldStaffIds?: string[];
  },
) {
  const { error } = await context.supabase.rpc("notify_booking_change", {
    p_actor_user_id: context.user.id,
    p_change_type: input.changeType,
    p_new_staff_ids: input.newStaffIds ?? [],
    p_old_staff_ids: input.oldStaffIds ?? [],
    target_booking_id: input.bookingId,
  });

  if (error) {
    console.error("Supabase booking change notification failed", {
      bookingId: input.bookingId,
      changeType: input.changeType,
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
  }
}

async function loadCurrentBookingStaffIds(
  context: BookingActionContext,
  bookingId: string,
) {
  const { data, error } = await context.supabase
    .from("booking_lines")
    .select("assigned_staff_id")
    .eq("booking_id", bookingId)
    .eq("salon_id", context.salon.id)
    .returns<{ assigned_staff_id: string | null }[]>();

  if (error) {
    throw error;
  }

  return uniqueIds((data ?? []).map((line) => line.assigned_staff_id));
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

  await notifyBookingChange(context.data, {
    bookingId,
    changeType: `status_${statusForCommand(input.command) ?? input.command}`,
  });
  revalidateBookingChange(bookingId);

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

  return success("Appointment status changed.", bookingId);
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

    await notifyBookingChange(context.data, {
      bookingId,
      changeType: "rescheduled",
    });
    revalidateBookingChange(bookingId);
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

  let oldStaffIds: string[] = [];

  try {
    oldStaffIds = await loadCurrentBookingStaffIds(context.data, bookingId);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Staff assignments could not be loaded.",
      { code: "database_error" },
    );
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

  await notifyBookingChange(context.data, {
    bookingId,
    changeType: "staff_reassigned",
    newStaffIds: uniqueIds(
      input.lineAssignments.map((assignment) => assignment.staffId),
    ),
    oldStaffIds,
  });
  revalidateBookingChange(bookingId);
  return success("Appointment professional adjusted.", bookingId);
}

type ServiceReplacementBookingRow = {
  end_at: string;
  id: string;
  pos_ticket_id: string | null;
  staff_id: string | null;
  start_at: string;
  status: CanonicalBookingStatus | "scheduled";
};

type ServiceReplacementLineRow = {
  assigned_staff_id: string | null;
  id: string;
  service_id: string | null;
};

function isServiceReplacementBlocked(status: CanonicalBookingStatus | "scheduled") {
  return status === "in_service" || status === "completed" || status === "cancelled" || status === "no_show";
}

export async function replaceOwnerBookingServicesAction(
  input: BookingServicesActionInput,
): Promise<BookingActionResult> {
  const bookingId = cleanId(input.bookingId);
  const serviceIds = (Array.isArray(input.serviceIds) ? input.serviceIds : [])
    .map((serviceId) => cleanId(serviceId))
    .filter((serviceId): serviceId is string => Boolean(serviceId));

  if (!bookingId) {
    return failure("Booking id is required.", { field: "bookingId" });
  }

  if (serviceIds.length === 0) {
    return failure("Select at least one service.", { field: "serviceIds" });
  }

  try {
    const context = await requireBookingActionContext();

    if (!context.ok) {
      return context.error;
    }

    const { data: booking, error: bookingError } = await context.data.supabase
      .from("bookings")
      .select("id, staff_id, start_at, end_at, status, pos_ticket_id")
      .eq("id", bookingId)
      .eq("salon_id", context.data.salon.id)
      .maybeSingle<ServiceReplacementBookingRow>();

    if (bookingError) {
      throw bookingError;
    }

    if (!booking) {
      return failure("Booking was not found.", { code: "not_found" });
    }

    if (booking.pos_ticket_id) {
      return failure("Open the POS ticket to adjust services after ticket creation.", {
        code: "ticket_created",
        field: "services",
      });
    }

    if (isServiceReplacementBlocked(booking.status)) {
      return failure("This appointment can no longer have services adjusted.", {
        code: "invalid_status",
        field: "services",
      });
    }

    const { data: existingLines, error: linesError } = await context.data.supabase
      .from("booking_lines")
      .select("id, service_id, assigned_staff_id")
      .eq("booking_id", bookingId)
      .eq("salon_id", context.data.salon.id)
      .order("display_order", { ascending: true })
      .returns<ServiceReplacementLineRow[]>();

    if (linesError) {
      throw linesError;
    }

    const oldStaffIds = uniqueIds(
      (existingLines ?? []).map((line) => line.assigned_staff_id),
    );
    const fallbackStaffId =
      (existingLines ?? []).find((line) => cleanId(line.assigned_staff_id))
        ?.assigned_staff_id ??
      booking.staff_id ??
      null;
    const requestedStaffIds = (Array.isArray(input.staffIds) ? input.staffIds : []).map(
      (staffId) => cleanId(staffId),
    );
    const staffIds = serviceIds.map((_, index) =>
      index < requestedStaffIds.length
        ? requestedStaffIds[index]
        : cleanId(existingLines?.[index]?.assigned_staff_id) ??
          cleanId(fallbackStaffId),
    );
    const settings = await loadBookingSettings(context.data);
    const schedule = await deriveBookingCreationSchedule({
      accountId: context.data.Account.id,
      cleanupBufferMinutes: settings.cleanupBufferMinutes,
      salonId: context.data.salon.id,
      serviceIds,
      staffIds,
      startAt: booking.start_at,
    });
    const overrideReason = cleanString(input.overbookingOverrideReason);

    for (const line of schedule.lines) {
      if (!line.staffId) {
        continue;
      }

      const conflicts = await listStaffBookingConflicts({
        bookingIdToIgnore: bookingId,
        endAt: line.scheduledEndAt,
        salonId: context.data.salon.id,
        staffId: line.staffId,
        startAt: line.scheduledStartAt,
        supabase: context.data.supabase,
      });

      if (!conflicts.ok) {
        return failure(conflicts.error.message, {
          code: conflicts.error.code,
          field: conflicts.error.field,
        });
      }

      if (conflicts.data.length > 0 && !overrideReason) {
        return failure(
          "Assigned staff already has a booking in this interval.",
          {
            code: "availability_conflict",
            field: "overbookingOverrideReason",
          },
        );
      }
    }

    const { data, error } = await context.data.supabase.rpc(
      "replace_booking_services",
      {
        p_booking_id: bookingId,
        p_end_at: schedule.endAt,
        p_lines: schedule.lines.map((line, index) => ({
          assigned_staff_id: line.staffId,
          cleanup_buffer_minutes: line.cleanupBufferMinutes,
          display_order: index,
          scheduled_end_at: line.scheduledEndAt,
          scheduled_start_at: line.scheduledStartAt,
          service_id: line.serviceId,
        })),
        p_overbooking_override_reason: overrideReason,
      },
    );

    if (error) {
      throw error;
    }

    if (typeof data !== "string") {
      return failure("Service adjustment returned no booking id.", {
        code: "database_error",
      });
    }

    await notifyBookingChange(context.data, {
      bookingId,
      changeType: "services_adjusted",
      newStaffIds: uniqueIds(staffIds),
      oldStaffIds,
    });
    revalidateBookingChange(bookingId);
    return success("Appointment services adjusted.", bookingId);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Appointment services could not be adjusted.",
      { code: "database_error" },
    );
  }
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
