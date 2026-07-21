"use client";

import {
  cancelStaffTimeBlockAction,
  createStaffTimeBlockAction,
  saveStaffWeeklyAvailabilityAction,
  type BookingSetupActionResult,
} from "@/app/booking-setup/actions";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  normalizeSalonProfileMediaPath,
} from "@/lib/salon-profile-media";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type {
  StaffAvailabilityRule,
  StaffTimeBlock,
} from "@/types/booking";
import type {
  BookingSetupData,
  StaffBookingReadiness,
} from "@/lib/booking-setup";
import type { Staff } from "@/types/staff";
import "./booking-setup.css";

type DayDraft = {
  breaks: TimeIntervalDraft[];
  working: TimeIntervalDraft[];
};

type TimeIntervalDraft = {
  endsAt: string;
  startsAt: string;
};

const DAYS = [
  { id: 0, label: "Sun" },
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
] as const;

const EMPTY_WEEK: Record<number, DayDraft> = Object.fromEntries(
  DAYS.map((day) => [day.id, { breaks: [], working: [] }]),
) as Record<number, DayDraft>;

type WeekState = {
  key: string;
  week: Record<number, DayDraft>;
};

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(new Date(value));
}

function getInitials(value: string) {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ST";
}

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function getStaffAvatarUrl(path: string | null | undefined) {
  const cleanedPath = normalizeSalonProfileMediaPath(path);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!cleanedPath || !supabaseUrl) {
    return null;
  }

  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(
    SALON_PROFILE_MEDIA_BUCKET,
  )}/${encodeStoragePath(cleanedPath)}`;
}

function SetupStaffAvatar({
  className,
  staff,
}: {
  className?: string;
  staff: Pick<Staff, "display_name" | "public_profile_photo_path">;
}) {
  const avatarUrl = getStaffAvatarUrl(staff.public_profile_photo_path);

  return (
    <span className={classNames("booking-setup-avatar", className)}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="booking-setup-avatar__image" src={avatarUrl} />
      ) : (
        getInitials(staff.display_name)
      )}
    </span>
  );
}

function Message({ result }: { result: BookingSetupActionResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <div
      className={classNames(
        "rounded-md border px-3 py-2 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800",
      )}
    >
      {result.ok ? "Saved." : result.error ?? "Save failed."}
      {!result.ok && result.conflicts && result.conflicts.length > 0 ? (
        <ul className="mt-2 grid gap-1">
          {result.conflicts.slice(0, 4).map((conflict) => (
            <li key={conflict.booking_line_id}>
              {conflict.customer_name} / {conflict.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StickySaveBar({
  canManage,
  children,
  dirtyCount,
  hideWhenClean = false,
  isPending,
  onReset,
  onSave,
  resetLabel = "Cancel",
  sticky = true,
}: {
  canManage: boolean;
  children?: ReactNode;
  dirtyCount: number;
  hideWhenClean?: boolean;
  isPending: boolean;
  onReset: () => void;
  onSave: () => void;
  resetLabel?: string;
  sticky?: boolean;
}) {
  if (hideWhenClean && dirtyCount === 0) {
    return null;
  }

  return (
    <div
      className={classNames(
        "booking-setup-savebar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        sticky && "sticky bottom-0 z-10",
      )}
    >
      <div className="text-sm font-semibold text-zinc-700">
        {dirtyCount > 0 ? `${dirtyCount} unsaved changes` : "No unsaved changes"}
      </div>
      {children}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="booking-setup-secondary-button disabled:opacity-50"
            disabled={isPending || dirtyCount === 0}
            onClick={onReset}
            type="button"
          >
            {resetLabel}
          </button>
          <button
            className="booking-setup-primary-button disabled:opacity-50"
            disabled={isPending || dirtyCount === 0}
            onClick={onSave}
            type="button"
          >
            {isPending ? "Saving" : "Save changes"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">View-only access.</p>
      )}
    </div>
  );
}

function buildWeekDraft(
  rules: StaffAvailabilityRule[],
  staffId: string,
): Record<number, DayDraft> {
  const week = Object.fromEntries(
    DAYS.map((day) => [day.id, { breaks: [], working: [] }]),
  ) as Record<number, DayDraft>;

  for (const rule of rules) {
    if (rule.staff_id !== staffId || !rule.is_active) {
      continue;
    }

    const target = rule.rule_type === "break" ? "breaks" : "working";
    week[rule.day_of_week][target].push({
      endsAt: rule.ends_at_local.slice(0, 5),
      startsAt: rule.starts_at_local.slice(0, 5),
    });
  }

  for (const day of DAYS) {
    week[day.id].working.sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt),
    );
    week[day.id].breaks.sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt),
    );
  }

  return week;
}

function weekKey(week: Record<number, DayDraft>) {
  return JSON.stringify(
    DAYS.map((day) => [
      day.id,
      week[day.id].working,
      week[day.id].breaks,
    ]),
  );
}

function presetWeekdays() {
  const week = structuredClone(EMPTY_WEEK);

  for (const day of [1, 2, 3, 4, 5]) {
    week[day] = {
      breaks: [],
      working: [{ endsAt: "17:00", startsAt: "09:00" }],
    };
  }

  return week;
}

function nextLocalDateTime(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  const date = `${part("year")}-${part("month")}-${part("day")}`;

  return {
    end: `${date}T17:00`,
    start: `${date}T13:00`,
  };
}

function defaultWorkingInterval() {
  return { endsAt: "17:00", startsAt: "09:00" };
}

function defaultBreakInterval() {
  return { endsAt: "13:00", startsAt: "12:00" };
}

function formatTimeText(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  const hourNumber = Number(hours);
  const minuteNumber = Number(minutes);

  if (!Number.isFinite(hourNumber) || !Number.isFinite(minuteNumber)) {
    return value;
  }

  const suffix = hourNumber >= 12 ? "PM" : "AM";
  const displayHour = hourNumber % 12 || 12;

  return minuteNumber === 0
    ? `${displayHour} ${suffix}`
    : `${displayHour}:${String(minuteNumber).padStart(2, "0")} ${suffix}`;
}

function formatIntervalRange(interval: TimeIntervalDraft) {
  return `${formatTimeText(interval.startsAt)} - ${formatTimeText(interval.endsAt)}`;
}

function formatIntervalList(intervals: TimeIntervalDraft[]) {
  return intervals.map(formatIntervalRange).join(", ");
}

function summarizeWeeklyHours(week: Record<number, DayDraft>) {
  const enabledDays = DAYS.filter((day) => week[day.id].working.length > 0);

  if (enabledDays.length === 0) {
    return "No weekly hours";
  }

  const firstWorkingKey = formatIntervalList(week[enabledDays[0].id].working);
  const sameHours = enabledDays.every(
    (day) => formatIntervalList(week[day.id].working) === firstWorkingKey,
  );
  const dayLabels = enabledDays.map((day) => day.label);
  const visibleDays = dayLabels.slice(0, 4).join(", ");
  const extraDays = dayLabels.length > 4 ? ` +${dayLabels.length - 4}` : "";

  return sameHours
    ? `${visibleDays}${extraDays}, ${firstWorkingKey}`
    : `${enabledDays.length} available day${enabledDays.length === 1 ? "" : "s"}`;
}

function formatDateText(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(new Date(value));
}

function formatDateRangeText(block: StaffTimeBlock, timeZone: string) {
  const start = formatDateText(block.starts_at, timeZone);
  const end = formatDateText(block.ends_at, timeZone);

  return start === end ? start : `${start} - ${end}`;
}

function summarizeTimeOffBlocks(blocks: StaffTimeBlock[], timeZone: string) {
  if (blocks.length === 0) {
    return "No upcoming time off";
  }

  if (blocks.length === 1) {
    return formatDateRangeText(blocks[0], timeZone);
  }

  return `${blocks.length} upcoming ranges`;
}

function upcomingTimeOffForStaff(blocks: StaffTimeBlock[], staffId: string) {
  const nowMs = Date.now();

  return blocks
    .filter(
      (block) =>
        block.is_active !== false &&
        block.block_type === "time_off" &&
        block.staff_id === staffId &&
        new Date(block.ends_at).getTime() >= nowMs,
    )
    .sort(
      (left, right) =>
        new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime(),
    );
}

function onlineBookingStatus(
  staff: Staff,
  readiness?: StaffBookingReadiness | null,
) {
  const onlineServiceCount = readiness?.onlineAssignedServiceCount ?? 0;
  const profileReady =
    staff.public_profile_visible &&
    staff.owner_public_enabled &&
    staff.staff_public_consent_status === "granted";

  if (!staff.online_booking_enabled) {
    return { detail: "Staff profile off", enabled: false, label: "Off" };
  }

  if (!profileReady) {
    return { detail: "Profile not public", enabled: false, label: "Off" };
  }

  if (onlineServiceCount === 0) {
    return { detail: "No online services", enabled: false, label: "Off" };
  }

  return {
    detail: `${onlineServiceCount} online service${onlineServiceCount === 1 ? "" : "s"}`,
    enabled: true,
    label: "Enabled",
  };
}

function IntervalEditor({
  addLabel,
  disabled,
  emptyText = "None",
  intervals,
  label,
  onAdd,
  onRemove,
  onUpdate,
}: {
  addLabel?: string;
  disabled: boolean;
  emptyText?: string;
  intervals: TimeIntervalDraft[];
  label: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, next: Partial<TimeIntervalDraft>) => void;
}) {
  return (
    <div aria-label={label} className="booking-availability-interval-editor">
      {intervals.length === 0 ? (
        <div className="booking-availability-empty-interval">
          <span>{emptyText}</span>
          <button
            className="booking-availability-link-button"
            disabled={disabled}
            onClick={onAdd}
            type="button"
          >
            + {addLabel ?? "Add interval"}
          </button>
        </div>
      ) : (
        <>
          {intervals.map((interval, index) => (
            <div
              className="booking-availability-interval-row"
              key={`${interval.startsAt}-${interval.endsAt}-${index}`}
            >
              <input
                aria-label={`${label} start`}
                className="booking-setup-field booking-availability-time-input"
                disabled={disabled}
                onChange={(event) =>
                  onUpdate(index, { startsAt: event.target.value })
                }
                type="time"
                value={interval.startsAt}
              />
              <span aria-hidden="true" className="booking-availability-time-dash">
                -
              </span>
              <input
                aria-label={`${label} end`}
                className="booking-setup-field booking-availability-time-input"
                disabled={disabled}
                onChange={(event) =>
                  onUpdate(index, { endsAt: event.target.value })
                }
                type="time"
                value={interval.endsAt}
              />
              <button
                aria-label={`Remove ${label.toLowerCase()} interval ${
                  index + 1
                }`}
                className="booking-availability-icon-button"
                disabled={disabled}
                onClick={() => onRemove(index)}
                title="Remove"
                type="button"
              >
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ))}
          <button
            className="booking-availability-link-button"
            disabled={disabled}
            onClick={onAdd}
            type="button"
          >
            + {addLabel ?? "Add interval"}
          </button>
        </>
      )}
    </div>
  );
}

export function StaffAvailabilityEditor({
  availabilityRules,
  canManage,
  readinessByStaffId,
  selectedStaffId,
  staff,
  timeBlocks,
  timezone,
}: {
  availabilityRules: StaffAvailabilityRule[];
  canManage: boolean;
  readinessByStaffId: Record<string, StaffBookingReadiness>;
  selectedStaffId?: string | null;
  staff: Staff[];
  timeBlocks: StaffTimeBlock[];
  timezone: string;
}) {
  const router = useRouter();
  const firstStaffId = staff[0]?.id ?? "";
  const initialExpandedStaffId =
    (selectedStaffId && staff.some((member) => member.id === selectedStaffId)
      ? selectedStaffId
      : null) ||
    firstStaffId ||
    null;
  const [expandedStaffState, setExpandedStaffState] = useState<{
    key: string;
    staffId: string | null;
  }>(() => ({
    key: firstStaffId,
    staffId: initialExpandedStaffId,
  }));
  const expandedStaffId =
    expandedStaffState.key === firstStaffId
      ? expandedStaffState.staffId
      : initialExpandedStaffId;
  const weeksByStaffId = useMemo(
    () =>
      Object.fromEntries(
        staff.map((member) => [
          member.id,
          buildWeekDraft(availabilityRules, member.id),
        ]),
      ) as Record<string, Record<number, DayDraft>>,
    [availabilityRules, staff],
  );
  const initialWeek = useMemo(
    () =>
      expandedStaffId
        ? weeksByStaffId[expandedStaffId] ??
          buildWeekDraft(availabilityRules, expandedStaffId)
        : structuredClone(EMPTY_WEEK),
    [availabilityRules, expandedStaffId, weeksByStaffId],
  );
  const initialWeekKey = weekKey(initialWeek);
  const weekStateKey = `${expandedStaffId ?? "none"}:${initialWeekKey}`;
  const [weekState, setWeekState] = useState<WeekState>(() => ({
    key: weekStateKey,
    week: initialWeek,
  }));
  const week = weekState.key === weekStateKey ? weekState.week : initialWeek;
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [timeOffResult, setTimeOffResult] =
    useState<BookingSetupActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isTimeOffPending, startTimeOffTransition] = useTransition();
  const [copySourceDay, setCopySourceDay] = useState<number | null>(null);
  const [copyTargets, setCopyTargets] = useState<number[]>([]);
  const nextBlock = useMemo(() => nextLocalDateTime(timezone), [timezone]);
  const nextBlockDate = nextBlock.start.slice(0, 10);
  const [timeOffStartDate, setTimeOffStartDate] = useState(nextBlockDate);
  const [timeOffEndDate, setTimeOffEndDate] = useState(nextBlockDate);
  const [timeOffReason, setTimeOffReason] = useState("");
  const weekDirty = expandedStaffId && weekKey(week) !== initialWeekKey ? 1 : 0;
  const expandedTimeOffBlocks = expandedStaffId
    ? upcomingTimeOffForStaff(timeBlocks, expandedStaffId)
    : [];

  useEffect(() => {
    if (weekDirty === 0) {
      return;
    }

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const confirmLinkNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest("a[href]") as HTMLAnchorElement | null;

      if (
        !anchor ||
        anchor.target ||
        anchor.hasAttribute("download") ||
        anchor.href === window.location.href
      ) {
        return;
      }

      if (!window.confirm("Discard unsaved availability changes?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", confirmLinkNavigation, true);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
    };
  }, [weekDirty]);

  function replaceStaffUrl(staffId: string | null) {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    params.set("tab", "availability");
    params.delete("section");

    if (staffId) {
      params.set("staffId", staffId);
    } else {
      params.delete("staffId");
    }

    const query = params.toString();
    router.replace(query ? `/bookings?${query}` : "/bookings", { scroll: false });
  }

  function expandStaff(staffId: string) {
    const nextStaffId = expandedStaffId === staffId ? null : staffId;

    if (
      weekDirty > 0 &&
      expandedStaffId !== nextStaffId &&
      typeof window !== "undefined" &&
      !window.confirm("Discard unsaved availability changes?")
    ) {
      return;
    }

    setResult(null);
    setCopySourceDay(null);
    setCopyTargets([]);
    setExpandedStaffState({ key: firstStaffId, staffId: nextStaffId });
    replaceStaffUrl(nextStaffId);
  }

  function updateDay(
    dayId: number,
    target: keyof DayDraft,
    updater: (intervals: TimeIntervalDraft[]) => TimeIntervalDraft[],
  ) {
    setWeekState({
      key: weekStateKey,
      week: {
        ...week,
        [dayId]: {
          ...week[dayId],
          [target]: updater(week[dayId][target]),
        },
      },
    });
  }

  function toggleDay(dayId: number, enabled: boolean) {
    setWeekState({
      key: weekStateKey,
      week: {
        ...week,
        [dayId]: enabled
          ? {
              breaks: [],
              working:
                week[dayId].working.length > 0
                  ? week[dayId].working
                  : [defaultWorkingInterval()],
            }
          : { breaks: [], working: [] },
      },
    });
  }

  function startCopyDay(dayId: number) {
    setCopySourceDay(dayId);
    setCopyTargets([]);
  }

  function toggleCopyTarget(dayId: number, checked: boolean) {
    setCopyTargets((current) =>
      checked
        ? [...new Set([...current, dayId])].sort()
        : current.filter((target) => target !== dayId),
    );
  }

  function copyDayToTargets(dayId: number) {
    if (copyTargets.length === 0) {
      return;
    }

    const source = structuredClone(week[dayId]);
    const next = structuredClone(week);

    for (const targetDay of copyTargets) {
      next[targetDay] = structuredClone(source);
    }

    setWeekState({
      key: weekStateKey,
      week: next,
    });
    setCopySourceDay(null);
    setCopyTargets([]);
  }

  function saveWeek() {
    if (!expandedStaffId) {
      return;
    }

    setResult(null);
    startTransition(async () => {
      const rules = DAYS.flatMap((day) => [
        ...week[day.id].working.map((interval) => ({
          dayOfWeek: day.id,
          endsAtLocal: interval.endsAt,
          ruleType: "working" as const,
          startsAtLocal: interval.startsAt,
          timezoneIana: timezone,
        })),
        ...week[day.id].breaks.map((interval) => ({
          dayOfWeek: day.id,
          endsAtLocal: interval.endsAt,
          ruleType: "break" as const,
          startsAtLocal: interval.startsAt,
          timezoneIana: timezone,
        })),
      ]);
      const response = await saveStaffWeeklyAvailabilityAction({
        rules,
        staffId: expandedStaffId,
      });

      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function createTimeOff(overrideConflicts = false) {
    if (!expandedStaffId) {
      return;
    }

    if (!timeOffStartDate || !timeOffEndDate || timeOffStartDate > timeOffEndDate) {
      setTimeOffResult({
        error: "Time off start date must be before end date.",
        ok: false,
      });

      return;
    }

    setTimeOffResult(null);
    startTimeOffTransition(async () => {
      const response = await createStaffTimeBlockAction({
        blockType: "time_off",
        endLocal: `${timeOffEndDate}T23:59`,
        overrideConflicts,
        reason: timeOffReason,
        staffId: expandedStaffId,
        startLocal: `${timeOffStartDate}T00:00`,
        timezoneIana: timezone,
      });

      setTimeOffResult(response);

      if (response.ok) {
        setTimeOffReason("");
        router.refresh();
      }
    });
  }

  function cancelTimeOff(blockId: string) {
    setTimeOffResult(null);
    startTimeOffTransition(async () => {
      const response = await cancelStaffTimeBlockAction({ blockId });

      setTimeOffResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function clearWeek() {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Clear this weekly schedule?")
    ) {
      return;
    }

    setWeekState({
      key: weekStateKey,
      week: structuredClone(EMPTY_WEEK),
    });
  }

  if (staff.length === 0) {
    return (
      <section className="booking-setup-empty p-5 text-sm">
        No staff profiles are available.
      </section>
    );
  }

  return (
    <section
      className="booking-setup-panel"
      data-booking-setup-surface="availability"
      id="staff-availability"
    >
      <div className="booking-availability-head">
        <div>
          <h3>Staff availability</h3>
          <p>{timezone}</p>
        </div>
      </div>
      <div className="booking-availability-staff-list">
        <div className="booking-availability-staff-columns" aria-hidden="true">
          <span>Professional</span>
          <span>Online booking</span>
          <span>Weekly schedule</span>
          <span>Time off</span>
          <span>Expand</span>
        </div>
        {staff.map((member) => {
          const readiness = readinessByStaffId[member.id];
          const onlineStatus = onlineBookingStatus(member, readiness);
          const memberWeek =
            weeksByStaffId[member.id] ?? buildWeekDraft(availabilityRules, member.id);
          const rowWeek = expandedStaffId === member.id ? week : memberWeek;
          const weeklySummary = summarizeWeeklyHours(rowWeek);
          const timeOffBlocks = upcomingTimeOffForStaff(timeBlocks, member.id);
          const timeOffSummary = summarizeTimeOffBlocks(timeOffBlocks, timezone);
          const isExpanded = expandedStaffId === member.id;
          const setupIssueText =
            readiness && !readiness.ready
              ? readiness.reasons.map((reason) => reason.label).join(", ")
              : null;

          return (
            <article
              className={classNames(
                "booking-availability-staff-row",
                isExpanded && "booking-availability-staff-row--expanded",
              )}
              data-testid={`availability-staff-row-${member.id}`}
              key={member.id}
            >
              <div
                aria-controls={`availability-expanded-${member.id}`}
                aria-expanded={isExpanded}
                className="booking-availability-staff-summary"
                onClick={() => expandStaff(member.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) {
                    return;
                  }

                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    expandStaff(member.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="booking-availability-staff-cell booking-availability-professional">
                  <SetupStaffAvatar staff={member} />
                  <div>
                    <h4>{member.display_name}</h4>
                    <p>
                      {member.job_title || "Staff"} /{" "}
                      {member.is_active ? "Active" : "Inactive"}
                    </p>
                  </div>
                </div>

                <div className="booking-availability-staff-cell">
                  <span
                    className={classNames(
                      "booking-setup-chip",
                      onlineStatus.enabled
                        ? "booking-setup-chip--ready"
                        : "booking-setup-chip--muted",
                    )}
                  >
                    {onlineStatus.label}
                  </span>
                  <p>{onlineStatus.detail}</p>
                  <a
                    className="booking-availability-link"
                    href="/services"
                    onClick={(event) => event.stopPropagation()}
                  >
                    Manage Booking staff
                  </a>
                </div>

                <div className="booking-availability-staff-cell">
                  <strong>{weeklySummary}</strong>
                  <p>
                    {readiness?.workingRuleCount ?? 0} working rule
                    {(readiness?.workingRuleCount ?? 0) === 1 ? "" : "s"}
                  </p>
                  {setupIssueText ? (
                    <p className="booking-availability-issue">
                      Needs setup: {setupIssueText}
                    </p>
                  ) : null}
                </div>

                <div className="booking-availability-staff-cell">
                  <strong>{timeOffSummary}</strong>
                  {timeOffBlocks.length > 1 ? (
                    <p>Next {formatDateRangeText(timeOffBlocks[0], timezone)}</p>
                  ) : null}
                  <button
                    className="booking-availability-link-button"
                    disabled={!canManage}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isExpanded) {
                        expandStaff(member.id);
                      }
                    }}
                    type="button"
                  >
                    + Add time off
                  </button>
                </div>

                <button
                  aria-label={
                    isExpanded
                      ? `Collapse ${member.display_name}`
                      : `Expand ${member.display_name}`
                  }
                  aria-expanded={isExpanded}
                  className="booking-availability-chevron"
                  onClick={(event) => {
                    event.stopPropagation();
                    expandStaff(member.id);
                  }}
                  type="button"
                />
              </div>

              {isExpanded ? (
                <div
                  className="booking-availability-expanded"
                  id={`availability-expanded-${member.id}`}
                >
                  <section className="booking-availability-schedule-section">
                    <Message result={result} />

                    <div className="booking-availability-section-head">
                      <div>
                        <h4>Weekly schedule</h4>
                        <p>{weeklySummary}</p>
                      </div>
                      <div className="booking-availability-toolbar">
                        <details className="booking-availability-menu">
                          <summary>Apply preset</summary>
                          <button
                            disabled={!canManage}
                            onClick={() =>
                              setWeekState({
                                key: weekStateKey,
                                week: presetWeekdays(),
                              })
                            }
                            type="button"
                          >
                            Weekdays 9-5
                          </button>
                        </details>
                        <details className="booking-availability-menu">
                          <summary>More</summary>
                          <button
                            className="booking-availability-danger-action"
                            disabled={!canManage}
                            onClick={clearWeek}
                            type="button"
                          >
                            Clear week
                          </button>
                        </details>
                      </div>
                    </div>

                    {DAYS.every((day) => week[day.id].working.length === 0) ? (
                      <p className="booking-availability-empty-note">
                        No weekly availability yet.
                      </p>
                    ) : null}

                    <div className="booking-availability-week">
                      <div className="booking-availability-day-header">
                        <span>Day</span>
                        <span>Status</span>
                        <span>Working hours</span>
                        <span>Breaks</span>
                        <span>Actions</span>
                      </div>
                      {DAYS.map((day) => {
                        const dayDraft = week[day.id];
                        const enabled = dayDraft.working.length > 0;

                        return (
                          <section
                            className={classNames(
                              "booking-availability-day-row",
                              !enabled && "booking-availability-day-row--off",
                            )}
                            data-testid={`availability-day-${day.id}`}
                            key={day.id}
                          >
                            <div className="booking-availability-day-cell booking-availability-day-name">
                              <span className="booking-availability-mobile-label">
                                Day
                              </span>
                              <strong>{day.label}</strong>
                            </div>
                            <div className="booking-availability-day-cell">
                              <span className="booking-availability-mobile-label">
                                Status
                              </span>
                              <label className="booking-availability-status-toggle">
                                <input
                                  checked={enabled}
                                  disabled={!canManage}
                                  onChange={(event) =>
                                    toggleDay(day.id, event.target.checked)
                                  }
                                  type="checkbox"
                                />
                                <span>{enabled ? "Enabled" : "Off"}</span>
                              </label>
                            </div>
                            <div className="booking-availability-day-cell">
                              <span className="booking-availability-mobile-label">
                                Working hours
                              </span>
                              {enabled ? (
                                <IntervalEditor
                                  addLabel="Add interval"
                                  disabled={!canManage}
                                  intervals={dayDraft.working}
                                  label={`${day.label} working hours`}
                                  onAdd={() =>
                                    updateDay(day.id, "working", (intervals) => [
                                      ...intervals,
                                      defaultWorkingInterval(),
                                    ])
                                  }
                                  onRemove={(index) =>
                                    updateDay(day.id, "working", (intervals) =>
                                      intervals.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                                    )
                                  }
                                  onUpdate={(index, next) =>
                                    updateDay(day.id, "working", (intervals) =>
                                      intervals.map((interval, itemIndex) =>
                                        itemIndex === index
                                          ? { ...interval, ...next }
                                          : interval,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <span className="booking-availability-muted">-</span>
                              )}
                            </div>
                            <div className="booking-availability-day-cell">
                              <span className="booking-availability-mobile-label">
                                Breaks
                              </span>
                              {enabled ? (
                                <IntervalEditor
                                  addLabel="Add break"
                                  disabled={!canManage}
                                  emptyText="No breaks"
                                  intervals={dayDraft.breaks}
                                  label={`${day.label} breaks`}
                                  onAdd={() =>
                                    updateDay(day.id, "breaks", (intervals) => [
                                      ...intervals,
                                      defaultBreakInterval(),
                                    ])
                                  }
                                  onRemove={(index) =>
                                    updateDay(day.id, "breaks", (intervals) =>
                                      intervals.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      ),
                                    )
                                  }
                                  onUpdate={(index, next) =>
                                    updateDay(day.id, "breaks", (intervals) =>
                                      intervals.map((interval, itemIndex) =>
                                        itemIndex === index
                                          ? { ...interval, ...next }
                                          : interval,
                                      ),
                                    )
                                  }
                                />
                              ) : (
                                <span className="booking-availability-muted">-</span>
                              )}
                            </div>
                            <div className="booking-availability-day-cell booking-availability-actions-cell">
                              <span className="booking-availability-mobile-label">
                                Actions
                              </span>
                              {enabled ? (
                                <button
                                  className="booking-availability-link-button"
                                  disabled={!canManage}
                                  onClick={() => startCopyDay(day.id)}
                                  type="button"
                                >
                                  Copy
                                </button>
                              ) : (
                                <button
                                  className="booking-availability-link-button"
                                  disabled={!canManage}
                                  onClick={() => toggleDay(day.id, true)}
                                  type="button"
                                >
                                  Enable
                                </button>
                              )}
                              {copySourceDay === day.id ? (
                                <div className="booking-availability-copy-panel">
                                  <p>Copy {day.label} to</p>
                                  <div>
                                    {DAYS.filter(
                                      (targetDay) => targetDay.id !== day.id,
                                    ).map((targetDay) => (
                                      <label key={targetDay.id}>
                                        <input
                                          checked={copyTargets.includes(
                                            targetDay.id,
                                          )}
                                          disabled={!canManage}
                                          onChange={(event) =>
                                            toggleCopyTarget(
                                              targetDay.id,
                                              event.target.checked,
                                            )
                                          }
                                          type="checkbox"
                                        />
                                        {targetDay.label}
                                      </label>
                                    ))}
                                  </div>
                                  <div className="booking-availability-copy-actions">
                                    <button
                                      className="booking-availability-link-button"
                                      disabled={
                                        !canManage || copyTargets.length === 0
                                      }
                                      onClick={() => copyDayToTargets(day.id)}
                                      type="button"
                                    >
                                      Apply
                                    </button>
                                    <button
                                      className="booking-availability-link-button"
                                      onClick={() => {
                                        setCopySourceDay(null);
                                        setCopyTargets([]);
                                      }}
                                      type="button"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </section>
                        );
                      })}
                    </div>

                    <StickySaveBar
                      canManage={canManage}
                      dirtyCount={weekDirty}
                      hideWhenClean
                      isPending={isPending}
                      onReset={() =>
                        setWeekState({ key: weekStateKey, week: initialWeek })
                      }
                      onSave={saveWeek}
                      resetLabel="Discard"
                      sticky={false}
                    />
                  </section>

                  <section
                    className="booking-availability-timeoff-panel"
                    data-testid="availability-time-off-section"
                  >
                    <div className="booking-availability-section-head">
                      <div>
                        <h4>Time off</h4>
                        <p>{timeOffSummary}</p>
                      </div>
                    </div>
                    <Message result={timeOffResult} />
                    <div className="booking-availability-timeoff-list">
                      {expandedTimeOffBlocks.length === 0 ? (
                        <p className="booking-availability-empty-note">
                          No upcoming time off.
                        </p>
                      ) : (
                        expandedTimeOffBlocks.map((block) => (
                          <div
                            className="booking-availability-timeoff-item"
                            key={block.id}
                          >
                            <div>
                              <strong>
                                {formatDateRangeText(block, timezone)}
                              </strong>
                              <p>
                                {formatDateTime(block.starts_at, timezone)} -{" "}
                                {formatDateTime(block.ends_at, timezone)}
                              </p>
                              {block.reason ? <p>{block.reason}</p> : null}
                            </div>
                            {canManage ? (
                              <button
                                aria-label={`Remove time off ${formatDateRangeText(
                                  block,
                                  timezone,
                                )}`}
                                className="booking-availability-link-button booking-availability-danger-action"
                                disabled={isTimeOffPending}
                                onClick={() => cancelTimeOff(block.id)}
                                type="button"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="booking-availability-timeoff-form">
                      <label>
                        <span>From date</span>
                        <input
                          className="booking-setup-field"
                          disabled={!canManage}
                          onChange={(event) =>
                            setTimeOffStartDate(event.target.value)
                          }
                          type="date"
                          value={timeOffStartDate}
                        />
                      </label>
                      <label>
                        <span>To date</span>
                        <input
                          className="booking-setup-field"
                          disabled={!canManage}
                          onChange={(event) =>
                            setTimeOffEndDate(event.target.value)
                          }
                          type="date"
                          value={timeOffEndDate}
                        />
                      </label>
                      <label>
                        <span>Reason</span>
                        <input
                          className="booking-setup-field"
                          disabled={!canManage}
                          onChange={(event) => setTimeOffReason(event.target.value)}
                          placeholder="Optional"
                          value={timeOffReason}
                        />
                      </label>
                      <button
                        className="booking-setup-primary-button disabled:opacity-50"
                        disabled={!canManage || isTimeOffPending}
                        onClick={() => createTimeOff(false)}
                        type="button"
                      >
                        Add time off
                      </button>
                    </div>
                    {!timeOffResult?.ok && timeOffResult?.conflicts?.length ? (
                      <button
                        className="booking-setup-secondary-button w-fit border-amber-300 text-amber-900"
                        disabled={!canManage || isTimeOffPending}
                        onClick={() => createTimeOff(true)}
                        type="button"
                      >
                        Save time off with override
                      </button>
                    ) : null}
                    <p className="booking-availability-timeoff-note">
                      Edit ranges by removing them and adding the corrected dates.
                    </p>
                  </section>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export type BookingSetupEditorData = Pick<
  BookingSetupData,
  | "assignments"
  | "availabilityRules"
  | "permissions"
  | "readinessByStaffId"
  | "services"
  | "staff"
  | "timeBlocks"
  | "timezone"
>;
