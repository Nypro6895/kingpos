import "server-only";

import { formatDateInTimeZone, zonedDateTimeToUtcIso } from "@/lib/bookings";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PUBLIC_SLOT_DAYS = 45;
const MAX_SELECTED_ADD_ONS = 6;

export type PublicBookingSource = "explore" | "public_profile";
export type PublicBookingStaffMode = "any" | "specific" | "split";
export type PublicBookingPageState =
  | "booking_disabled"
  | "incomplete"
  | "no_slots"
  | "not_found"
  | "not_public"
  | "ready";

export type PublicBookingSearchParams = {
  date?: string | string[];
  lookId?: string | string[];
  serviceId?: string | string[];
  source?: string | string[];
  staffId?: string | string[];
};

export type PublicBookingSalon = {
  addressLine1: string | null;
  city: string | null;
  coverUrl: string | null;
  email: string | null;
  logoUrl: string | null;
  name: string;
  phone: string | null;
  salonId: string;
  state: string | null;
  tagline: string | null;
  website: string | null;
};

export type PublicBookingSettings = {
  anyProfessionalEnabled: boolean;
  confirmationMode: "instant_booking" | "request_confirmation";
  defaultCleanupBufferMinutes: number;
  guestBookingEnabled: boolean;
  maximumAdvanceWindowDays: number;
  minimumLeadTimeMinutes: number;
  sameDayBookingEnabled: boolean;
  slotIntervalMinutes: number;
  splitStaffAppointmentEnabled: boolean;
  timezoneIana: string;
};

export type PublicBookingService = {
  addOnIds: string[];
  basePrice: number;
  category: string | null;
  description: string | null;
  durationMinutes: number;
  id: string;
  isAddOnOnly: boolean;
  name: string;
};

export type PublicBookingStaff = {
  avatarUrl: string | null;
  bio: string | null;
  displayName: string;
  id: string;
  jobTitle: string | null;
  specialties: string[];
};

export type PublicBookingLook = {
  id: string;
  recommendedStaffId: string | null;
  serviceId: string | null;
  title: string;
};

export type PublicBookingSlotLine = {
  cleanupBufferMinutes: number;
  displayOrder: number;
  durationMinutes: number;
  endAt: string;
  lineType: "add_on" | "service";
  parentServiceId: string | null;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  startAt: string;
};

export type PublicBookingSlot = {
  date: string;
  endAt: string;
  label: string;
  lines: PublicBookingSlotLine[];
  startAt: string;
};

export type PublicBookingInitialSelection = {
  addOnSelections: PublicBookingAddOnSelection[];
  addOnServiceIds: string[];
  date: string;
  lookId: string | null;
  serviceId: string | null;
  serviceIds: string[];
  source: PublicBookingSource;
  staffId: string | null;
  staffMode: PublicBookingStaffMode;
};

export type PublicBookingReadinessItem = {
  complete: boolean;
  id: string;
  label: string;
};

export type PublicBookingPageData = {
  initialSelection: PublicBookingInitialSelection;
  looks: PublicBookingLook[];
  message: string;
  readiness: PublicBookingReadinessItem[];
  salon: PublicBookingSalon | null;
  services: PublicBookingService[];
  settings: PublicBookingSettings | null;
  slots: PublicBookingSlot[];
  staff: PublicBookingStaff[];
  staffByService: Record<string, string[]>;
  state: PublicBookingPageState;
  title: string;
};

export type PublicBookingSlotRequest = {
  addOnSelections?: PublicBookingAddOnSelection[];
  addOnServiceIds?: string[];
  date?: string | null;
  lineStaffIds?: (string | null | undefined)[];
  serviceId?: string | null;
  serviceIds?: string[];
  staffId?: string | null;
  staffMode?: PublicBookingStaffMode;
};

export type PublicBookingCreateInput = PublicBookingSlotRequest & {
  customerEmail?: string | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerPhone?: string | null;
  honeypot?: string | null;
  idempotencyKey?: string | null;
  lookId?: string | null;
  publicNotes?: string | null;
  salonId: string;
  source?: PublicBookingSource;
  startAt?: string | null;
};

export type PublicBookingActionResult = {
  bookingId?: string;
  code?: string;
  confirmationStatus?: string;
  manageToken?: string | null;
  message: string;
  ok: boolean;
  status?: string;
};

export type PublicBookingAddOnSelection = {
  parentServiceId: string;
  serviceId: string;
};

export type GuestManageBooking = {
  booking: {
    canChange: boolean;
    cancellationReason: string | null;
    cancelledAt: string | null;
    confirmationStatus: string | null;
    endAt: string;
    id: string;
    publicNotes: string | null;
    salonId: string;
    source: string | null;
    startAt: string;
    status: string;
    timezone: string;
  };
  customer: {
    email: string | null;
    name: string | null;
    phone: string | null;
  };
  lines: PublicBookingSlotLine[];
  salon: {
    addressLine1: string | null;
    city: string | null;
    name: string;
    phone: string | null;
    state: string | null;
    timezone: string;
  };
};

export type GuestManagePageData =
  | {
      booking: GuestManageBooking;
      ok: true;
      slots: PublicBookingSlot[];
    }
  | {
      code: string;
      message: string;
      ok: false;
    };

type RawContext = {
  assignments: AssignmentRow[];
  availabilityRules: AvailabilityRuleRow[];
  busyLines: BusyLineRow[];
  looks: PublicBookingLook[];
  profile: PublicBookingSalon | null;
  serviceMap: Map<string, PublicBookingService>;
  services: PublicBookingService[];
  settings: PublicBookingSettings | null;
  staff: PublicBookingStaff[];
  state: PublicBookingPageState | "booking_disabled";
  timeBlocks: TimeBlockRow[];
};

type AssignmentRow = {
  customDurationMinutes: number | null;
  customPrice: number | null;
  serviceId: string;
  staffId: string;
};

type AvailabilityRuleRow = {
  dayOfWeek: number;
  effectiveEndDate: string | null;
  effectiveStartDate: string | null;
  endsAtLocal: string;
  ruleType: "break" | "working";
  staffId: string | null;
  startsAtLocal: string;
};

type TimeBlockRow = {
  endsAt: string;
  staffId: string | null;
  startsAt: string;
};

type BusyLineRow = {
  bookingId: string;
  endsAt: string;
  staffId: string;
  startsAt: string;
};

type DraftLine = {
  lineType: "add_on" | "service";
  parentServiceId: string | null;
  service: PublicBookingService;
};

type SlotBuildOptions = {
  ignoreBookingId?: string | null;
  limit?: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nonEmptyString(value: unknown) {
  const text = stringValue(value)?.trim() ?? "";
  return text || null;
}

function numberValue(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanUuid(value: unknown) {
  const text = nonEmptyString(value);
  return text && UUID_PATTERN.test(text) ? text : null;
}

function cleanDate(value: unknown) {
  const text = nonEmptyString(value);
  return text && DATE_PATTERN.test(text) ? text : null;
}

function cleanSource(value: unknown): PublicBookingSource {
  return value === "explore" ? "explore" : "public_profile";
}

function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toIso(value: unknown) {
  const text = nonEmptyString(value);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function timeZoneParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(value);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    date: `${read("year")}-${String(read("month")).padStart(2, "0")}-${String(
      read("day"),
    ).padStart(2, "0")}`,
    minutes: read("hour") * 60 + read("minute"),
  };
}

function slotLabel(startAt: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(startAt));
}

function parseSettings(value: unknown): PublicBookingSettings | null {
  const row = asRecord(value);
  const timezone = nonEmptyString(row.timezone_iana) ?? "America/Chicago";

  if (!isValidTimeZone(timezone)) {
    return null;
  }

  return {
    anyProfessionalEnabled: booleanValue(row.any_professional_enabled, true),
    confirmationMode:
      row.confirmation_mode === "instant_booking"
        ? "instant_booking"
        : "request_confirmation",
    defaultCleanupBufferMinutes: Math.max(
      0,
      Math.round(numberValue(row.default_cleanup_buffer_minutes, 0)),
    ),
    guestBookingEnabled: booleanValue(row.guest_booking_enabled, false),
    maximumAdvanceWindowDays: Math.max(
      1,
      Math.round(numberValue(row.maximum_advance_window_days, 30)),
    ),
    minimumLeadTimeMinutes: Math.max(
      0,
      Math.round(numberValue(row.minimum_lead_time_minutes, 120)),
    ),
    sameDayBookingEnabled: booleanValue(row.same_day_booking_enabled, true),
    slotIntervalMinutes: Math.max(
      5,
      Math.round(numberValue(row.slot_interval_minutes, 15)),
    ),
    splitStaffAppointmentEnabled: booleanValue(
      row.split_staff_appointment_enabled,
      false,
    ),
    timezoneIana: timezone,
  };
}

function parseContextPayload(payload: unknown): RawContext {
  const row = asRecord(payload);
  const profileRow = asRecord(row.profile);
  const state = nonEmptyString(row.state) ?? "not_found";
  const services: PublicBookingService[] = asArray(row.services)
    .map((item) => {
      const service = asRecord(item);
      return {
        addOnIds: [],
        basePrice: numberValue(service.base_price, 0),
        category: nonEmptyString(service.category),
        description: nonEmptyString(service.description),
        durationMinutes: Math.max(
          1,
          Math.round(numberValue(service.duration_minutes, 30)),
        ),
        id: cleanUuid(service.id) ?? "",
        isAddOnOnly: false,
        name: nonEmptyString(service.name) ?? "Service",
      } satisfies PublicBookingService;
    })
    .filter((service) => service.id);
  const serviceMap = new Map(services.map((service) => [service.id, service]));

  for (const item of asArray(row.add_on_links)) {
    const link = asRecord(item);
    const parentId = cleanUuid(link.parent_service_id);
    const addOnId = cleanUuid(link.add_on_service_id);
    const parent = parentId ? serviceMap.get(parentId) : null;

    const addOn = addOnId ? serviceMap.get(addOnId) : null;

    if (parent && addOnId && addOn && !parent.addOnIds.includes(addOnId)) {
      parent.addOnIds.push(addOnId);
      addOn.isAddOnOnly = true;
    }
  }

  return {
    assignments: asArray(row.assignments)
      .map((item) => {
        const assignment = asRecord(item);
        const serviceId = cleanUuid(assignment.service_id);
        const staffId = cleanUuid(assignment.staff_id);

        if (!serviceId || !staffId) {
          return null;
        }

        return {
          customDurationMinutes:
            assignment.custom_duration_minutes === null
              ? null
              : Math.max(1, Math.round(numberValue(assignment.custom_duration_minutes, 0))),
          customPrice:
            assignment.custom_price === null
              ? null
              : numberValue(assignment.custom_price, 0),
          serviceId,
          staffId,
        } satisfies AssignmentRow;
      })
      .filter((item): item is AssignmentRow => Boolean(item)),
    availabilityRules: asArray(row.availability_rules)
      .map((item) => {
        const rule = asRecord(item);
        const ruleType = rule.rule_type === "break" ? "break" : "working";
        return {
          dayOfWeek: Math.round(numberValue(rule.day_of_week, -1)),
          effectiveEndDate: cleanDate(rule.effective_end_date),
          effectiveStartDate: cleanDate(rule.effective_start_date),
          endsAtLocal: nonEmptyString(rule.ends_at_local) ?? "17:00:00",
          ruleType,
          staffId: cleanUuid(rule.staff_id),
          startsAtLocal: nonEmptyString(rule.starts_at_local) ?? "09:00:00",
        } satisfies AvailabilityRuleRow;
      })
      .filter((rule) => rule.dayOfWeek >= 0 && rule.dayOfWeek <= 6),
    busyLines: asArray(row.busy_lines)
      .map((item) => {
        const line = asRecord(item);
        const staffId = cleanUuid(line.staff_id);
        const startsAt = toIso(line.scheduled_start_at);
        const endsAt = toIso(line.scheduled_end_at);
        const bookingId = cleanUuid(line.booking_id);

        if (!staffId || !startsAt || !endsAt || !bookingId) {
          return null;
        }

        return { bookingId, endsAt, staffId, startsAt } satisfies BusyLineRow;
      })
      .filter((item): item is BusyLineRow => Boolean(item)),
    looks: asArray(row.looks)
      .map((item) => {
        const look = asRecord(item);
        const id = cleanUuid(look.id);

        if (!id) {
          return null;
        }

        return {
          id,
          recommendedStaffId: cleanUuid(look.recommended_staff_id),
          serviceId: cleanUuid(look.service_id),
          title: nonEmptyString(look.title) ?? "Look",
        } satisfies PublicBookingLook;
      })
      .filter((item): item is PublicBookingLook => Boolean(item)),
    profile: cleanUuid(profileRow.salon_id)
      ? {
          addressLine1: nonEmptyString(profileRow.address_line1),
          city: nonEmptyString(profileRow.city),
          coverUrl: getSalonProfileMediaUrl(nonEmptyString(profileRow.cover_path)),
          email: nonEmptyString(profileRow.email),
          logoUrl: getSalonProfileMediaUrl(nonEmptyString(profileRow.logo_path)),
          name: nonEmptyString(profileRow.name) ?? "Salon",
          phone: nonEmptyString(profileRow.phone),
          salonId: cleanUuid(profileRow.salon_id) ?? "",
          state: nonEmptyString(profileRow.state),
          tagline: nonEmptyString(profileRow.tagline),
          website: nonEmptyString(profileRow.website),
        }
      : null,
    serviceMap,
    services,
    settings: parseSettings(row.settings),
    staff: asArray(row.staff)
      .map((item) => {
        const staff = asRecord(item);
        const id = cleanUuid(staff.id);

        if (!id) {
          return null;
        }

        return {
          avatarUrl: getSalonProfileMediaUrl(nonEmptyString(staff.avatar_path)),
          bio: nonEmptyString(staff.bio),
          displayName: nonEmptyString(staff.display_name) ?? "Professional",
          id,
          jobTitle: nonEmptyString(staff.job_title),
          specialties: asArray(staff.specialties).filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
          ),
        } satisfies PublicBookingStaff;
      })
      .filter((item): item is PublicBookingStaff => Boolean(item)),
    state:
      state === "not_public" ||
      state === "booking_disabled" ||
      state === "ready"
        ? state
        : "not_found",
    timeBlocks: asArray(row.time_blocks)
      .map((item) => {
        const block = asRecord(item);
        const startsAt = toIso(block.starts_at);
        const endsAt = toIso(block.ends_at);

        if (!startsAt || !endsAt) {
          return null;
        }

        return {
          endsAt,
          staffId: cleanUuid(block.staff_id),
          startsAt,
        } satisfies TimeBlockRow;
      })
      .filter((item): item is TimeBlockRow => Boolean(item)),
  };
}

async function loadRawContext(salonId: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const now = new Date();
  const { data, error } = await supabase.rpc("get_public_booking_context", {
    p_range_end: addDays(now, MAX_PUBLIC_SLOT_DAYS + 1).toISOString(),
    p_range_start: now.toISOString(),
    target_salon_id: salonId,
  });

  if (error) {
    console.error("Public booking context RPC failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId,
    });
    throw new Error("Online booking is temporarily unavailable.");
  }

  return parseContextPayload(data);
}

function unavailablePage(
  state: PublicBookingPageState,
  title: string,
  message: string,
  context?: Partial<PublicBookingPageData>,
): PublicBookingPageData {
  return {
    initialSelection: {
      addOnSelections: [],
      addOnServiceIds: [],
      date: formatDateInTimeZone(new Date(), "America/Chicago"),
      lookId: null,
      serviceId: null,
      serviceIds: [],
      source: "public_profile",
      staffId: null,
      staffMode: "any",
    },
    looks: [],
    readiness: [],
    salon: null,
    services: [],
    settings: null,
    slots: [],
    staff: [],
    staffByService: {},
    ...context,
    message,
    state,
    title,
  };
}

function staffByService(context: RawContext) {
  const visibleStaffIds = new Set(context.staff.map((staff) => staff.id));
  const result: Record<string, string[]> = {};

  for (const assignment of context.assignments) {
    if (!visibleStaffIds.has(assignment.staffId) || !context.serviceMap.has(assignment.serviceId)) {
      continue;
    }

    result[assignment.serviceId] ??= [];

    if (!result[assignment.serviceId].includes(assignment.staffId)) {
      result[assignment.serviceId].push(assignment.staffId);
    }
  }

  return result;
}

function readinessForContext(context: RawContext): PublicBookingReadinessItem[] {
  const byService = staffByService(context);
  const hasBookableService = context.services.some(
    (service) => !service.isAddOnOnly && (byService[service.id] ?? []).length > 0,
  );

  return [
    {
      complete: Boolean(context.profile),
      id: "profile",
      label: "Public profile is published",
    },
    {
      complete: Boolean(context.settings && isValidTimeZone(context.settings.timezoneIana)),
      id: "timezone",
      label: "Booking timezone is valid",
    },
    {
      complete: hasBookableService,
      id: "services",
      label: "At least one active service has an online professional",
    },
    {
      complete: context.availabilityRules.some((rule) => rule.ruleType === "working"),
      id: "availability",
      label: "Future working hours are configured",
    },
  ];
}

function serviceAssignment(context: RawContext, serviceId: string, staffId: string) {
  return context.assignments.find(
    (assignment) => assignment.serviceId === serviceId && assignment.staffId === staffId,
  );
}

function eligibleStaffIds(context: RawContext, serviceId: string) {
  const staffIds = staffByService(context)[serviceId] ?? [];
  return staffIds.filter((staffId) => context.staff.some((staff) => staff.id === staffId));
}

function staffCanPerformLines(context: RawContext, lines: DraftLine[], staffId: string) {
  return lines.every((line) => Boolean(serviceAssignment(context, line.service.id, staffId)));
}

function sharedStaffCandidates(input: {
  context: RawContext;
  lines: DraftLine[];
  mode: PublicBookingStaffMode;
  staffId: string | null;
}) {
  if (input.mode === "specific") {
    return input.staffId && staffCanPerformLines(input.context, input.lines, input.staffId)
      ? [input.staffId]
      : [];
  }

  return input.context.staff
    .map((staff) => staff.id)
    .filter((staffId) => staffCanPerformLines(input.context, input.lines, staffId));
}

function normalizedPrimaryServices(
  context: RawContext,
  request: PublicBookingSlotRequest,
): PublicBookingService[] {
  const rawIds =
    request.serviceIds && request.serviceIds.length > 0
      ? request.serviceIds
      : request.serviceId
        ? [request.serviceId]
        : [];
  const services: PublicBookingService[] = [];

  for (const rawId of rawIds) {
    const serviceId = cleanUuid(rawId);
    const service = serviceId ? context.serviceMap.get(serviceId) : null;

    if (
      service &&
      !service.isAddOnOnly &&
      !services.some((item) => item.id === service.id)
    ) {
      services.push(service);
    }
  }

  return services;
}

function normalizedAddOnSelections(
  context: RawContext,
  primaryServices: PublicBookingService[],
  request: PublicBookingSlotRequest,
) {
  const primaryIds = new Set(primaryServices.map((service) => service.id));
  const selections: PublicBookingAddOnSelection[] = [];
  const requestedSelections =
    request.addOnSelections && request.addOnSelections.length > 0
      ? request.addOnSelections
      : primaryServices.length === 1
        ? (request.addOnServiceIds ?? []).map((serviceId) => ({
            parentServiceId: primaryServices[0]?.id ?? "",
            serviceId,
          }))
        : [];

  for (const selection of requestedSelections) {
    if (selections.length >= MAX_SELECTED_ADD_ONS) {
      break;
    }

    const parentServiceId = cleanUuid(selection.parentServiceId);
    const addOnServiceId = cleanUuid(selection.serviceId);
    const parent = parentServiceId ? context.serviceMap.get(parentServiceId) : null;
    const addOn = addOnServiceId ? context.serviceMap.get(addOnServiceId) : null;

    if (
      !parentServiceId ||
      !addOnServiceId ||
      !parent ||
      !addOn ||
      !primaryIds.has(parentServiceId) ||
      !parent.addOnIds.includes(addOnServiceId) ||
      selections.some(
        (item) =>
          item.parentServiceId === parentServiceId &&
          item.serviceId === addOnServiceId,
      )
    ) {
      continue;
    }

    selections.push({
      parentServiceId,
      serviceId: addOnServiceId,
    });
  }

  return selections;
}

function selectionLines(
  context: RawContext,
  request: PublicBookingSlotRequest,
): DraftLine[] {
  const primaryServices = normalizedPrimaryServices(context, request);

  if (primaryServices.length === 0) {
    return [];
  }

  const addOnSelections = normalizedAddOnSelections(
    context,
    primaryServices,
    request,
  );
  const lines: DraftLine[] = [];

  for (const service of primaryServices) {
    lines.push({ lineType: "service", parentServiceId: null, service });

    for (const selection of addOnSelections) {
      if (selection.parentServiceId !== service.id) {
        continue;
      }

      const addOn = context.serviceMap.get(selection.serviceId);

      if (addOn) {
        lines.push({
          lineType: "add_on",
          parentServiceId: service.id,
          service: addOn,
        });
      }
    }
  }

  return lines;
}

function lineAvailable(input: {
  context: RawContext;
  endMs: number;
  ignoreBookingId?: string | null;
  staffId: string;
  startMs: number;
}) {
  const settings = input.context.settings;

  if (!settings) {
    return false;
  }

  const start = new Date(input.startMs);
  const end = new Date(input.endMs);
  const localStart = timeZoneParts(start, settings.timezoneIana);
  const localEnd = timeZoneParts(end, settings.timezoneIana);

  if (localStart.date !== localEnd.date) {
    return false;
  }

  const localDay = dayOfWeek(localStart.date);
  const matchesRuleScope = (rule: AvailabilityRuleRow) =>
    rule.dayOfWeek === localDay &&
    (!rule.staffId || rule.staffId === input.staffId) &&
    (!rule.effectiveStartDate || rule.effectiveStartDate <= localStart.date) &&
    (!rule.effectiveEndDate || rule.effectiveEndDate >= localStart.date);
  const isWorking = input.context.availabilityRules.some(
    (rule) =>
      rule.ruleType === "working" &&
      matchesRuleScope(rule) &&
      timeToMinutes(rule.startsAtLocal) <= localStart.minutes &&
      timeToMinutes(rule.endsAtLocal) >= localEnd.minutes,
  );

  if (!isWorking) {
    return false;
  }

  const hasBreak = input.context.availabilityRules.some(
    (rule) =>
      rule.ruleType === "break" &&
      matchesRuleScope(rule) &&
      timeToMinutes(rule.startsAtLocal) < localEnd.minutes &&
      timeToMinutes(rule.endsAtLocal) > localStart.minutes,
  );

  if (hasBreak) {
    return false;
  }

  const overlaps = (startsAt: string, endsAt: string) =>
    new Date(startsAt).getTime() < input.endMs &&
    new Date(endsAt).getTime() > input.startMs;
  const hasBlock = input.context.timeBlocks.some(
    (block) =>
      (!block.staffId || block.staffId === input.staffId) &&
      overlaps(block.startsAt, block.endsAt),
  );

  if (hasBlock) {
    return false;
  }

  return !input.context.busyLines.some(
    (line) =>
      line.staffId === input.staffId &&
      line.bookingId !== input.ignoreBookingId &&
      overlaps(line.startsAt, line.endsAt),
  );
}

function assignmentDuration(
  context: RawContext,
  service: PublicBookingService,
  staffId: string,
) {
  const assignment = serviceAssignment(context, service.id, staffId);
  return assignment?.customDurationMinutes ?? service.durationMinutes;
}

function buildSlotPlan(
  context: RawContext,
  request: PublicBookingSlotRequest,
  startMs: number,
  options: SlotBuildOptions = {},
): PublicBookingSlot | null {
  const settings = context.settings;
  const lines = selectionLines(context, request);

  if (!settings || lines.length === 0) {
    return null;
  }

  const requestedMode = request.staffMode ?? "any";
  const mode =
    requestedMode === "any" && !settings.anyProfessionalEnabled
      ? "specific"
      : requestedMode === "split" && !settings.splitStaffAppointmentEnabled
        ? "specific"
        : requestedMode;
  const selectedStaffId = cleanUuid(request.staffId);
  const lineStaffIds = request.lineStaffIds ?? [];
  const visitStaffCandidates =
    mode === "split"
      ? []
      : sharedStaffCandidates({
          context,
          lines,
          mode,
          staffId: selectedStaffId,
        });
  const slotLines: PublicBookingSlotLine[] = [];
  let cursorMs = startMs;

  for (const [index, line] of lines.entries()) {
    let candidates: string[] = [];

    if (mode === "split") {
      const lineStaffId = cleanUuid(lineStaffIds[index]);
      candidates = lineStaffId ? [lineStaffId] : eligibleStaffIds(context, line.service.id);
    } else {
      candidates = visitStaffCandidates;
    }

    const chosen = candidates.find((staffId) => {
      if (!serviceAssignment(context, line.service.id, staffId)) {
        return false;
      }

      const duration = assignmentDuration(context, line.service, staffId);
      const endMs =
        cursorMs + (duration + settings.defaultCleanupBufferMinutes) * 60_000;

      return lineAvailable({
        context,
        endMs,
        ignoreBookingId: options.ignoreBookingId,
        staffId,
        startMs: cursorMs,
      });
    });

    if (!chosen) {
      return null;
    }

    const staff = context.staff.find((candidate) => candidate.id === chosen);
    const duration = assignmentDuration(context, line.service, chosen);
    const endMs =
      cursorMs + (duration + settings.defaultCleanupBufferMinutes) * 60_000;

    slotLines.push({
      cleanupBufferMinutes: settings.defaultCleanupBufferMinutes,
      displayOrder: index,
      durationMinutes: duration,
      endAt: new Date(endMs).toISOString(),
      lineType: line.lineType,
      parentServiceId: line.parentServiceId,
      serviceId: line.service.id,
      serviceName: line.service.name,
      staffId: chosen,
      staffName: staff?.displayName ?? "Professional",
      startAt: new Date(cursorMs).toISOString(),
    });

    cursorMs = endMs;
  }

  const startAt = new Date(startMs).toISOString();
  const endAt = new Date(cursorMs).toISOString();
  const date = formatDateInTimeZone(new Date(startAt), settings.timezoneIana);

  return {
    date,
    endAt,
    label: slotLabel(startAt, settings.timezoneIana),
    lines: slotLines,
    startAt,
  };
}

function candidateStartsForDate(
  context: RawContext,
  request: PublicBookingSlotRequest,
  date: string,
) {
  const settings = context.settings;
  const lines = selectionLines(context, request);

  if (!settings || lines.length === 0) {
    return [];
  }

  const requestedMode = request.staffMode ?? "any";
  const mode =
    requestedMode === "any" && !settings.anyProfessionalEnabled
      ? "specific"
      : requestedMode === "split" && !settings.splitStaffAppointmentEnabled
        ? "specific"
        : requestedMode;
  const selectedStaffId = cleanUuid(request.staffId);
  const firstLineStaffIds =
    mode === "split" && cleanUuid(request.lineStaffIds?.[0])
        ? [cleanUuid(request.lineStaffIds?.[0]) as string]
        : mode === "split"
          ? eligibleStaffIds(context, lines[0].service.id)
          : sharedStaffCandidates({
              context,
              lines,
              mode,
              staffId: selectedStaffId,
            });
  const localDay = dayOfWeek(date);
  const starts = new Set<number>();

  for (const rule of context.availabilityRules) {
    if (
      rule.ruleType !== "working" ||
      rule.dayOfWeek !== localDay ||
      (rule.staffId && !firstLineStaffIds.includes(rule.staffId)) ||
      (rule.effectiveStartDate && rule.effectiveStartDate > date) ||
      (rule.effectiveEndDate && rule.effectiveEndDate < date)
    ) {
      continue;
    }

    const startIso = zonedDateTimeToUtcIso({
      date,
      time: rule.startsAtLocal.slice(0, 5),
      timeZone: settings.timezoneIana,
    });
    const endIso = zonedDateTimeToUtcIso({
      date,
      time: rule.endsAtLocal.slice(0, 5),
      timeZone: settings.timezoneIana,
    });

    if (!startIso || !endIso) {
      continue;
    }

    const endMs = new Date(endIso).getTime();
    let cursorMs = new Date(startIso).getTime();

    while (cursorMs < endMs) {
      starts.add(cursorMs);
      cursorMs += settings.slotIntervalMinutes * 60_000;
    }
  }

  return [...starts].sort((left, right) => left - right);
}

export function generatePublicBookingSlots(
  context: RawContext,
  request: PublicBookingSlotRequest,
  options: SlotBuildOptions = {},
) {
  const settings = context.settings;

  if (!settings) {
    return [];
  }

  const limit = options.limit ?? 60;
  const now = new Date();
  const earliestMs = now.getTime() + settings.minimumLeadTimeMinutes * 60_000;
  const latestMs =
    now.getTime() + settings.maximumAdvanceWindowDays * 24 * 60 * 60_000;
  const today = formatDateInTimeZone(now, settings.timezoneIana);
  const requestedDate = cleanDate(request.date);
  const dates = requestedDate
    ? [requestedDate]
    : Array.from(
        {
          length: Math.min(settings.maximumAdvanceWindowDays + 1, MAX_PUBLIC_SLOT_DAYS),
        },
        (_, index) => formatDateInTimeZone(addDays(now, index), settings.timezoneIana),
      );
  const slots: PublicBookingSlot[] = [];

  for (const date of dates) {
    if (!settings.sameDayBookingEnabled && date <= today) {
      continue;
    }

    for (const startMs of candidateStartsForDate(context, request, date)) {
      if (startMs < earliestMs || startMs > latestMs) {
        continue;
      }

      const slot = buildSlotPlan(context, request, startMs, options);

      if (slot) {
        slots.push(slot);
      }

      if (slots.length >= limit) {
        return slots;
      }
    }
  }

  return slots;
}

function firstBookableServiceId(context: RawContext) {
  return (
    context.services.find(
      (service) =>
        !service.isAddOnOnly && eligibleStaffIds(context, service.id).length > 0,
    )?.id ??
    null
  );
}

function normalizeInitialSelection(
  context: RawContext,
  params: PublicBookingSearchParams,
): PublicBookingInitialSelection {
  const settings = context.settings;
  const source = cleanSource(singleParam(params.source));
  const lookId = cleanUuid(singleParam(params.lookId));
  const look = lookId ? context.looks.find((item) => item.id === lookId) : null;
  const requestedServiceId = cleanUuid(singleParam(params.serviceId));
  const requestedStaffId = cleanUuid(singleParam(params.staffId));
  const serviceId =
    (requestedServiceId &&
    context.serviceMap.has(requestedServiceId) &&
    !context.serviceMap.get(requestedServiceId)?.isAddOnOnly
      ? requestedServiceId
      : null) ??
    (look?.serviceId &&
    context.serviceMap.has(look.serviceId) &&
    !context.serviceMap.get(look.serviceId)?.isAddOnOnly
      ? look.serviceId
      : null) ??
    firstBookableServiceId(context);
  const serviceStaff = serviceId ? eligibleStaffIds(context, serviceId) : [];
  const staffId =
    requestedStaffId && serviceStaff.includes(requestedStaffId)
      ? requestedStaffId
      : look?.recommendedStaffId && serviceStaff.includes(look.recommendedStaffId)
        ? look.recommendedStaffId
        : null;
  const timezone = settings?.timezoneIana ?? "America/Chicago";
  const date = cleanDate(singleParam(params.date)) ?? formatDateInTimeZone(new Date(), timezone);

  return {
    addOnSelections: [],
    addOnServiceIds: [],
    date,
    lookId: look?.id ?? null,
    serviceId,
    serviceIds: serviceId ? [serviceId] : [],
    source,
    staffId,
    staffMode: staffId ? "specific" : settings?.anyProfessionalEnabled === false ? "specific" : "any",
  };
}

export async function getPublicBookingPageData(
  salonIdInput: string,
  params: PublicBookingSearchParams,
): Promise<PublicBookingPageData> {
  const salonId = cleanUuid(salonIdInput);

  if (!salonId) {
    return unavailablePage(
      "not_found",
      "Salon not found",
      "This booking link is not valid.",
    );
  }

  const context = await loadRawContext(salonId);
  const initialSelection = normalizeInitialSelection(context, params);
  const readiness = readinessForContext(context);
  const byService = staffByService(context);
  const base = {
    initialSelection,
    looks: context.looks,
    readiness,
    salon: context.profile,
    services: context.services,
    settings: context.settings,
    staff: context.staff,
    staffByService: byService,
  };

  if (context.state === "not_found") {
    return unavailablePage(
      "not_found",
      "Salon not found",
      "This booking link does not match an active salon.",
      base,
    );
  }

  if (context.state === "not_public") {
    return unavailablePage(
      "not_public",
      "This salon is not public yet",
      "Online booking opens after the salon publishes a public profile.",
      base,
    );
  }

  if (context.state === "booking_disabled") {
    return unavailablePage(
      "booking_disabled",
      "Online booking is not open yet",
      "This salon has not enabled public online booking.",
      base,
    );
  }

  if (!context.settings || readiness.some((item) => !item.complete)) {
    return unavailablePage(
      "incomplete",
      "Online booking is not ready",
      "This salon still needs services, professionals, and availability before public booking can open.",
      base,
    );
  }

  const slots = generatePublicBookingSlots(
    context,
    {
      date: initialSelection.date,
      serviceId: initialSelection.serviceId,
      serviceIds: initialSelection.serviceIds,
      staffId: initialSelection.staffId,
      staffMode: initialSelection.staffMode,
    },
    { limit: 24 },
  );
  const anyFutureSlots =
    slots.length > 0 ||
    generatePublicBookingSlots(
      context,
      {
        serviceId: initialSelection.serviceId,
        serviceIds: initialSelection.serviceIds,
        staffId: initialSelection.staffId,
        staffMode: initialSelection.staffMode,
      },
      { limit: 1 },
    ).length > 0;

  if (!anyFutureSlots) {
    return unavailablePage(
      "no_slots",
      "No online slots are available",
      "The salon is configured for booking, but there are no future public slots right now.",
      base,
    );
  }

  return {
    ...base,
    message: "Choose services, a professional, and a time.",
    slots,
    state: "ready",
    title: `Book ${context.profile?.name ?? "appointment"}`,
  };
}

export async function loadPublicBookingSlots(input: {
  salonId: string;
  selection: PublicBookingSlotRequest;
}) {
  const salonId = cleanUuid(input.salonId);

  if (!salonId) {
    return [];
  }

  const context = await loadRawContext(salonId);

  if (context.state !== "ready") {
    return [];
  }

  return generatePublicBookingSlots(context, input.selection, { limit: 36 });
}

function publicBookingFailure(
  message: string,
  code = "invalid_input",
): PublicBookingActionResult {
  return { code, message, ok: false };
}

export async function createPublicBooking(
  input: PublicBookingCreateInput,
): Promise<PublicBookingActionResult> {
  if ((input.honeypot ?? "").trim()) {
    return publicBookingFailure("Booking could not be submitted.", "invalid_request");
  }

  const salonId = cleanUuid(input.salonId);
  const startAt = toIso(input.startAt);

  if (!salonId || !startAt) {
    return publicBookingFailure("Choose a valid appointment time.");
  }

  const context = await loadRawContext(salonId);

  if (context.state !== "ready" || !context.settings) {
    return publicBookingFailure("Online booking is not available for this salon.", context.state);
  }

  const date = formatDateInTimeZone(new Date(startAt), context.settings.timezoneIana);
  const slot = generatePublicBookingSlots(
    context,
    {
      addOnSelections: input.addOnSelections,
      addOnServiceIds: input.addOnServiceIds,
      date,
      lineStaffIds: input.lineStaffIds,
      serviceId: input.serviceId,
      serviceIds: input.serviceIds,
      staffId: input.staffId,
      staffMode: input.staffMode,
    },
    { limit: 96 },
  ).find((candidate) => candidate.startAt === startAt);

  if (!slot) {
    return publicBookingFailure("That time is no longer available.", "unavailable_slot");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const lookId = cleanUuid(input.lookId);
  const { data, error } = await supabase.rpc("create_public_booking", {
    p_customer_email: input.customerEmail?.trim() || null,
    p_customer_first_name: input.customerFirstName?.trim() || null,
    p_customer_last_name: input.customerLastName?.trim() || null,
    p_customer_phone: input.customerPhone?.trim() || null,
    p_end_at: slot.endAt,
    p_idempotency_key: input.idempotencyKey?.trim() || crypto.randomUUID(),
    p_lines: slot.lines.map((line) => ({
      assigned_staff_id: line.staffId,
      cleanup_buffer_minutes: line.cleanupBufferMinutes,
      display_order: line.displayOrder,
      line_type: line.lineType,
      parent_service_id: line.parentServiceId,
      scheduled_end_at: line.endAt,
      scheduled_start_at: line.startAt,
      service_id: line.serviceId,
    })),
    p_public_notes: input.publicNotes?.trim() || null,
    p_salon_id: salonId,
    p_source: input.source ?? "public_profile",
    p_source_reference_id: lookId,
    p_source_reference_type: lookId ? "salon_profile_look" : null,
    p_start_at: slot.startAt,
  });

  if (error) {
    console.error("Create public booking RPC failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId,
    });
    return publicBookingFailure(error.message, error.code);
  }

  const result = asRecord(data);

  if (!booleanValue(result.ok, false)) {
    return publicBookingFailure("Booking could not be submitted.", "database_error");
  }

  return {
    bookingId: cleanUuid(result.booking_id) ?? undefined,
    code: booleanValue(result.duplicate, false) ? "duplicate" : undefined,
    confirmationStatus: nonEmptyString(result.confirmation_status) ?? undefined,
    manageToken: nonEmptyString(result.manage_token),
    message: booleanValue(result.duplicate, false)
      ? "This booking request was already submitted."
      : "Booking request submitted.",
    ok: true,
    status: nonEmptyString(result.status) ?? undefined,
  };
}

function cleanManageToken(value: string) {
  const token = value.trim();
  return /^[a-f0-9]{64}$/i.test(token) ? token : null;
}

function parseGuestManagePayload(payload: unknown): GuestManagePageData {
  const row = asRecord(payload);

  if (!booleanValue(row.ok, false)) {
    return {
      code: nonEmptyString(row.code) ?? "invalid_token",
      message: "This booking management link is not valid.",
      ok: false,
    };
  }

  const booking = asRecord(row.booking);
  const salon = asRecord(row.salon);
  const customer = asRecord(row.customer);
  const salonId = cleanUuid(booking.salon_id);
  const startAt = toIso(booking.start_at);
  const endAt = toIso(booking.end_at);

  if (!salonId || !startAt || !endAt) {
    return {
      code: "invalid_payload",
      message: "This booking could not be loaded.",
      ok: false,
    };
  }

  const lines: PublicBookingSlotLine[] = asArray(row.lines)
    .map<PublicBookingSlotLine | null>((item, index) => {
      const line = asRecord(item);
      const serviceId = cleanUuid(line.service_id);
      const staffId = cleanUuid(line.staff_id);
      const lineStart = toIso(line.scheduled_start_at);
      const lineEnd = toIso(line.scheduled_end_at);

      if (!serviceId || !staffId || !lineStart || !lineEnd) {
        return null;
      }

      return {
        cleanupBufferMinutes: 0,
        displayOrder: index,
        durationMinutes: Math.max(1, Math.round(numberValue(line.duration_minutes, 30))),
        endAt: lineEnd,
        lineType: line.line_type === "add_on" ? "add_on" : "service",
        parentServiceId: cleanUuid(line.parent_service_id),
        serviceId,
        serviceName: nonEmptyString(line.service_name) ?? "Service",
        staffId,
        staffName: nonEmptyString(line.staff_name) ?? "Professional",
        startAt: lineStart,
      } satisfies PublicBookingSlotLine;
    })
    .filter((item): item is PublicBookingSlotLine => Boolean(item));

  return {
    booking: {
      booking: {
        canChange: booleanValue(booking.can_change, false),
        cancellationReason: nonEmptyString(booking.cancellation_reason),
        cancelledAt: toIso(booking.cancelled_at),
        confirmationStatus: nonEmptyString(booking.confirmation_status),
        endAt,
        id: cleanUuid(booking.id) ?? "",
        publicNotes: nonEmptyString(booking.public_notes),
        salonId,
        source: nonEmptyString(booking.source),
        startAt,
        status: nonEmptyString(booking.status) ?? "pending",
        timezone: nonEmptyString(booking.timezone) ?? "America/Chicago",
      },
      customer: {
        email: nonEmptyString(customer.email),
        name: nonEmptyString(customer.name),
        phone: nonEmptyString(customer.phone),
      },
      lines,
      salon: {
        addressLine1: nonEmptyString(salon.address_line1),
        city: nonEmptyString(salon.city),
        name: nonEmptyString(salon.name) ?? "Salon",
        phone: nonEmptyString(salon.phone),
        state: nonEmptyString(salon.state),
        timezone: nonEmptyString(salon.timezone) ?? "America/Chicago",
      },
    },
    ok: true,
    slots: [],
  };
}

export async function getGuestManageBooking(tokenInput: string): Promise<GuestManagePageData> {
  const token = cleanManageToken(tokenInput);

  if (!token) {
    return {
      code: "invalid_token",
      message: "This booking management link is not valid.",
      ok: false,
    };
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc("get_public_booking_by_manage_token", {
    raw_token: token,
  });

  if (error) {
    console.error("Guest manage booking RPC failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return {
      code: error.code,
      message: "This booking could not be loaded.",
      ok: false,
    };
  }

  return parseGuestManagePayload(data);
}

function selectionFromGuestBooking(booking: GuestManageBooking, date?: string | null) {
  const primaries = booking.lines.filter((line) => line.lineType === "service");
  const primary = primaries[0] ?? booking.lines[0];
  const serviceIds =
    primaries.length > 0
      ? primaries.map((line) => line.serviceId)
      : primary
        ? [primary.serviceId]
        : [];
  const addOnSelections = booking.lines
    .filter((line) => line.lineType === "add_on" && line.parentServiceId)
    .map((line) => ({
      parentServiceId: line.parentServiceId as string,
      serviceId: line.serviceId,
    }));

  return {
    addOnSelections,
    addOnServiceIds:
      serviceIds.length === 1
        ? booking.lines
            .filter((line) => line.lineType === "add_on")
            .map((line) => line.serviceId)
        : [],
    date: cleanDate(date) ?? formatDateInTimeZone(
      new Date(booking.booking.startAt),
      booking.booking.timezone,
    ),
    lineStaffIds: booking.lines.map((line) => line.staffId),
    serviceId: primary?.serviceId ?? null,
    serviceIds,
    staffId: primary?.staffId ?? null,
    staffMode: "split" as const,
  };
}

export async function getGuestManagePageData(
  tokenInput: string,
): Promise<GuestManagePageData> {
  const loaded = await getGuestManageBooking(tokenInput);

  if (!loaded.ok) {
    return loaded;
  }

  const context = await loadRawContext(loaded.booking.booking.salonId);
  const slots = generatePublicBookingSlots(
    context,
    selectionFromGuestBooking(loaded.booking),
    {
      ignoreBookingId: loaded.booking.booking.id,
      limit: 24,
    },
  );

  return {
    ...loaded,
    slots,
  };
}

export async function loadGuestManageSlots(input: {
  date?: string | null;
  token: string;
}) {
  const loaded = await getGuestManageBooking(input.token);

  if (!loaded.ok) {
    return [];
  }

  const context = await loadRawContext(loaded.booking.booking.salonId);

  return generatePublicBookingSlots(
    context,
    selectionFromGuestBooking(loaded.booking, input.date),
    {
      ignoreBookingId: loaded.booking.booking.id,
      limit: 36,
    },
  );
}

export async function rescheduleGuestBooking(input: {
  startAt?: string | null;
  token: string;
}): Promise<PublicBookingActionResult> {
  const startAt = toIso(input.startAt);

  if (!startAt) {
    return publicBookingFailure("Choose a valid appointment time.");
  }

  const loaded = await getGuestManageBooking(input.token);

  if (!loaded.ok) {
    return publicBookingFailure(loaded.message, loaded.code);
  }

  const context = await loadRawContext(loaded.booking.booking.salonId);
  const date = formatDateInTimeZone(new Date(startAt), loaded.booking.booking.timezone);
  const slot = generatePublicBookingSlots(
    context,
    selectionFromGuestBooking(loaded.booking, date),
    {
      ignoreBookingId: loaded.booking.booking.id,
      limit: 96,
    },
  ).find((candidate) => candidate.startAt === startAt);

  if (!slot) {
    return publicBookingFailure("That time is no longer available.", "unavailable_slot");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc("reschedule_public_booking_by_manage_token", {
    p_start_at: startAt,
    raw_token: input.token,
  });

  if (error) {
    return publicBookingFailure(error.message, error.code);
  }

  const result = asRecord(data);

  if (!booleanValue(result.ok, false)) {
    return publicBookingFailure("Booking could not be rescheduled.", nonEmptyString(result.code) ?? "failed");
  }

  return {
    bookingId: cleanUuid(result.booking_id) ?? undefined,
    message: "Booking rescheduled.",
    ok: true,
  };
}

export async function cancelGuestBooking(input: {
  reason?: string | null;
  token: string;
}): Promise<PublicBookingActionResult> {
  const token = cleanManageToken(input.token);

  if (!token) {
    return publicBookingFailure("This booking management link is not valid.", "invalid_token");
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc("cancel_public_booking_by_manage_token", {
    p_reason: input.reason?.trim() || "Guest cancellation",
    raw_token: token,
  });

  if (error) {
    return publicBookingFailure(error.message, error.code);
  }

  const result = asRecord(data);

  if (!booleanValue(result.ok, false)) {
    return publicBookingFailure("Booking could not be cancelled.", nonEmptyString(result.code) ?? "failed");
  }

  return {
    bookingId: cleanUuid(result.booking_id) ?? undefined,
    message: "Booking cancelled.",
    ok: true,
  };
}
