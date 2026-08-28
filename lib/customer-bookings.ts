import "server-only";

import {
  BOOKING_LINE_SELECT,
  BOOKING_SELECT,
  formatDateInTimeZone,
} from "@/lib/bookings";
import {
  BOOKING_INSPIRATION_SELECT,
  mapBookingInspirationsByBookingId,
} from "@/lib/booking-inspirations";
import {
  normalizeBookingEmail,
  normalizeBookingPhone,
} from "@/lib/booking-domain/customer-identity";
import {
  loadPublicBookingRescheduleSlots,
  type PublicBookingAddOnSelection,
  type PublicBookingSlot,
  type PublicBookingSlotRequest,
} from "@/lib/public-booking";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { getStaffProfileAvatarUrl } from "@/lib/staff-profile";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type {
  Booking,
  BookingInspiration,
  BookingInspirationView,
  BookingLine,
  BookingStatusEvent,
} from "@/types/booking";
import type { Customer } from "@/types/customer";

const GENERIC_DISCOVERY_MESSAGE =
  "If matching bookings can be verified, we will send secure access instructions.";
const CUSTOMER_BOOKING_SALON_SELECT =
  "id, name, phone, address_line1, address_line2, city, state, postal_code, country, latitude, longitude";
const SALON_SETTING_SELECT =
  "salon_id, business_name, phone, email, website, address_line1, address_line2, city, state, postal_code, country, public_discovery_enabled, public_profile_logo_path, public_profile_cover_path";
const CUSTOMER_BOOKING_STAFF_SELECT =
  "id, display_name, job_title, public_profile_photo_path, is_active, online_booking_enabled, public_profile_visible";
const CUSTOMER_BOOKING_SERVICE_SELECT = "id, is_active, online_booking_enabled";

type CustomerBookingResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      code: string;
      message: string;
      ok: false;
    };

type CustomerBookingContext = {
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  userId: string;
};

type CustomerBookingRawSalon = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  id: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  phone: string | null;
  postal_code: string | null;
  state: string | null;
};

type CustomerBookingRaw = Booking & {
  customer: Pick<Customer, "email" | "id" | "name" | "phone"> | null;
  events?: BookingStatusEvent[];
  lines?: BookingLine[];
  salon: CustomerBookingRawSalon | null;
};

type SalonSettingRow = {
  address_line1: string | null;
  address_line2: string | null;
  business_name: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  postal_code: string | null;
  public_discovery_enabled: boolean | null;
  public_profile_cover_path: string | null;
  public_profile_logo_path: string | null;
  salon_id: string;
  state: string | null;
  website: string | null;
};

type StaffRow = {
  display_name: string;
  id: string;
  is_active: boolean;
  job_title: string | null;
  online_booking_enabled: boolean;
  public_profile_photo_path: string | null;
  public_profile_visible: boolean;
};

type ServiceRow = {
  id: string;
  is_active: boolean;
  online_booking_enabled: boolean;
};

type PublicSalonProfileRow = {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  country: string | null;
  cover_path: string | null;
  email: string | null;
  logo_path: string | null;
  phone: string | null;
  postal_code: string | null;
  salon_id: string;
  salon_name: string | null;
  state: string | null;
  website: string | null;
};

type PublicSalonStaffRow = {
  account_avatar_url: string | null;
  avatar_path: string | null;
  display_name: string | null;
  id: string;
  job_title: string | null;
  online_booking_enabled: boolean | null;
};

export type CustomerBookingListScope = "cancelled" | "past" | "upcoming";

export type CustomerBookingStaff = {
  avatarUrl: string | null;
  displayName: string;
  id: string;
  isActive: boolean;
  jobTitle: string | null;
  onlineBookingEnabled: boolean;
  publicProfileVisible: boolean;
};

export type CustomerBookingLine = BookingLine & {
  assignedStaff: CustomerBookingStaff | null;
  currentServiceBookable: boolean;
};

export type CustomerBookingSalon = CustomerBookingRawSalon & {
  coverUrl: string | null;
  displayName: string;
  email: string | null;
  logoUrl: string | null;
  publicDiscoveryEnabled: boolean;
  website: string | null;
};

export type CustomerBookingSummary = Booking & {
  customer: Pick<Customer, "email" | "id" | "name" | "phone"> | null;
  inspiration: BookingInspirationView | null;
  lines?: CustomerBookingLine[];
  salon: CustomerBookingSalon | null;
};

export type CustomerBookingDetail = CustomerBookingSummary & {
  events?: BookingStatusEvent[];
};

export type CustomerBookingMutationResult = {
  bookingId?: string;
  code?: string;
  idempotent?: boolean;
  message: string;
  ok: boolean;
};

export type CustomerRescheduleSlotsResult =
  | {
      data: {
        date: string;
        slots: PublicBookingSlot[];
      };
      ok: true;
    }
  | {
      code: string;
      message: string;
      ok: false;
    };

function genericFailure(message: string, code = "failed"): CustomerBookingMutationResult {
  return { code, message, ok: false };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    trimmed,
  )
    ? trimmed
    : null;
}

function cleanDate(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function cleanManageToken(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return /^[a-f0-9]{64}$/i.test(trimmed) ? trimmed : null;
}

function firstText(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = value?.trim();

    if (text) {
      return text;
    }
  }

  return null;
}

function isChangeable(status: string, startAt: string) {
  if (["cancelled", "completed", "no_show"].includes(status)) {
    return false;
  }

  return new Date(startAt).getTime() > Date.now();
}

async function requireCustomerBookingContext(): Promise<
  CustomerBookingResult<CustomerBookingContext>
> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return {
      code: "sign_in_required",
      message: "Sign in to manage your bookings.",
      ok: false,
    };
  }

  const user = await getCurrentKingUser();

  if (!user) {
    return {
      code: "sign_in_required",
      message: "Sign in to manage your bookings.",
      ok: false,
    };
  }

  return {
    data: {
      supabase,
      userId: user.id,
    },
    ok: true,
  };
}

function mutationResultFromRpc(
  data: unknown,
  fallbackMessage: string,
): CustomerBookingMutationResult {
  const result = asRecord(data);

  if (!readBoolean(result.ok)) {
    return genericFailure(
      readString(result.message) ?? fallbackMessage,
      readString(result.code) ?? "failed",
    );
  }

  return {
    bookingId: cleanUuid(readString(result.booking_id)) ?? undefined,
    idempotent: readBoolean(result.idempotent),
    message: readBoolean(result.idempotent)
      ? "This booking is already saved to your account."
      : "Booking saved to your account.",
    ok: true,
  };
}

function sortLines(lines: BookingLine[] | undefined) {
  return (lines ?? []).slice().sort((left, right) => {
    const order = left.display_order - right.display_order;
    return order || left.created_at.localeCompare(right.created_at);
  });
}

async function loadSalonSettings(
  context: CustomerBookingContext,
  salonIds: string[],
) {
  const uniqueSalonIds = [...new Set(salonIds.filter(Boolean))];

  if (uniqueSalonIds.length === 0) {
    return new Map<string, SalonSettingRow>();
  }

  const { data, error } = await context.supabase
    .from("salon_settings")
    .select(SALON_SETTING_SELECT)
    .in("salon_id", uniqueSalonIds)
    .returns<SalonSettingRow[]>();

  if (error) {
    return new Map<string, SalonSettingRow>();
  }

  return new Map((data ?? []).map((setting) => [setting.salon_id, setting]));
}

async function loadPublicSalonProfiles(salonIds: string[]) {
  const uniqueSalonIds = [...new Set(salonIds.map(cleanUuid).filter(Boolean))] as string[];
  const supabase = createSupabaseServerClient();
  const profiles = new Map<string, PublicSalonProfileRow>();

  if (!supabase || uniqueSalonIds.length === 0) {
    return profiles;
  }

  await Promise.all(
    uniqueSalonIds.map(async (salonId) => {
      const { data, error } = await supabase
        .rpc("get_public_salon_profile", { target_salon_id: salonId });
      const rows = Array.isArray(data) ? (data as PublicSalonProfileRow[]) : [];

      if (!error && rows[0]) {
        profiles.set(salonId, rows[0]);
      }
    }),
  );

  return profiles;
}

async function loadStaffRows(context: CustomerBookingContext, lines: BookingLine[]) {
  const staffIds = [
    ...new Set(lines.map((line) => line.assigned_staff_id).filter(Boolean)),
  ] as string[];

  if (staffIds.length === 0) {
    return new Map<string, CustomerBookingStaff>();
  }

  const { data, error } = await context.supabase
    .from("staff")
    .select(CUSTOMER_BOOKING_STAFF_SELECT)
    .in("id", staffIds)
    .returns<StaffRow[]>();

  if (error) {
    return new Map<string, CustomerBookingStaff>();
  }

  return new Map(
    (data ?? []).map((staff) => [
      staff.id,
      {
        avatarUrl: getStaffProfileAvatarUrl({
          staffProfilePhotoPath: staff.public_profile_photo_path,
        }),
        displayName: staff.display_name,
        id: staff.id,
        isActive: staff.is_active,
        jobTitle: staff.job_title,
        onlineBookingEnabled: staff.online_booking_enabled,
        publicProfileVisible: staff.public_profile_visible,
      },
    ]),
  );
}

async function loadPublicStaffRows(salonIds: string[]) {
  const uniqueSalonIds = [...new Set(salonIds.map(cleanUuid).filter(Boolean))] as string[];
  const supabase = createSupabaseServerClient();
  const staffById = new Map<string, CustomerBookingStaff>();

  if (!supabase || uniqueSalonIds.length === 0) {
    return staffById;
  }

  await Promise.all(
    uniqueSalonIds.map(async (salonId) => {
      const { data, error } = await supabase
        .rpc("get_public_salon_profile_staff", { target_salon_id: salonId });
      const rows = Array.isArray(data) ? (data as PublicSalonStaffRow[]) : [];

      if (error) {
        return;
      }

      for (const staff of rows) {
        if (!staff.id || staffById.has(staff.id)) {
          continue;
        }

        staffById.set(staff.id, {
          avatarUrl: getStaffProfileAvatarUrl({
            accountAvatarUrl: staff.account_avatar_url,
            staffProfilePhotoPath: staff.avatar_path,
          }),
          displayName: firstText(staff.display_name) ?? "Salon professional",
          id: staff.id,
          isActive: true,
          jobTitle: firstText(staff.job_title),
          onlineBookingEnabled: staff.online_booking_enabled === true,
          publicProfileVisible: true,
        });
      }
    }),
  );

  return staffById;
}

async function loadServiceBookableRows(
  context: CustomerBookingContext,
  lines: BookingLine[],
) {
  const serviceIds = [
    ...new Set(lines.map((line) => line.service_id).filter(Boolean)),
  ] as string[];

  if (serviceIds.length === 0) {
    return new Map<string, boolean>();
  }

  const { data, error } = await context.supabase
    .from("services")
    .select(CUSTOMER_BOOKING_SERVICE_SELECT)
    .in("id", serviceIds)
    .returns<ServiceRow[]>();

  if (error) {
    return new Map<string, boolean>();
  }

  return new Map(
    (data ?? []).map((service) => [
      service.id,
      service.is_active && service.online_booking_enabled,
    ]),
  );
}

async function loadBookingInspirations(
  context: CustomerBookingContext,
  bookingIds: string[],
) {
  const uniqueBookingIds = [...new Set(bookingIds.map(cleanUuid).filter(Boolean))] as string[];

  if (uniqueBookingIds.length === 0) {
    return new Map<string, BookingInspirationView>();
  }

  const { data, error } = await context.supabase
    .from("booking_inspirations")
    .select(BOOKING_INSPIRATION_SELECT)
    .in("booking_id", uniqueBookingIds)
    .returns<BookingInspiration[]>();

  if (error) {
    return new Map<string, BookingInspirationView>();
  }

  return mapBookingInspirationsByBookingId(data);
}

function hydrateSalon(
  salon: CustomerBookingRawSalon | null,
  setting: SalonSettingRow | undefined,
  profile: PublicSalonProfileRow | undefined,
): CustomerBookingSalon | null {
  const salonId = salon?.id ?? profile?.salon_id ?? null;

  if (!salonId) {
    return null;
  }

  return {
    address_line1: firstText(setting?.address_line1, profile?.address_line1, salon?.address_line1),
    address_line2: firstText(setting?.address_line2, profile?.address_line2, salon?.address_line2),
    city: firstText(setting?.city, profile?.city, salon?.city),
    country: firstText(setting?.country, profile?.country, salon?.country),
    coverUrl: getSalonProfileMediaUrl(
      firstText(setting?.public_profile_cover_path, profile?.cover_path),
    ),
    displayName:
      firstText(setting?.business_name, profile?.salon_name, salon?.name) ??
      "Reylumi salon",
    email: firstText(setting?.email, profile?.email),
    id: salonId,
    latitude: salon?.latitude ?? null,
    logoUrl: getSalonProfileMediaUrl(
      firstText(setting?.public_profile_logo_path, profile?.logo_path),
    ),
    longitude: salon?.longitude ?? null,
    name: firstText(salon?.name, profile?.salon_name, setting?.business_name) ?? "Reylumi salon",
    phone: firstText(setting?.phone, profile?.phone, salon?.phone),
    postal_code: firstText(setting?.postal_code, profile?.postal_code, salon?.postal_code),
    publicDiscoveryEnabled: setting?.public_discovery_enabled === true || Boolean(profile),
    state: firstText(setting?.state, profile?.state, salon?.state),
    website: firstText(setting?.website, profile?.website),
  };
}

async function hydrateRows<T extends CustomerBookingRaw>(
  context: CustomerBookingContext,
  rows: T[],
) {
  const allLines = rows.flatMap((row) => row.lines ?? []);
  const [
    settingsBySalonId,
    profilesBySalonId,
    staffById,
    publicStaffById,
    serviceBookableById,
    inspirationsByBookingId,
  ] =
    await Promise.all([
    loadSalonSettings(
      context,
      rows.map((row) => row.salon_id),
    ),
    loadPublicSalonProfiles(rows.map((row) => row.salon_id)),
    loadStaffRows(context, allLines),
    loadPublicStaffRows(rows.map((row) => row.salon_id)),
    loadServiceBookableRows(context, allLines),
    loadBookingInspirations(
      context,
      rows.map((row) => row.id),
    ),
  ]);

  return rows.map((row) => {
    const lines = sortLines(row.lines).map<CustomerBookingLine>((line) => ({
      ...line,
      assignedStaff: line.assigned_staff_id
        ? staffById.get(line.assigned_staff_id) ??
          publicStaffById.get(line.assigned_staff_id) ??
          null
        : null,
      currentServiceBookable: line.service_id
        ? serviceBookableById.get(line.service_id) === true
        : false,
    }));

    return {
      ...row,
      inspiration: inspirationsByBookingId.get(row.id) ?? null,
      lines,
      salon: hydrateSalon(
        row.salon,
        settingsBySalonId.get(row.salon_id),
        profilesBySalonId.get(row.salon_id),
      ),
    };
  });
}

async function loadRawCustomerBookingDetail(
  context: CustomerBookingContext,
  bookingId: string,
) {
  const { data, error } = await context.supabase
    .from("bookings")
    .select(
      `${BOOKING_SELECT}, customer:customers(id, name, phone, email), salon:locations(${CUSTOMER_BOOKING_SALON_SELECT}), lines:booking_lines(${BOOKING_LINE_SELECT})`,
    )
    .eq("id", bookingId)
    .eq("customer_user_id", context.userId)
    .maybeSingle<CustomerBookingRaw>();

  if (error) {
    return { code: error.code, message: "Unable to load booking.", ok: false as const };
  }

  return { data: data ?? null, ok: true as const };
}

function buildRescheduleSelection(
  booking: CustomerBookingDetail,
  date: string,
): CustomerBookingResult<PublicBookingSlotRequest> {
  const lines = sortLines(booking.lines);
  const supportedLines = lines.filter(
    (line) => line.line_type === "service" || line.line_type === "add_on",
  );

  if (supportedLines.length !== lines.length) {
    return {
      code: "unsupported_booking_lines",
      message: "Online rescheduling is not available for this booking. Contact the salon to make a change.",
      ok: false,
    };
  }

  const serviceLines = supportedLines.filter((line) => line.line_type === "service");
  const addOnLines = supportedLines.filter((line) => line.line_type === "add_on");

  if (
    serviceLines.length === 0 ||
    supportedLines.some((line) => !line.service_id || !line.assigned_staff_id)
  ) {
    return {
      code: "unsupported_booking_assignment",
      message: "Online rescheduling is not available for this booking. Contact the salon to make a change.",
      ok: false,
    };
  }

  const addOnSelections: PublicBookingAddOnSelection[] = [];
  const lineStaffIds: string[] = [];
  const usedAddOns = new Set<string>();

  for (const serviceLine of serviceLines) {
    if (!serviceLine.service_id || !serviceLine.assigned_staff_id) {
      continue;
    }

    lineStaffIds.push(serviceLine.assigned_staff_id);

    for (const addOnLine of addOnLines) {
      const belongsToService =
        addOnLine.parent_booking_line_id === serviceLine.id ||
        (serviceLines.length === 1 && !addOnLine.parent_booking_line_id);

      if (
        !belongsToService ||
        !addOnLine.service_id ||
        !addOnLine.assigned_staff_id
      ) {
        continue;
      }

      addOnSelections.push({
        parentServiceId: serviceLine.service_id,
        serviceId: addOnLine.service_id,
      });
      lineStaffIds.push(addOnLine.assigned_staff_id);
      usedAddOns.add(addOnLine.id);
    }
  }

  if (usedAddOns.size !== addOnLines.length) {
    return {
      code: "unsupported_add_on_mapping",
      message: "Online rescheduling is not available for this booking. Contact the salon to make a change.",
      ok: false,
    };
  }

  const serviceIds = serviceLines
    .map((line) => line.service_id)
    .filter((serviceId): serviceId is string => Boolean(serviceId));

  return {
    data: {
      addOnSelections,
      date,
      lineStaffIds,
      serviceId: serviceIds[0] ?? null,
      serviceIds,
      staffId: lineStaffIds[0] ?? null,
      staffMode: "split",
    },
    ok: true,
  };
}

export async function listCustomerBookings(input?: {
  cursorStartAt?: string | null;
  limit?: number;
  scope?: CustomerBookingListScope;
}): Promise<CustomerBookingResult<CustomerBookingSummary[]>> {
  const context = await requireCustomerBookingContext();

  if (!context.ok) {
    return context;
  }

  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 50);
  const scope = input?.scope ?? "upcoming";
  const now = new Date().toISOString();
  let query = context.data.supabase
    .from("bookings")
    .select(
      `${BOOKING_SELECT}, customer:customers(id, name, phone, email), salon:locations(${CUSTOMER_BOOKING_SALON_SELECT}), lines:booking_lines(${BOOKING_LINE_SELECT})`,
    )
    .eq("customer_user_id", context.data.userId)
    .limit(limit);

  if (scope === "cancelled") {
    query = query
      .eq("status", "cancelled")
      .order("start_at", { ascending: false })
      .order("id", { ascending: false });
  } else if (scope === "upcoming") {
    query = query
      .gte("start_at", input?.cursorStartAt ?? now)
      .not("status", "in", "(cancelled,no_show,completed)")
      .order("start_at", { ascending: true })
      .order("id", { ascending: true });
  } else {
    query = query
      .lt("start_at", input?.cursorStartAt ?? now)
      .not("status", "eq", "cancelled")
      .order("start_at", { ascending: false })
      .order("id", { ascending: false });
  }

  const { data, error } = await query.returns<CustomerBookingRaw[]>();

  if (error) {
    return { code: error.code, message: "Unable to load bookings.", ok: false };
  }

  return { data: await hydrateRows(context.data, data ?? []), ok: true };
}

export async function getCustomerBookingDetail(
  bookingId: string,
): Promise<CustomerBookingResult<CustomerBookingDetail | null>> {
  const id = cleanUuid(bookingId);

  if (!id) {
    return { code: "not_found", message: "Booking was not found.", ok: false };
  }

  const context = await requireCustomerBookingContext();

  if (!context.ok) {
    return context;
  }

  const result = await loadRawCustomerBookingDetail(context.data, id);

  if (!result.ok) {
    return result;
  }

  if (!result.data) {
    return { data: null, ok: true };
  }

  const [booking] = await hydrateRows(context.data, [result.data]);
  return { data: booking, ok: true };
}

export async function loadCustomerRescheduleSlots(input: {
  bookingId?: string | null;
  date?: string | null;
}): Promise<CustomerRescheduleSlotsResult> {
  const bookingId = cleanUuid(input.bookingId);
  const requestedDate = cleanDate(input.date);

  if (!bookingId) {
    return { code: "not_found", message: "Booking was not found.", ok: false };
  }

  const context = await requireCustomerBookingContext();

  if (!context.ok) {
    return { code: context.code, message: context.message, ok: false };
  }

  const result = await loadRawCustomerBookingDetail(context.data, bookingId);

  if (!result.ok) {
    return result;
  }

  if (!result.data) {
    return { code: "not_found", message: "Booking was not found.", ok: false };
  }

  const [booking] = await hydrateRows(context.data, [result.data]);

  if (!isChangeable(booking.status, booking.start_at)) {
    return {
      code: "not_changeable",
      message: "This booking can no longer be rescheduled online.",
      ok: false,
    };
  }

  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const date =
    requestedDate ?? formatDateInTimeZone(new Date(booking.start_at), timezone);
  const selection = buildRescheduleSelection(booking, date);

  if (!selection.ok) {
    return selection;
  }

  const slots = await loadPublicBookingRescheduleSlots({
    bookingId,
    salonId: booking.salon_id,
    selection: selection.data,
  });

  return {
    data: {
      date,
      slots,
    },
    ok: true,
  };
}

export async function claimGuestBooking(input: {
  token?: string | null;
}): Promise<CustomerBookingMutationResult> {
  const token = cleanManageToken(input.token);

  if (!token) {
    return genericFailure("This booking cannot be saved to this account.", "invalid_token");
  }

  const context = await requireCustomerBookingContext();

  if (!context.ok) {
    return genericFailure(context.message, context.code);
  }

  const { data, error } = await context.data.supabase.rpc(
    "claim_guest_booking_by_manage_token",
    { raw_token: token },
  );

  if (error) {
    return genericFailure("This booking cannot be saved to this account.", error.code);
  }

  return mutationResultFromRpc(
    data,
    "This booking cannot be saved to this account.",
  );
}

export async function requestCancelCustomerBooking(input: {
  bookingId?: string | null;
  reason?: string | null;
}): Promise<CustomerBookingMutationResult> {
  const bookingId = cleanUuid(input.bookingId);

  if (!bookingId) {
    return genericFailure("Booking was not found.", "not_found");
  }

  const context = await requireCustomerBookingContext();

  if (!context.ok) {
    return genericFailure(context.message, context.code);
  }

  const { data, error } = await context.data.supabase.rpc(
    "cancel_customer_booking",
    {
      p_booking_id: bookingId,
      p_reason: input.reason?.trim() || "Customer cancellation",
    },
  );

  if (error) {
    return genericFailure("Booking could not be cancelled.", error.code);
  }

  const result = asRecord(data);

  if (!readBoolean(result.ok)) {
    return genericFailure(
      "Booking could not be cancelled.",
      readString(result.code) ?? "failed",
    );
  }

  return {
    bookingId,
    message: "Booking cancelled.",
    ok: true,
  };
}

export async function requestRescheduleCustomerBooking(input: {
  bookingId?: string | null;
  startAt?: string | null;
}): Promise<CustomerBookingMutationResult> {
  const bookingId = cleanUuid(input.bookingId);
  const startAt = readString(input.startAt);

  if (!bookingId || !startAt) {
    return genericFailure("Choose a valid appointment time.", "invalid_time");
  }

  const context = await requireCustomerBookingContext();

  if (!context.ok) {
    return genericFailure(context.message, context.code);
  }

  const detailResult = await loadRawCustomerBookingDetail(context.data, bookingId);

  if (!detailResult.ok) {
    return genericFailure(detailResult.message, detailResult.code);
  }

  if (!detailResult.data) {
    return genericFailure("Booking was not found.", "not_found");
  }

  const [booking] = await hydrateRows(context.data, [detailResult.data]);

  if (!isChangeable(booking.status, booking.start_at)) {
    return genericFailure(
      "This booking can no longer be rescheduled online.",
      "not_changeable",
    );
  }

  const parsedStart = new Date(startAt);

  if (Number.isNaN(parsedStart.getTime())) {
    return genericFailure("Choose a valid appointment time.", "invalid_time");
  }

  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const selection = buildRescheduleSelection(
    booking,
    formatDateInTimeZone(parsedStart, timezone),
  );

  if (!selection.ok) {
    return genericFailure(selection.message, selection.code);
  }

  const slots = await loadPublicBookingRescheduleSlots({
    bookingId,
    salonId: booking.salon_id,
    selection: selection.data,
  });
  const slot = slots.find((candidate) => candidate.startAt === parsedStart.toISOString());

  if (!slot) {
    return genericFailure("That time is no longer available.", "unavailable_slot");
  }

  const { data, error } = await context.data.supabase.rpc(
    "reschedule_customer_booking",
    {
      p_booking_id: bookingId,
      p_start_at: slot.startAt,
    },
  );

  if (error) {
    return genericFailure("Booking could not be rescheduled.", error.code);
  }

  const result = asRecord(data);

  if (!readBoolean(result.ok)) {
    return genericFailure(
      "Booking could not be rescheduled.",
      readString(result.code) ?? "failed",
    );
  }

  return {
    bookingId,
    message: "Booking rescheduled.",
    ok: true,
  };
}

export async function requestBookingDiscoveryVerification(input: {
  contact?: string | null;
  channel?: "email" | "phone";
}) {
  if (input.channel === "phone") {
    normalizeBookingPhone(input.contact);
  } else {
    normalizeBookingEmail(input.contact);
  }

  return {
    code: "verification_delivery_not_configured",
    message: GENERIC_DISCOVERY_MESSAGE,
    ok: false as const,
  };
}

export async function verifyBookingDiscoveryOtp(input: {
  code?: string | null;
  verificationId?: string | null;
}) {
  void input;

  return {
    code: "verification_delivery_not_configured",
    message: GENERIC_DISCOVERY_MESSAGE,
    ok: false as const,
  };
}
