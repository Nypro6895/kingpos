"use server";

import {
  createCanonicalBookingForCurrentSalon,
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
import { SERVICE_PERMISSIONS } from "@/lib/services";
import {
  STAFF_PERMISSIONS,
  createStaff as createStaffRecord,
} from "@/lib/staff";
import { broadcastPosStaffChange } from "@/lib/pos-staff-realtime-server";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BookingConfirmationMode,
  BookingSource,
  BookingTicketCreationMode,
} from "@/types/booking";
import { BOOKING_SOURCES, BOOKING_TICKET_CREATION_MODES } from "@/types/booking";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

export type BookingActionResult = {
  bookingId?: string;
  code?: string;
  field?: string;
  message: string;
  ok: boolean;
  staffId?: string;
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
  expectedUpdatedAt: string;
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
  expectedUpdatedAt: string;
  bookingId: string;
  endLocal: string;
  overbookingOverrideReason?: string | null;
  startLocal: string;
};

export type BookingReassignActionInput = {
  expectedUpdatedAt: string;
  bookingId: string;
  lineAssignments: {
    bookingLineId: string;
    staffId: string | null;
  }[];
  overbookingOverrideReason?: string | null;
};

export type BookingServicesActionInput = {
  expectedUpdatedAt: string;
  bookingId: string;
  overbookingOverrideReason?: string | null;
  serviceIds: string[];
  staffIds?: (string | null)[];
};

export type UpdateBookingSettingsInput = {
  autoAssignEnabled: boolean;
  reminderEnabled: boolean;
  confirmationEmailEnabled: boolean;
  confirmationSmsEnabled: boolean;
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

export type UpdateQuickSetupServiceOnlineInput = {
  onlineBookingEnabled: boolean;
  serviceId: string;
};

export type UpdateQuickSetupStaffOnlineInput = {
  onlineBookingEnabled: boolean;
  staffId: string;
};

export type UpdateQuickSetupAssignmentInput = {
  selected: boolean;
  serviceId: string;
  staffId: string;
};

export type CreateQuickSetupStaffInput = {
  displayName: string;
  jobTitle?: string | null;
  onlineBookingEnabled: boolean;
  serviceIds?: string[];
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

function cleanIdList(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => cleanId(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
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

async function requireBookingSetupMutationContext(
  permission: string,
): Promise<
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
    await requirePermission(permission, context);
  } catch {
    return {
      error: failure("You do not have permission to manage this setup area.", {
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

function revalidateBookingSetupChange(salonId: string) {
  revalidatePath("/bookings");
  revalidatePath("/services");
  revalidatePath("/staff");
  revalidatePath("/staff/appointments");
  revalidatePath("/salon-profile");
  revalidatePath("/explore");
  revalidatePath(`/book/${salonId}`);
}

export async function createQuickSetupStaffAction(
  input: CreateQuickSetupStaffInput,
): Promise<BookingActionResult> {
  const displayName = cleanString(input.displayName);
  const jobTitle = cleanString(input.jobTitle);
  const serviceIds = cleanIdList(input.serviceIds);

  if (!displayName) {
    return failure("Professional name is required.", { field: "displayName" });
  }

  if (displayName.length > 120) {
    return failure("Professional name must be 120 characters or fewer.", {
      field: "displayName",
    });
  }

  if (jobTitle && jobTitle.length > 120) {
    return failure("Job title must be 120 characters or fewer.", {
      field: "jobTitle",
    });
  }

  try {
    const context = await requireBookingSetupMutationContext(
      STAFF_PERMISSIONS.manage,
    );

    if (!context.ok) {
      return context.error;
    }

    if (serviceIds.length > 0) {
      const assignmentContext = await requireBookingSetupMutationContext(
        BOOKING_PERMISSIONS.manage,
      );

      if (!assignmentContext.ok) {
        return assignmentContext.error;
      }

      const { data: services, error } = await context.data.supabase
        .from("services")
        .select("id")
        .eq("salon_id", context.data.salon.id)
        .eq("is_active", true)
        .in("id", serviceIds);

      if (error) {
        throw error;
      }

      if ((services ?? []).length !== serviceIds.length) {
        return failure("Choose active services from this salon.", {
          field: "serviceIds",
        });
      }
    }

    const staff = await createStaffRecord({
      display_name: displayName,
      is_active: true,
      job_title: jobTitle,
      online_booking_enabled: input.onlineBookingEnabled,
      pos_enabled: true,
      salon_profile_content_posting_enabled: false,
    });

    if (serviceIds.length > 0) {
      const { error } = await context.data.supabase
        .from("staff_service_assignments")
        .insert(
          serviceIds.map((serviceId) => ({
            created_by_user_id: context.data.user.id,
            is_active: true,
            online_bookable: true,
            salon_id: context.data.salon.id,
            service_id: serviceId,
            staff_id: staff.id,
            updated_by_user_id: context.data.user.id,
          })),
        );

      if (error) {
        throw error;
      }
    }

    revalidateBookingSetupChange(context.data.salon.id);
    after(() => broadcastPosStaffChange(context.data.salon.id, "staff"));
    return {
      message:
        serviceIds.length > 0
          ? "Professional created and matched to services."
          : "Professional created.",
      ok: true,
      staffId: staff.id,
    };
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Professional could not be created.",
      { code: "database_error" },
    );
  }
}

export async function updateQuickSetupServiceOnlineAction(
  input: UpdateQuickSetupServiceOnlineInput,
): Promise<BookingActionResult> {
  const serviceId = cleanId(input.serviceId);

  if (!serviceId) {
    return failure("Service id is required.", { field: "serviceId" });
  }

  try {
    const context = await requireBookingSetupMutationContext(
      SERVICE_PERMISSIONS.manage,
    );

    if (!context.ok) {
      return context.error;
    }

    const { data: service, error: loadError } = await context.data.supabase
      .from("services")
      .select("id, is_active")
      .eq("id", serviceId)
      .eq("salon_id", context.data.salon.id)
      .maybeSingle<{ id: string; is_active: boolean }>();

    if (loadError) {
      throw loadError;
    }

    if (!service) {
      return failure("Service was not found.", { code: "not_found" });
    }

    if (input.onlineBookingEnabled && !service.is_active) {
      return failure("Activate this service before offering it online.", {
        field: "serviceId",
      });
    }

    const { error } = await context.data.supabase
      .from("services")
      .update({
        online_booking_enabled: input.onlineBookingEnabled,
      })
      .eq("id", serviceId)
      .eq("salon_id", context.data.salon.id);

    if (error) {
      throw error;
    }

    revalidateBookingSetupChange(context.data.salon.id);
    after(() => broadcastPosStaffChange(context.data.salon.id, "booking"));
    return success(
      input.onlineBookingEnabled
        ? "Service is bookable online."
        : "Service removed from online booking.",
    );
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Service online booking could not be updated.",
      { code: "database_error" },
    );
  }
}

export async function updateQuickSetupStaffOnlineAction(
  input: UpdateQuickSetupStaffOnlineInput,
): Promise<BookingActionResult> {
  const staffId = cleanId(input.staffId);

  if (!staffId) {
    return failure("Professional id is required.", { field: "staffId" });
  }

  try {
    const context = await requireBookingSetupMutationContext(
      STAFF_PERMISSIONS.manage,
    );

    if (!context.ok) {
      return context.error;
    }

    const { data: staff, error: loadError } = await context.data.supabase
      .from("staff")
      .select("id, is_active")
      .eq("id", staffId)
      .eq("salon_id", context.data.salon.id)
      .maybeSingle<{ id: string; is_active: boolean }>();

    if (loadError) {
      throw loadError;
    }

    if (!staff) {
      return failure("Professional was not found.", { code: "not_found" });
    }

    if (input.onlineBookingEnabled && !staff.is_active) {
      return failure("Activate this professional before online booking.", {
        field: "staffId",
      });
    }

    const { error } = await context.data.supabase
      .from("staff")
      .update({
        online_booking_enabled: input.onlineBookingEnabled,
      })
      .eq("id", staffId)
      .eq("salon_id", context.data.salon.id);

    if (error) {
      throw error;
    }

    revalidateBookingSetupChange(context.data.salon.id);
    after(() => broadcastPosStaffChange(context.data.salon.id, "booking"));
    return success(
      input.onlineBookingEnabled
        ? "Professional is available online."
        : "Professional removed from online booking.",
    );
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Professional online booking could not be updated.",
      { code: "database_error" },
    );
  }
}

export async function updateQuickSetupAssignmentAction(
  input: UpdateQuickSetupAssignmentInput,
): Promise<BookingActionResult> {
  const serviceId = cleanId(input.serviceId);
  const staffId = cleanId(input.staffId);

  if (!serviceId || !staffId) {
    return failure("Choose a service and professional.", {
      field: !serviceId ? "serviceId" : "staffId",
    });
  }

  try {
    const context = await requireBookingSetupMutationContext(
      BOOKING_PERMISSIONS.manage,
    );

    if (!context.ok) {
      return context.error;
    }

    const [serviceResult, staffResult, assignmentResult] = await Promise.all([
      context.data.supabase
        .from("services")
        .select("id, is_active")
        .eq("id", serviceId)
        .eq("salon_id", context.data.salon.id)
        .maybeSingle<{ id: string; is_active: boolean }>(),
      context.data.supabase
        .from("staff")
        .select("id, is_active")
        .eq("id", staffId)
        .eq("salon_id", context.data.salon.id)
        .maybeSingle<{ id: string; is_active: boolean }>(),
      context.data.supabase
        .from("staff_service_assignments")
        .select("id")
        .eq("salon_id", context.data.salon.id)
        .eq("service_id", serviceId)
        .eq("staff_id", staffId)
        .maybeSingle<{ id: string }>(),
    ]);

    const firstError =
      serviceResult.error ?? staffResult.error ?? assignmentResult.error;

    if (firstError) {
      throw firstError;
    }

    if (!serviceResult.data) {
      return failure("Service was not found.", { code: "not_found" });
    }

    if (!staffResult.data) {
      return failure("Professional was not found.", { code: "not_found" });
    }

    if (
      input.selected &&
      (!serviceResult.data.is_active || !staffResult.data.is_active)
    ) {
      return failure("Only active services and professionals can be matched.", {
        field: "assignment",
      });
    }

    if (assignmentResult.data) {
      const { error } = await context.data.supabase
        .from("staff_service_assignments")
        .update({
          ...(input.selected ? { is_active: true } : {}),
          online_bookable: input.selected,
          updated_by_user_id: context.data.user.id,
        })
        .eq("id", assignmentResult.data.id)
        .eq("salon_id", context.data.salon.id);

      if (error) {
        throw error;
      }
    } else if (input.selected) {
      const { error } = await context.data.supabase
        .from("staff_service_assignments")
        .insert({
          created_by_user_id: context.data.user.id,
          is_active: true,
          online_bookable: true,
          salon_id: context.data.salon.id,
          service_id: serviceId,
          staff_id: staffId,
          updated_by_user_id: context.data.user.id,
        });

      if (error) {
        throw error;
      }
    }

    revalidateBookingSetupChange(context.data.salon.id);
    after(() => broadcastPosStaffChange(context.data.salon.id, "booking"));
    return success(
      input.selected
        ? "Professional can take this service online."
        : "Professional removed from this online service.",
    );
  } catch (error) {
    return failure(
      error instanceof Error
        ? error.message
        : "Booking assignment could not be updated.",
      { code: "database_error" },
    );
  }
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
  after(() => broadcastPosStaffChange(context.salon.id, "booking"));

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
  revalidatePath("/", "layout");
  revalidatePath("/bookings");
  revalidatePath("/my-bookings");
  revalidatePath(`/my-bookings/${bookingId}`);
  revalidatePath("/staff/appointments");
  revalidatePath("/notifications");
}

async function resolveBookingRequestNotifications(
  context: BookingActionContext,
  bookingId: string,
) {
  const { data, error } = await context.supabase.rpc(
    "resolve_public_booking_request_notifications",
    {
      target_booking_id: bookingId,
    },
  );

  if (error) {
    console.error("Supabase booking request notification resolution failed", {
      bookingId,
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return;
  }

  const payload = data as { code?: string; message?: string; ok?: boolean } | null;

  if (payload?.ok === false) {
    console.error("Booking request notification resolution rejected", {
      bookingId,
      code: payload.code,
      message: payload.message,
    });
  }
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
    after(() => broadcastPosStaffChange(context.data.salon.id, "booking"));
    return success("Appointment created.", createResult.data.bookingId);
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Appointment could not be created.",
      { code: "database_error" },
    );
  }
}

export async function runBookingStatusAction(input: BookingStatusActionInput): Promise<BookingActionResult> {
  return saveOwnerWorkspaceBookingAction(input);
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

export async function rescheduleOwnerBookingAction(input: BookingRescheduleActionInput): Promise<BookingActionResult> {return saveOwnerWorkspaceBookingAction(input);}
export async function reassignOwnerBookingAction(input: BookingReassignActionInput): Promise<BookingActionResult> {return saveOwnerWorkspaceBookingAction(input);}
export async function replaceOwnerBookingServicesAction(input: BookingServicesActionInput): Promise<BookingActionResult> {return saveOwnerWorkspaceBookingAction(input);}

export async function saveOwnerWorkspaceBookingAction(input: {
  bookingId:string; expectedUpdatedAt:string; startLocal?:string; endLocal?:string;
  serviceIds?:string[];staffIds?:(string|null)[];lineAssignments?:{bookingLineId:string;staffId:string|null}[];
  command?:BookingStatusActionInput['command'];reason?:string|null;overbookingOverrideReason?:string|null;
}):Promise<BookingActionResult>{
  try{
    const context=await requireBookingActionContext();if(!context.ok)return context.error;
    const bookingId=cleanId(input.bookingId);if(!bookingId||!input.expectedUpdatedAt)return failure('Open the latest appointment before saving.');
    const {data:booking,error:loadError}=await context.data.supabase.from('bookings').select('id,start_at,end_at,updated_at,staff_id').eq('id',bookingId).eq('salon_id',context.data.salon.id).single();
    if(loadError||!booking)return failure('Appointment not found.');
    if(Date.parse(booking.updated_at)!==Date.parse(input.expectedUpdatedAt))return failure('This appointment changed on another screen. Your changes are still here. Review the latest appointment before saving.',{code:'conflict'});
    const settings=await loadBookingSettings(context.data),changes:Record<string,unknown>={};
    const oldStaffIds=await loadCurrentBookingStaffIds(context.data,bookingId);
    let startAt=booking.start_at;
    if(input.startLocal!==undefined){
      const start=localDateTimeToUtcIso(input.startLocal,settings.timezone),end=localDateTimeToUtcIso(input.endLocal??'',settings.timezone);
      if(!start||!end||Date.parse(end)<=Date.parse(start))return failure('Choose a valid appointment time.');
      startAt=start;changes.start_at=start;changes.end_at=end;
    }
    if(input.serviceIds){
      const serviceIds=input.serviceIds.map(cleanId).filter((id):id is string=>Boolean(id));
      if(!serviceIds.length)return failure('Choose at least one service.');
      const {data:existing,error}=await context.data.supabase.from('booking_lines').select('assigned_staff_id').eq('booking_id',bookingId).eq('salon_id',context.data.salon.id).order('display_order');
      if(error)throw error;
      const staffIds=serviceIds.map((_,index)=>input.staffIds&&index<input.staffIds.length?cleanId(input.staffIds[index]):existing?.[index]?.assigned_staff_id??booking.staff_id??null);
      const schedule=await deriveBookingCreationSchedule({accountId:context.data.Account.id,cleanupBufferMinutes:settings.cleanupBufferMinutes,salonId:context.data.salon.id,serviceIds,staffIds,startAt});
      changes.end_at=schedule.endAt;
      changes.lines=schedule.lines.map((line,index)=>({assigned_staff_id:line.staffId,cleanup_buffer_minutes:line.cleanupBufferMinutes,display_order:index,scheduled_end_at:line.scheduledEndAt,scheduled_start_at:line.scheduledStartAt,service_id:line.serviceId}));
    }else if(input.lineAssignments){changes.assignments=input.lineAssignments;}
    if(input.command){changes.command=input.command;changes.reason=cleanString(input.reason);}
    changes.override_reason=cleanString(input.overbookingOverrideReason);
    const {error}=await context.data.supabase.rpc('save_pos_workspace_booking',{p_booking:bookingId,p_expected:input.expectedUpdatedAt,p_changes:changes});
    if(error)return failure(error.message,{code:error.message.includes('changed on another screen')?'conflict':'database_error'});
    await notifyBookingChange(context.data,{bookingId,changeType:'workspace_updated',oldStaffIds,newStaffIds:await loadCurrentBookingStaffIds(context.data,bookingId)});
    if(input.command==='confirm')await resolveBookingRequestNotifications(context.data,bookingId);
    revalidateBookingChange(bookingId);
    after(()=>broadcastPosStaffChange(context.data.salon.id,'booking'));
    if((input.command==='check_in'&&settings.ticketCreationMode==='on_check_in')||(input.command==='start_service'&&settings.ticketCreationMode==='on_service_start')){
      const ticket=await convertBookingToTicketWithContext(context.data,bookingId);
      if(ticket.ok)return success('Appointment saved and ticket is ready.',bookingId,ticket.ticketId);
      return {ok:true,bookingId,message:'Appointment saved. Open the appointment to prepare its ticket: '+ticket.message};
    }
    return success('Appointment changes saved.',bookingId);
  }catch(error){return failure(error instanceof Error?error.message:'Unable to save this appointment. Your changes are still here.',{code:'database_error'});}
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
          .eq("online_booking_enabled", true),
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
          auto_assign_enabled: input.autoAssignEnabled,
          reminder_enabled: input.reminderEnabled,
          confirmation_email_enabled: input.confirmationEmailEnabled,
          confirmation_sms_enabled: input.confirmationSmsEnabled,
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
    after(() => broadcastPosStaffChange(context.data.salon.id, "booking"));
    return success("Booking settings saved.");
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : "Booking settings could not be saved.",
      { code: "database_error" },
    );
  }
}
