import "server-only";

import {
  addLocalDays,
  DATE_PATTERN,
  defaultSalonOperatingStatus,
  getZonedLocalParts,
  localTimeText,
  normalizeOperatingTimeZone,
  parseLocalTimeToMinutes,
  resolveSalonOperatingStatus,
} from "@/lib/salon-operating-status-core";
import { SALON_SETTING_PERMISSIONS } from "@/lib/salon-settings";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { requirePermission } from "@/lib/permissions";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import type {
  CreateSalonSpecialHoursInput,
  SalonOperatingHoursSettings,
  SalonOperatingHoursWindow,
  SalonOperatingStatus,
  SalonSpecialHours,
  UpdateSalonOperatingHoursInput,
} from "@/types/salon-operating-status";

const OPERATING_HOURS_SELECT =
  "id, day_of_week, opens_at_local, closes_at_local, sort_order";
const SPECIAL_HOURS_SELECT =
  "id, local_date, status, opens_at_local, closes_at_local, reason";

let publicStatusRpcWarningLogged = false;

type OperatingHoursRow = {
  closes_at_local: string;
  day_of_week: number;
  id: string;
  opens_at_local: string;
  sort_order: number;
};

type SpecialHoursRow = {
  closes_at_local: string | null;
  id: string;
  local_date: string;
  opens_at_local: string | null;
  reason: string | null;
  status: "closed" | "custom_hours";
};

type PublicStatusInputRow = {
  lifecycle_status: string | null;
  salon_id: string;
  special_hours: unknown;
  timezone_iana: string | null;
  weekly_hours: unknown;
};

type RpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
};

type RpcRunner = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError | null }>;

function requireCurrentSalonContext(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open Business settings from a Business workspace.");
  }

  if (!context.user || !context.currentSalon || !context.currentAccount) {
    throw new Error("Choose a salon workspace before managing salon settings.");
  }

  return {
    account: context.currentAccount,
    salon: context.currentSalon,
    user: context.user,
  };
}

function normalizeDbTime(value: string | null | undefined) {
  const minutes = parseLocalTimeToMinutes(value);

  return minutes === null ? null : localTimeText(minutes);
}

function mapOperatingHoursRow(row: OperatingHoursRow): SalonOperatingHoursWindow {
  return {
    closesAtLocal: normalizeDbTime(row.closes_at_local) ?? "17:00",
    dayOfWeek: row.day_of_week,
    id: row.id,
    opensAtLocal: normalizeDbTime(row.opens_at_local) ?? "09:00",
    sortOrder: row.sort_order,
  };
}

function mapSpecialHoursRow(row: SpecialHoursRow): SalonSpecialHours {
  return {
    closesAtLocal: normalizeDbTime(row.closes_at_local),
    id: row.id,
    localDate: row.local_date,
    opensAtLocal: normalizeDbTime(row.opens_at_local),
    reason: row.reason?.trim() || null,
    status: row.status,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function mapPublicWeeklyHours(value: unknown): SalonOperatingHoursWindow[] {
  return asArray(value)
    .map((item): SalonOperatingHoursWindow | null => {
      const record = asRecord(item);

      if (!record) {
        return null;
      }

      const dayOfWeek = Number(record.dayOfWeek);
      const opensAtLocal =
        typeof record.opensAt === "string" ? normalizeDbTime(record.opensAt) : null;
      const closesAtLocal =
        typeof record.closesAt === "string" ? normalizeDbTime(record.closesAt) : null;

      return opensAtLocal && closesAtLocal
        ? {
            closesAtLocal,
            dayOfWeek,
            id: typeof record.id === "string" ? record.id : undefined,
            opensAtLocal,
            sortOrder: Number(record.sortOrder) || 0,
          }
        : null;
    })
    .filter((item): item is SalonOperatingHoursWindow => Boolean(item));
}

function mapPublicSpecialHours(value: unknown): SalonSpecialHours[] {
  return asArray(value)
    .map((item) => {
      const record = asRecord(item);

      if (!record) {
        return null;
      }

      const status = record.status === "custom_hours" ? "custom_hours" : "closed";
      const localDate =
        typeof record.localDate === "string" && DATE_PATTERN.test(record.localDate)
          ? record.localDate
          : null;

      if (!localDate) {
        return null;
      }

      return {
        closesAtLocal:
          status === "custom_hours" && typeof record.closesAt === "string"
            ? normalizeDbTime(record.closesAt)
            : null,
        id: typeof record.id === "string" ? record.id : `${localDate}:${status}`,
        localDate,
        opensAtLocal:
          status === "custom_hours" && typeof record.opensAt === "string"
            ? normalizeDbTime(record.opensAt)
            : null,
        reason: typeof record.reason === "string" ? record.reason.trim() || null : null,
        status,
      };
    })
    .filter((item): item is SalonSpecialHours => Boolean(item));
}

function isUuid(value: string) {
  if (value.length !== 36) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isHyphenPosition =
      index === 8 || index === 13 || index === 18 || index === 23;

    if (isHyphenPosition) {
      if (code !== 45) {
        return false;
      }

      continue;
    }

    const isDigit = code >= 48 && code <= 57;
    const isLowerHex = code >= 97 && code <= 102;
    const isUpperHex = code >= 65 && code <= 70;

    if (!isDigit && !isLowerHex && !isUpperHex) {
      return false;
    }
  }

  return true;
}

export function normalizeSalonOperatingStatusSalonIds(salonIds: string[]) {
  return Array.from(
    new Set(
      salonIds
        .map((salonId) => salonId.trim())
        .filter(isUuid)
        .map((salonId) => salonId.toLowerCase()),
    ),
  ).slice(0, 50);
}

function normalizeWeeklyHoursInput(
  weeklyHours: SalonOperatingHoursWindow[],
): SalonOperatingHoursWindow[] {
  const normalized = weeklyHours
    .map((window, index) => {
      const opensAtMinutes = parseLocalTimeToMinutes(window.opensAtLocal);
      const closesAtMinutes = parseLocalTimeToMinutes(window.closesAtLocal);

      if (
        !Number.isInteger(window.dayOfWeek) ||
        window.dayOfWeek < 0 ||
        window.dayOfWeek > 6
      ) {
        throw new Error("Choose a valid day for every weekly hours row.");
      }

      if (opensAtMinutes === null || closesAtMinutes === null) {
        throw new Error("Enter valid opening and closing times.");
      }

      if (opensAtMinutes === closesAtMinutes) {
        throw new Error("Opening and closing times cannot be the same.");
      }

      return {
        closesAtLocal: localTimeText(closesAtMinutes),
        dayOfWeek: window.dayOfWeek,
        opensAtLocal: localTimeText(opensAtMinutes),
        sortOrder: window.sortOrder ?? index,
      };
    })
    .sort(
      (left, right) =>
        left.dayOfWeek - right.dayOfWeek ||
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        left.opensAtLocal.localeCompare(right.opensAtLocal),
    );

  return normalized;
}

function normalizeSpecialHoursInput(input: CreateSalonSpecialHoursInput) {
  if (!DATE_PATTERN.test(input.localDate)) {
    throw new Error("Choose a valid special date.");
  }

  const reason = input.reason?.trim().slice(0, 120) || null;

  if (input.status === "closed") {
    return {
      closesAtLocal: null,
      localDate: input.localDate,
      opensAtLocal: null,
      reason,
      status: "closed" as const,
    };
  }

  const opensAtMinutes = parseLocalTimeToMinutes(input.opensAtLocal);
  const closesAtMinutes = parseLocalTimeToMinutes(input.closesAtLocal);

  if (opensAtMinutes === null || closesAtMinutes === null) {
    throw new Error("Custom special hours need opening and closing times.");
  }

  if (opensAtMinutes === closesAtMinutes) {
    throw new Error("Custom special hours cannot open and close at the same time.");
  }

  return {
    closesAtLocal: localTimeText(closesAtMinutes),
    localDate: input.localDate,
    opensAtLocal: localTimeText(opensAtMinutes),
    reason,
    status: "custom_hours" as const,
  };
}

async function loadOperatingTimezone(input: {
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
}) {
  const { data, error } = await input.supabase
    .from("salon_settings")
    .select("operating_timezone_iana")
    .eq("salon_id", input.salonId)
    .maybeSingle<{ operating_timezone_iana: string | null }>();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeOperatingTimeZone(data?.operating_timezone_iana);
}

export async function getCurrentSalonOperatingHoursSettings(
  context?: CurrentBusinessContext,
): Promise<SalonOperatingHoursSettings> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("You must be logged in to view salon operating hours.");
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.view, resolvedContext);

  const { salon } = requireCurrentSalonContext(resolvedContext);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("This feature is temporarily unavailable. Please try again later.");
  }

  const timeZone = await loadOperatingTimezone({ salonId: salon.id, supabase });
  const localToday = getZonedLocalParts(new Date(), timeZone).date;
  const rangeStart = addLocalDays(localToday, -1);
  const rangeEnd = addLocalDays(localToday, 120);
  const [weeklyResult, specialResult] = await Promise.all([
    supabase
      .from("salon_operating_hours")
      .select(OPERATING_HOURS_SELECT)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .order("day_of_week", { ascending: true })
      .order("sort_order", { ascending: true })
      .returns<OperatingHoursRow[]>(),
    supabase
      .from("salon_special_hours")
      .select(SPECIAL_HOURS_SELECT)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .gte("local_date", rangeStart)
      .lte("local_date", rangeEnd)
      .order("local_date", { ascending: true })
      .returns<SpecialHoursRow[]>(),
  ]);

  const error = weeklyResult.error ?? specialResult.error;

  if (error) {
    console.warn("Supabase load salon operating hours failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      userId: resolvedContext.user.id,
    });
    throw new Error(error.message);
  }

  const weeklyHours = (weeklyResult.data ?? []).map(mapOperatingHoursRow);
  const specialHours = (specialResult.data ?? []).map(mapSpecialHoursRow);
  const status = resolveSalonOperatingStatus({
    lifecycleStatus: salon.status,
    specialHours,
    timeZone,
    weeklyHours,
  });

  return {
    specialHours,
    status,
    timeZone,
    weeklyHours,
  };
}

export async function getCurrentSalonOperatingStatus(
  context?: CurrentBusinessContext,
): Promise<SalonOperatingStatus> {
  return (await getCurrentSalonOperatingHoursSettings(context)).status;
}

export async function updateCurrentSalonOperatingHours(
  input: UpdateSalonOperatingHoursInput,
) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update salon operating hours.");
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.manage, context);

  const { account, salon, user } = requireCurrentSalonContext(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("This feature is temporarily unavailable. Please try again later.");
  }

  const timeZone = normalizeOperatingTimeZone(input.timeZone);
  const weeklyHours = normalizeWeeklyHoursInput(input.weeklyHours);
  const { error: timezoneError } = await supabase
    .from("salon_settings")
    .update({ operating_timezone_iana: timeZone })
    .eq("salon_id", salon.id);

  if (timezoneError) {
    throw new Error(timezoneError.message);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("salon_operating_hours")
    .select("id")
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .returns<Array<{ id: string }>>();

  if (existingError) {
    console.error("Supabase load active salon operating hours failed", {
      accountId: account.id,
      code: existingError.code,
      details: existingError.details,
      hint: existingError.hint,
      message: existingError.message,
      salonId: salon.id,
      userId: user.id,
    });
    throw new Error(existingError.message);
  }

  const previousActiveIds = (existingRows ?? []).map((row) => row.id);

  if (weeklyHours.length > 0) {
    const { error: insertError } = await supabase
      .from("salon_operating_hours")
      .insert(
        weeklyHours.map((window) => ({
          closes_at_local: window.closesAtLocal,
          created_by_user_id: user.id,
          day_of_week: window.dayOfWeek,
          opens_at_local: window.opensAtLocal,
          salon_id: salon.id,
          sort_order: window.sortOrder ?? 0,
          updated_by_user_id: user.id,
        })),
      );

    if (insertError) {
      console.error("Supabase insert salon operating hours failed", {
        accountId: account.id,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
        message: insertError.message,
        salonId: salon.id,
        userId: user.id,
      });
      throw new Error(insertError.message);
    }
  }

  if (previousActiveIds.length === 0) {
    return;
  }

  const { error: deactivateError } = await supabase
    .from("salon_operating_hours")
    .update({
      is_active: false,
      updated_by_user_id: user.id,
    })
    .eq("salon_id", salon.id)
    .in("id", previousActiveIds);

  if (deactivateError) {
    console.error("Supabase deactivate salon operating hours failed", {
      accountId: account.id,
      code: deactivateError.code,
      details: deactivateError.details,
      hint: deactivateError.hint,
      message: deactivateError.message,
      salonId: salon.id,
      userId: user.id,
    });
    throw new Error(deactivateError.message);
  }
}

export async function createCurrentSalonSpecialHours(
  input: CreateSalonSpecialHoursInput,
) {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update special hours.");
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.manage, context);

  const { account, salon, user } = requireCurrentSalonContext(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("This feature is temporarily unavailable. Please try again later.");
  }

  const timeZone = await loadOperatingTimezone({ salonId: salon.id, supabase });
  const localToday = getZonedLocalParts(new Date(), timeZone).date;
  const normalized = normalizeSpecialHoursInput(input);

  if (normalized.localDate < localToday) {
    throw new Error("Special closures can only be added for today or a future date.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("salon_special_hours")
    .select("id")
    .eq("salon_id", salon.id)
    .eq("local_date", normalized.localDate)
    .eq("is_active", true)
    .maybeSingle<{ id: string }>();

  if (existingError) {
    throw new Error(existingError.message);
  }

  const payload = {
    closes_at_local: normalized.closesAtLocal,
    local_date: normalized.localDate,
    opens_at_local: normalized.opensAtLocal,
    reason: normalized.reason,
    salon_id: salon.id,
    status: normalized.status,
    updated_by_user_id: user.id,
  };

  const result = existing
    ? await supabase
        .from("salon_special_hours")
        .update(payload)
        .eq("id", existing.id)
        .eq("salon_id", salon.id)
    : await supabase.from("salon_special_hours").insert({
        ...payload,
        created_by_user_id: user.id,
      });

  if (result.error) {
    console.error("Supabase upsert salon special hours failed", {
      accountId: account.id,
      code: result.error.code,
      details: result.error.details,
      hint: result.error.hint,
      message: result.error.message,
      salonId: salon.id,
      userId: user.id,
    });
    throw new Error(result.error.message);
  }
}

export async function deleteCurrentSalonSpecialHours(specialHoursId: string) {
  if (!isUuid(specialHoursId)) {
    throw new Error("Choose a valid special hours row.");
  }

  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to update special hours.");
  }

  await requirePermission(SALON_SETTING_PERMISSIONS.manage, context);

  const { salon, user } = requireCurrentSalonContext(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("This feature is temporarily unavailable. Please try again later.");
  }

  const { error } = await supabase
    .from("salon_special_hours")
    .update({
      is_active: false,
      updated_by_user_id: user.id,
    })
    .eq("id", specialHoursId)
    .eq("salon_id", salon.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getPublicSalonOperatingHours(salonId: string): Promise<SalonOperatingHoursSettings | null> {
  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Could not load operating hours.");
  const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
  const { data, error } = await rpc("get_public_salon_operating_status_inputs", { target_salon_ids: normalizeSalonOperatingStatusSalonIds([salonId]) });
  if (error) throw new Error("Could not load operating hours.");
  const row = (Array.isArray(data) ? data as PublicStatusInputRow[] : []).find(row => row.salon_id === salonId);
  if (!row) return null;
  const weeklyHours = mapPublicWeeklyHours(row.weekly_hours);
  const specialHours = mapPublicSpecialHours(row.special_hours);
  const timeZone = normalizeOperatingTimeZone(row.timezone_iana);
  return { weeklyHours, specialHours, timeZone, status: resolveSalonOperatingStatus({ lifecycleStatus: row.lifecycle_status, weeklyHours, specialHours, timeZone }) };
}

export async function getPublicSalonOperatingStatusesBySalonId(
  salonIds: string[],
) {
  const ids = normalizeSalonOperatingStatusSalonIds(salonIds);
  const statuses = new Map<string, SalonOperatingStatus>();

  if (ids.length === 0) {
    return statuses;
  }

  const supabase = createSupabaseServerClient();

  if (!supabase) {
    for (const salonId of ids) {
      statuses.set(salonId, defaultSalonOperatingStatus());
    }

    return statuses;
  }

  const rpc = supabase.rpc.bind(supabase) as unknown as RpcRunner;
  const { data, error } = await rpc("get_public_salon_operating_status_inputs", {
    target_salon_ids: ids,
  });

  if (error) {
    if (!publicStatusRpcWarningLogged) {
      publicStatusRpcWarningLogged = true;
      console.warn("Public salon operating status inputs unavailable", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });
    }

    for (const salonId of ids) {
      statuses.set(salonId, defaultSalonOperatingStatus());
    }

    return statuses;
  }

  const rows = Array.isArray(data) ? (data as PublicStatusInputRow[]) : [];

  for (const row of rows) {
    statuses.set(
      row.salon_id,
      resolveSalonOperatingStatus({
        lifecycleStatus: row.lifecycle_status,
        specialHours: mapPublicSpecialHours(row.special_hours),
        timeZone: row.timezone_iana,
        weeklyHours: mapPublicWeeklyHours(row.weekly_hours),
      }),
    );
  }

  for (const salonId of ids) {
    if (!statuses.has(salonId)) {
      statuses.set(salonId, defaultSalonOperatingStatus());
    }
  }

  return statuses;
}

export function operatingStatusFromMap(
  statuses: Map<string, SalonOperatingStatus>,
  salonId: string,
) {
  return statuses.get(salonId) ?? defaultSalonOperatingStatus();
}
