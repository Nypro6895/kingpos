import "server-only";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";

export type SalonBusinessHoursSource =
  | "staff_availability_rules"
  | "unavailable";

export type SalonBusinessHourBucket = {
  hour: number;
  index: number;
  label: string;
};

export type SalonActivityBucketSource =
  | "activity_hours_fallback"
  | "after_hours"
  | "before_open"
  | "business_hours";

export type SalonActivityBucket = {
  exceptional: boolean;
  hour: number | null;
  hours: number[];
  label: string;
  source: SalonActivityBucketSource;
};

export type SalonBusinessHoursWindow = {
  buckets: SalonBusinessHourBucket[];
  closesAtLocal: string | null;
  date: string;
  fallbackReason: string | null;
  isClosed: boolean;
  isFallback: boolean;
  opensAtLocal: string | null;
  source: SalonBusinessHoursSource;
  spansOvernight: boolean;
  timeZone: string;
};

export type LocalDateHour = {
  date: string;
  hour: number;
};

type AvailabilityRuleRow = {
  day_of_week: number;
  effective_end_date: string | null;
  effective_start_date: string | null;
  ends_at_local: string;
  starts_at_local: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function parseLocalTimeToMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return hour * 60 + minute;
}

function localTimeText(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function salonBusinessHourLabel(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;

  if (normalized === 0) {
    return "12 AM";
  }

  if (normalized < 12) {
    return `${normalized} AM`;
  }

  if (normalized === 12) {
    return "12 PM";
  }

  return `${normalized - 12} PM`;
}

export function getLocalDateHour(
  value: string,
  timeZone: string,
): LocalDateHour | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);

  if (!year || !month || !day || !Number.isFinite(hour)) {
    return null;
  }

  return {
    date: `${year}-${month}-${day}`,
    hour,
  };
}

export function buildSalonBusinessHourBuckets(input: {
  closesAtMinutes: number;
  opensAtMinutes: number;
}): SalonBusinessHourBucket[] {
  let closeMinutes = input.closesAtMinutes;
  const spansOvernight = closeMinutes <= input.opensAtMinutes;

  if (spansOvernight) {
    closeMinutes += 1440;
  }

  const startHour = Math.floor(input.opensAtMinutes / 60);
  const endHour =
    closeMinutes % 1440 === 0 && closeMinutes > input.opensAtMinutes
      ? Math.floor((closeMinutes - 1) / 60)
      : Math.floor(closeMinutes / 60);
  const buckets: SalonBusinessHourBucket[] = [];

  for (let hour = startHour; hour <= endHour; hour += 1) {
    const localHour = ((hour % 24) + 24) % 24;

    buckets.push({
      hour: localHour,
      index: buckets.length,
      label: salonBusinessHourLabel(localHour),
    });
  }

  return buckets;
}

function normalizeHour(hour: number) {
  return ((hour % 24) + 24) % 24;
}

function uniqueSortedHours(hours: Iterable<number>) {
  return Array.from(
    new Set(
      Array.from(hours)
        .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
        .map(normalizeHour),
    ),
  ).sort((left, right) => left - right);
}

function classifyExceptionalHour(
  hour: number,
  businessHours: SalonBusinessHoursWindow,
) {
  if (businessHours.spansOvernight) {
    return "after_hours" as const;
  }

  const firstBusinessHour = businessHours.buckets[0]?.hour ?? 0;

  return hour < firstBusinessHour
    ? ("before_open" as const)
    : ("after_hours" as const);
}

export function buildSalonActivityBuckets(input: {
  activeHours: Iterable<number>;
  businessHours?: SalonBusinessHoursWindow | null;
  date: string;
  timeZone: string;
}): SalonActivityBucket[] {
  const activeHours = uniqueSortedHours(input.activeHours);
  const businessHourBuckets =
    input.businessHours && !input.businessHours.isClosed
      ? input.businessHours.buckets
      : [];

  if (businessHourBuckets.length > 0 && input.businessHours) {
    const businessHourSet = new Set(
      businessHourBuckets.map((bucket) => bucket.hour),
    );
    const exceptionalHours = activeHours.filter(
      (hour) => !businessHourSet.has(hour),
    );
    const beforeOpenHours: number[] = [];
    const afterHours: number[] = [];

    for (const hour of exceptionalHours) {
      if (classifyExceptionalHour(hour, input.businessHours) === "before_open") {
        beforeOpenHours.push(hour);
      } else {
        afterHours.push(hour);
      }
    }

    const orderedBuckets: Array<SalonActivityBucket | null> = [
      beforeOpenHours.length > 0
        ? {
            exceptional: true,
            hour: null,
            hours: beforeOpenHours,
            label: "Before open",
            source: "before_open" as const,
          }
        : null,
      ...businessHourBuckets.map((bucket) => ({
        exceptional: false,
        hour: bucket.hour,
        hours: [bucket.hour],
        label: bucket.label,
        source: "business_hours" as const,
      })),
      afterHours.length > 0
        ? {
            exceptional: true,
            hour: null,
            hours: afterHours,
            label: "After hours",
            source: "after_hours" as const,
          }
        : null,
    ];

    return orderedBuckets.filter(
      (bucket): bucket is SalonActivityBucket => Boolean(bucket),
    );
  }

  if (activeHours.length === 0) {
    return [];
  }

  const firstHour = Math.min(...activeHours);
  const latestActivityHour = Math.max(...activeHours);
  const currentLocal = getLocalDateHour(new Date().toISOString(), input.timeZone);
  const lastHour =
    currentLocal?.date === input.date
      ? Math.max(currentLocal.hour, latestActivityHour)
      : latestActivityHour;
  const buckets: SalonActivityBucket[] = [];

  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    const localHour = normalizeHour(hour);

    buckets.push({
      exceptional: false,
      hour: localHour,
      hours: [localHour],
      label: salonBusinessHourLabel(localHour),
      source: "activity_hours_fallback",
    });
  }

  return buckets;
}

export function unavailableSalonBusinessHours(input: {
  date: string;
  fallbackReason: string;
  timeZone: string;
}): SalonBusinessHoursWindow {
  return {
    buckets: [],
    closesAtLocal: null,
    date: input.date,
    fallbackReason: input.fallbackReason,
    isClosed: false,
    isFallback: true,
    opensAtLocal: null,
    source: "unavailable",
    spansOvernight: false,
    timeZone: input.timeZone,
  };
}

export async function getSalonBusinessHoursForDate(input: {
  context: CurrentBusinessContext;
  date: string;
  timeZone: string;
}): Promise<SalonBusinessHoursWindow> {
  const salonId = input.context.currentSalon?.id;

  if (!salonId || !DATE_PATTERN.test(input.date)) {
    return unavailableSalonBusinessHours({
      date: input.date,
      fallbackReason: "Salon context or selected date is unavailable.",
      timeZone: input.timeZone,
    });
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return unavailableSalonBusinessHours({
      date: input.date,
      fallbackReason: "Supabase environment variables are missing.",
      timeZone: input.timeZone,
    });
  }

  const selectedDay = dayOfWeek(input.date);
  const { data, error } = await supabase
    .from("staff_availability_rules")
    .select(
      "day_of_week, starts_at_local, ends_at_local, effective_start_date, effective_end_date",
    )
    .eq("salon_id", salonId)
    .eq("is_active", true)
    .eq("rule_type", "working")
    .eq("day_of_week", selectedDay)
    .returns<AvailabilityRuleRow[]>();

  if (error) {
    console.error("Supabase load Today salon business hours failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId,
      selectedDate: input.date,
      userId: input.context.user?.id,
    });
    return unavailableSalonBusinessHours({
      date: input.date,
      fallbackReason: error.message,
      timeZone: input.timeZone,
    });
  }

  const windows = (data ?? [])
    .filter(
      (rule) =>
        (!rule.effective_start_date ||
          rule.effective_start_date <= input.date) &&
        (!rule.effective_end_date || rule.effective_end_date >= input.date),
    )
    .map((rule) => {
      const opensAtMinutes = parseLocalTimeToMinutes(rule.starts_at_local);
      const closesAtMinutes = parseLocalTimeToMinutes(rule.ends_at_local);

      return opensAtMinutes === null || closesAtMinutes === null
        ? null
        : { closesAtMinutes, opensAtMinutes };
    })
    .filter((window): window is {
      closesAtMinutes: number;
      opensAtMinutes: number;
    } => Boolean(window));

  if (windows.length === 0) {
    return {
      buckets: [],
      closesAtLocal: null,
      date: input.date,
      fallbackReason: null,
      isClosed: true,
      isFallback: false,
      opensAtLocal: null,
      source: "staff_availability_rules",
      spansOvernight: false,
      timeZone: input.timeZone,
    };
  }

  const opensAtMinutes = Math.min(
    ...windows.map((window) => window.opensAtMinutes),
  );
  const normalizedWindows = windows.map((window) => ({
    ...window,
    effectiveClose:
      window.closesAtMinutes <= window.opensAtMinutes
        ? window.closesAtMinutes + 1440
        : window.closesAtMinutes,
  }));
  const closesAtMinutes = normalizedWindows.reduce(
    (latest, window) =>
      window.effectiveClose > latest.effectiveClose ? window : latest,
    normalizedWindows[0],
  ).closesAtMinutes;

  return {
    buckets: buildSalonBusinessHourBuckets({
      closesAtMinutes,
      opensAtMinutes,
    }),
    closesAtLocal: localTimeText(closesAtMinutes),
    date: input.date,
    fallbackReason: null,
    isClosed: false,
    isFallback: false,
    opensAtLocal: localTimeText(opensAtMinutes),
    source: "staff_availability_rules",
    spansOvernight: closesAtMinutes <= opensAtMinutes,
    timeZone: input.timeZone,
  };
}
