import type {
  SalonOperatingHoursWindow,
  SalonOperatingStatus,
  SalonOperatingStatusInput,
  SalonSpecialHours,
} from "@/types/salon-operating-status";

export const DEFAULT_SALON_OPERATING_TIMEZONE = "America/Chicago";
export const SALON_OPERATING_STATUS_LOOKAHEAD_DAYS = 30;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type ZonedLocalParts = {
  date: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
};

type PreparedWindow = SalonOperatingHoursWindow & {
  closesAtMinutes: number;
  opensAtMinutes: number;
  reason: string | null;
  source: "special_hours" | "weekly_hours";
};

type NextOpening = {
  label: string;
  localDate: string;
  opensAtLocal: string;
};

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function normalizeOperatingTimeZone(value: string | null | undefined) {
  const candidate = value?.trim();

  if (!candidate) {
    return DEFAULT_SALON_OPERATING_TIMEZONE;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(),
    );
    return candidate;
  } catch {
    return DEFAULT_SALON_OPERATING_TIMEZONE;
  }
}

export function dayOfWeek(date: string) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

export function addLocalDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days, 12));

  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(
    value.getUTCDate(),
  )}`;
}

export function parseLocalTimeToMinutes(value: string | null | undefined) {
  const match = value?.trim().match(TIME_PATTERN);

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

export function localTimeText(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;

  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function localTimeLabel(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;

  return minute === 0
    ? `${displayHour} ${suffix}`
    : `${displayHour}:${pad(minute)} ${suffix}`;
}

export function localDateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, 12));

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(value);
}

export function getZonedLocalParts(
  value: Date | string,
  timeZone: string,
): ZonedLocalParts {
  const date = typeof value === "string" ? new Date(value) : value;
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(safeDate);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const rawHour = Number(parts.find((part) => part.type === "hour")?.value);
  const rawMinute = Number(parts.find((part) => part.type === "minute")?.value);
  const localDate = `${year}-${month}-${day}`;

  return {
    date: localDate,
    dayOfWeek: dayOfWeek(localDate),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number.isFinite(rawMinute) ? rawMinute : 0,
  };
}

function normalizeWeeklyHours(
  weeklyHours: SalonOperatingHoursWindow[],
): PreparedWindow[] {
  return weeklyHours
    .map((window, index): PreparedWindow | null => {
      const opensAtMinutes = parseLocalTimeToMinutes(window.opensAtLocal);
      const closesAtMinutes = parseLocalTimeToMinutes(window.closesAtLocal);

      if (
        opensAtMinutes === null ||
        closesAtMinutes === null ||
        closesAtMinutes === opensAtMinutes ||
        !Number.isInteger(window.dayOfWeek) ||
        window.dayOfWeek < 0 ||
        window.dayOfWeek > 6
      ) {
        return null;
      }

      return {
        ...window,
        closesAtLocal: localTimeText(closesAtMinutes),
        closesAtMinutes,
        opensAtLocal: localTimeText(opensAtMinutes),
        opensAtMinutes,
        reason: null,
        sortOrder: window.sortOrder ?? index,
        source: "weekly_hours" as const,
      };
    })
    .filter((window): window is PreparedWindow => Boolean(window))
    .sort(
      (left, right) =>
        left.dayOfWeek - right.dayOfWeek ||
        (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
        left.opensAtMinutes - right.opensAtMinutes,
    );
}

function normalizeSpecialHours(
  specialHours: SalonSpecialHours[],
): SalonSpecialHours[] {
  return specialHours
    .filter((special) => DATE_PATTERN.test(special.localDate))
    .map((special) => {
      const closesAtMinutes = parseLocalTimeToMinutes(special.closesAtLocal);
      const opensAtMinutes = parseLocalTimeToMinutes(special.opensAtLocal);

      return {
        ...special,
        closesAtLocal:
          special.status === "custom_hours" && closesAtMinutes !== null
            ? localTimeText(closesAtMinutes)
            : null,
        opensAtLocal:
          special.status === "custom_hours" && opensAtMinutes !== null
            ? localTimeText(opensAtMinutes)
            : null,
        reason: special.reason?.trim() || null,
      };
    })
    .filter((special) => {
      if (special.status === "closed") {
        return true;
      }

      const opensAtMinutes = parseLocalTimeToMinutes(special.opensAtLocal);
      const closesAtMinutes = parseLocalTimeToMinutes(special.closesAtLocal);

      return (
        opensAtMinutes !== null &&
        closesAtMinutes !== null &&
        closesAtMinutes !== opensAtMinutes
      );
    })
    .sort((left, right) => left.localDate.localeCompare(right.localDate));
}

function specialByLocalDate(specialHours: SalonSpecialHours[]) {
  const byDate = new Map<string, SalonSpecialHours>();

  for (const special of normalizeSpecialHours(specialHours)) {
    if (!byDate.has(special.localDate)) {
      byDate.set(special.localDate, special);
    }
  }

  return byDate;
}

function windowsForDate(input: {
  date: string;
  specialByDate: Map<string, SalonSpecialHours>;
  weeklyHours: PreparedWindow[];
}): PreparedWindow[] {
  const special = input.specialByDate.get(input.date);

  if (special?.status === "closed") {
    return [];
  }

  if (special?.status === "custom_hours") {
    const opensAtMinutes = parseLocalTimeToMinutes(special.opensAtLocal);
    const closesAtMinutes = parseLocalTimeToMinutes(special.closesAtLocal);

    return opensAtMinutes === null ||
      closesAtMinutes === null ||
      opensAtMinutes === closesAtMinutes
      ? []
      : [
          {
            closesAtLocal: localTimeText(closesAtMinutes),
            closesAtMinutes,
            dayOfWeek: dayOfWeek(input.date),
            id: special.id,
            opensAtLocal: localTimeText(opensAtMinutes),
            opensAtMinutes,
            reason: special.reason,
            sortOrder: 0,
            source: "special_hours",
          },
        ];
  }

  const selectedDay = dayOfWeek(input.date);

  return input.weeklyHours.filter((window) => window.dayOfWeek === selectedDay);
}

function effectiveCloseMinutes(window: PreparedWindow) {
  return window.closesAtMinutes <= window.opensAtMinutes
    ? window.closesAtMinutes + 1440
    : window.closesAtMinutes;
}

function isOpenInWindow(window: PreparedWindow, minuteOfDay: number) {
  const currentMinute =
    minuteOfDay < window.opensAtMinutes &&
    window.closesAtMinutes <= window.opensAtMinutes
      ? minuteOfDay + 1440
      : minuteOfDay;

  return (
    currentMinute >= window.opensAtMinutes &&
    currentMinute < effectiveCloseMinutes(window)
  );
}

function nextOpening(input: {
  currentDate: string;
  currentMinute: number;
  specialByDate: Map<string, SalonSpecialHours>;
  weeklyHours: PreparedWindow[];
}): NextOpening | null {
  for (let offset = 0; offset <= SALON_OPERATING_STATUS_LOOKAHEAD_DAYS; offset += 1) {
    const date = addLocalDays(input.currentDate, offset);
    const windows = windowsForDate({
      date,
      specialByDate: input.specialByDate,
      weeklyHours: input.weeklyHours,
    });
    const futureWindows = windows
      .filter(
        (window) => offset > 0 || window.opensAtMinutes > input.currentMinute,
      )
      .sort((left, right) => left.opensAtMinutes - right.opensAtMinutes);
    const window = futureWindows[0];

    if (!window) {
      continue;
    }

    const timeLabel = localTimeLabel(window.opensAtMinutes);
    const dayLabel =
      offset === 0
        ? ""
        : offset === 1
          ? " tomorrow"
          : offset <= 6
            ? ` ${DAY_LABELS[dayOfWeek(date)]}`
            : ` ${localDateLabel(date)}`;

    return {
      label: `Opens${dayLabel} at ${timeLabel}`,
      localDate: date,
      opensAtLocal: window.opensAtLocal,
    };
  }

  return null;
}

function status(input: {
  checkedAt: Date;
  closesAtLocal?: string | null;
  detail?: string | null;
  isOpen: boolean;
  kind: SalonOperatingStatus["kind"];
  label: string;
  localDate: string;
  nextOpening?: NextOpening | null;
  reason?: string | null;
  source: SalonOperatingStatus["source"];
  timeZone: string;
  tone: SalonOperatingStatus["tone"];
}): SalonOperatingStatus {
  return {
    checkedAt: input.checkedAt.toISOString(),
    closesAtLocal: input.closesAtLocal ?? null,
    detail: input.detail ?? input.nextOpening?.label ?? null,
    isOpen: input.isOpen,
    kind: input.kind,
    label: input.label,
    localDate: input.localDate,
    nextOpensAtLocal: input.nextOpening?.opensAtLocal ?? null,
    nextOpensLabel: input.nextOpening?.label ?? null,
    reason: input.reason ?? null,
    source: input.source,
    timeZone: input.timeZone,
    tone: input.tone,
  };
}

export function resolveSalonOperatingStatus(
  input: SalonOperatingStatusInput,
): SalonOperatingStatus {
  const timeZone = normalizeOperatingTimeZone(input.timeZone);
  const checkedAt =
    input.now instanceof Date
      ? input.now
      : input.now
        ? new Date(input.now)
        : new Date();
  const local = getZonedLocalParts(checkedAt, timeZone);

  if (input.lifecycleStatus === "permanently_closed") {
    return status({
      checkedAt,
      isOpen: false,
      kind: "permanently_closed",
      label: "Permanently closed",
      localDate: local.date,
      source: "lifecycle",
      timeZone,
      tone: "danger",
    });
  }

  if (input.lifecycleStatus && input.lifecycleStatus !== "active") {
    return status({
      checkedAt,
      isOpen: false,
      kind: "closed",
      label: "Closed",
      localDate: local.date,
      source: "lifecycle",
      timeZone,
      tone: "closed",
    });
  }

  const weeklyHours = normalizeWeeklyHours(input.weeklyHours);
  const specialByDate = specialByLocalDate(input.specialHours);
  const currentSpecial = specialByDate.get(local.date);
  const currentMinute = local.hour * 60 + local.minute;
  const next = nextOpening({
    currentDate: local.date,
    currentMinute,
    specialByDate,
    weeklyHours,
  });

  if (currentSpecial?.status === "closed") {
    return status({
      checkedAt,
      detail: [currentSpecial.reason, next?.label]
        .filter((part): part is string => Boolean(part))
        .join(" · ") || null,
      isOpen: false,
      kind: "special_closure",
      label: "Closed today",
      localDate: local.date,
      nextOpening: next,
      reason: currentSpecial.reason,
      source: "special_hours",
      timeZone,
      tone: "special",
    });
  }

  const todayWindows = windowsForDate({
    date: local.date,
    specialByDate,
    weeklyHours,
  });
  const previousWindows = currentSpecial
    ? []
    : windowsForDate({
        date: addLocalDays(local.date, -1),
        specialByDate,
        weeklyHours,
      }).filter(
        (window) =>
          window.closesAtMinutes <= window.opensAtMinutes &&
          currentMinute + 1440 < effectiveCloseMinutes(window),
      );
  const openWindow =
    todayWindows.find((window) => isOpenInWindow(window, currentMinute)) ??
    previousWindows.find((window) =>
      isOpenInWindow(window, currentMinute + 1440),
    );

  if (openWindow) {
    return status({
      checkedAt,
      closesAtLocal: openWindow.closesAtLocal,
      detail: `Closes at ${localTimeLabel(openWindow.closesAtMinutes)}`,
      isOpen: true,
      kind: "open",
      label: "Open now",
      localDate: local.date,
      reason: openWindow.reason,
      source: openWindow.source,
      timeZone,
      tone: "open",
    });
  }

  if (weeklyHours.length === 0 && !next) {
    return status({
      checkedAt,
      detail: "Hours not set",
      isOpen: false,
      kind: "hours_unset",
      label: "Closed",
      localDate: local.date,
      source: "unset",
      timeZone,
      tone: "muted",
    });
  }

  return status({
    checkedAt,
    isOpen: false,
    kind: todayWindows.length === 0 ? "closed_today" : "closed",
    label: todayWindows.length === 0 ? "Closed today" : "Closed",
    localDate: local.date,
    nextOpening: next,
    source: currentSpecial ? "special_hours" : "weekly_hours",
    timeZone,
    tone: currentSpecial ? "special" : "closed",
  });
}

export function defaultSalonOperatingStatus(
  timeZone: string | null | undefined = DEFAULT_SALON_OPERATING_TIMEZONE,
) {
  return resolveSalonOperatingStatus({
    lifecycleStatus: "active",
    specialHours: [],
    timeZone,
    weeklyHours: [],
  });
}
