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
  useRef,
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
type AvailabilityStaff = Staff | BookingSetupData["staff"][number];
type AvatarStaff = Pick<Staff, "display_name" | "public_profile_photo_path"> &
  Partial<
    Pick<
      BookingSetupData["staff"][number],
      "staff_profile_avatar_url" | "staff_profile_display_name"
    >
  >;

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
  staff: AvatarStaff;
}) {
  const displayName = staff.staff_profile_display_name || staff.display_name;
  const avatarUrl =
    staff.staff_profile_avatar_url ??
    getStaffAvatarUrl(staff.public_profile_photo_path);

  return (
    <span className={classNames("booking-setup-avatar", className)}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="booking-setup-avatar__image" src={avatarUrl} />
      ) : (
        getInitials(displayName)
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

function compactWeeklyHours(week: Record<number, DayDraft>) {
  const days = [...DAYS.slice(1), DAYS[0]];
  const active = days.filter(day => week[day.id].working.length);
  if (!active.length) return "No hours set";
  const hours = formatIntervalList(week[active[0].id].working);
  if (!active.every(day => formatIntervalList(week[day.id].working) === hours)) return `${active.length} working days · varied hours`;
  const groups: string[] = [];
  for (let i = 0; i < days.length; i++) {
    if (!week[days[i].id].working.length) continue;
    const start = i;
    while (i + 1 < days.length && week[days[i + 1].id].working.length) i++;
    groups.push(start === i ? days[i].label : `${days[start].label}–${days[i].label}`);
  }
  return `${groups.join(", ")} · ${hours}`;
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
  staff: AvailabilityStaff,
  readiness?: StaffBookingReadiness | null,
) {
  const onlineServiceCount = readiness?.onlineAssignedServiceCount ?? 0;

  if (!staff.online_booking_enabled) {
    return { detail: "Online booking off", enabled: false, label: "Off" };
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
  onSaved,
  expectedSalonId,
  initiallyCollapsed = false,
  availabilityRules,
  canManage,
  readinessByStaffId,
  selectedStaffId,
  staff,
  timeBlocks,
  timezone,
}: {
  onSaved?: () => void | Promise<void>;
  expectedSalonId?: string;
  initiallyCollapsed?: boolean;
  availabilityRules: StaffAvailabilityRule[];
  canManage: boolean;
  readinessByStaffId: Record<string, StaffBookingReadiness>;
  selectedStaffId?: string | null;
  staff: AvailabilityStaff[];
  timeBlocks: StaffTimeBlock[];
  timezone: string;
}) {
  const router = useRouter();
  const firstStaffId = staff[0]?.id ?? "";
  const [editDay, setEditDay] = useState<number | null>(null);
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const saving = useRef(false);
  const timeOffSaving = useRef(false);
  const [savedWeeks, setSavedWeeks] = useState<Record<string, { source: string; week: Record<number, DayDraft> }>>({});
  const initialExpandedStaffId =
    (selectedStaffId && staff.some((member) => member.id === selectedStaffId)
      ? selectedStaffId
      : null) ||
    (initiallyCollapsed ? null : firstStaffId) ||
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
        ? savedWeeks[expandedStaffId]?.source === weekKey(weeksByStaffId[expandedStaffId])
          ? savedWeeks[expandedStaffId].week
          : weeksByStaffId[expandedStaffId] ?? buildWeekDraft(availabilityRules, expandedStaffId)
        : structuredClone(EMPTY_WEEK),
    [availabilityRules, expandedStaffId, weeksByStaffId, savedWeeks],
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
    if (initiallyCollapsed) window.history.replaceState(null, "", query ? `/bookings?${query}` : "/bookings");
    else router.replace(query ? `/bookings?${query}` : "/bookings", { scroll: false });
  }

  function expandStaff(staffId: string) {
    if (isPending || isTimeOffPending) return;
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
    setWeekState({key:weekStateKey, week:initialWeek});
    setCopyTargets([]);
    setEditDay(null);
    setShowCopy(false);
    setShowTimeOffForm(false);
    setTimeOffResult(null);
    setTimeOffReason("");
    setTimeOffStartDate(nextBlockDate);
    setTimeOffEndDate(nextBlockDate);
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
    if (!expandedStaffId || saving.current || !canManage) {
      return;
    }

    setResult(null);
    saving.current = true;
    startTransition(async () => {
      try {
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
        expectedSalonId,
        rules,
        staffId: expandedStaffId,
      });

      setResult(response);

      if (response.ok) {
        setSavedWeeks(current => ({...current, [expandedStaffId]: {source: weekKey(weeksByStaffId[expandedStaffId]), week: structuredClone(week)}}));
        setEditDay(null);
        if (onSaved) await onSaved();
      }
      } catch {
        setResult({ok:false, error:"Could not save hours. Your changes are still here. Please try again."});
      } finally { saving.current = false; }
    });
  }

  function createTimeOff(overrideConflicts = false) {
    if (!expandedStaffId || !canManage || timeOffSaving.current) {
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
    timeOffSaving.current = true;
    startTimeOffTransition(async () => {
      try {
      const response = await createStaffTimeBlockAction({
        expectedSalonId,
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
        setShowTimeOffForm(false);
        if (onSaved) await onSaved();
      }
      } catch { setTimeOffResult({ok:false,error:"Could not save time off. Please try again."}); }
      finally { timeOffSaving.current = false; }
    });
  }

  function cancelTimeOff(blockId: string) {
    if (!canManage || timeOffSaving.current) return;
    setTimeOffResult(null);
    timeOffSaving.current = true;
    startTimeOffTransition(async () => {
      try {
      const response = await cancelStaffTimeBlockAction({ blockId, expectedSalonId });

      setTimeOffResult(response);

      if (response.ok) {
        if (onSaved) await onSaved();
      }
      } catch { setTimeOffResult({ok:false,error:"Could not remove time off. Please try again."}); }
      finally { timeOffSaving.current = false; }
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

  if (initiallyCollapsed) {
    const orderedDays = [...DAYS.slice(1), DAYS[0]];
    const busy = isPending || isTimeOffPending;
    const renderIntervals = (dayId: number, target: keyof DayDraft) => <IntervalEditor
      addLabel={target === "working" ? "add hours" : "add break"}
      disabled={!canManage || busy}
      emptyText={target === "working" ? "Off" : "No breaks"}
      intervals={week[dayId][target]}
      label={`${DAYS.find(day => day.id === dayId)?.label} ${target === "working" ? "working hours" : "breaks"}`}
      onAdd={() => updateDay(dayId, target, intervals => [...intervals, target === "working" ? defaultWorkingInterval() : defaultBreakInterval()])}
      onRemove={index => target === "working" && week[dayId].working.length === 1 ? toggleDay(dayId, false) : updateDay(dayId, target, intervals => intervals.filter((_, i) => i !== index))}
      onUpdate={(index, next) => updateDay(dayId, target, intervals => intervals.map((value, i) => i === index ? {...value, ...next} : value))}
    />;
    return <section className="availability-compact" aria-label="Staff availability">
      <div className="availability-compact-heading"><span>Choose a professional to edit hours.</span></div>
      {staff.map(member => {
        const expanded = member.id === expandedStaffId;
        const serverWeek = weeksByStaffId[member.id];
        const memberWeek = expanded ? week : savedWeeks[member.id]?.source === weekKey(serverWeek) ? savedWeeks[member.id].week : serverWeek;
        const blocks = upcomingTimeOffForStaff(timeBlocks, member.id);
        const name = ("staff_profile_display_name" in member ? member.staff_profile_display_name : null) || member.display_name;
        // This status describes the existing online-booking switch, not guaranteed slot availability.
        const online = member.is_active && member.online_booking_enabled;
        return <article key={member.id} className="availability-compact-person" data-testid={`availability-staff-row-${member.id}`}>
          <button type="button" className="availability-person-toggle" aria-expanded={expanded} aria-controls={`compact-staff-${member.id}`} disabled={busy} onClick={() => expandStaff(member.id)}>
            <SetupStaffAvatar staff={member}/><span className="availability-person-name"><strong>{name}</strong>{!expanded ? <><small>{compactWeeklyHours(memberWeek)}</small>{blocks.length ? <small>Time off · {formatDateRangeText(blocks[0], timezone)}{blocks.length > 1 ? ` +${blocks.length - 1}` : ""}</small> : null}</> : null}</span><span className={online ? "availability-online" : "availability-offline"}>● {online ? "Online" : "Offline"}</span><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
          </button>
          {expanded ? <div id={`compact-staff-${member.id}`} className="availability-person-editor">
            <Message result={result}/>
            <div className="availability-compact-title"><h3>Weekly hours</h3>{canManage ? <button type="button" disabled={busy} onClick={() => {setShowCopy(!showCopy); if(copySourceDay === null) setCopySourceDay(orderedDays.find(day => week[day.id].working.length)?.id ?? 1);}}>Copy hours</button> : null}</div>
            {showCopy && canManage ? <fieldset className="availability-inline-editor" disabled={busy}><legend>Copy hours</legend>
              <label>From day<select value={copySourceDay ?? 1} onChange={event => {setCopySourceDay(Number(event.target.value)); setCopyTargets([]);}}>{orderedDays.map(day => <option key={day.id} value={day.id}>{day.label}</option>)}</select></label>
              <div className="availability-copy-days">{orderedDays.filter(day => day.id !== copySourceDay).map(day => <label key={day.id}><input type="checkbox" checked={copyTargets.includes(day.id)} onChange={event => toggleCopyTarget(day.id,event.target.checked)}/>{day.label}</label>)}</div>
              <button type="button" disabled={!copyTargets.length} onClick={() => {copyDayToTargets(copySourceDay ?? 1);setShowCopy(false);}}>Apply to selected days</button>
              <button type="button" onClick={() => {setWeekState({key:weekStateKey,week:presetWeekdays()});setShowCopy(false);}}>Use weekdays 9 AM–5 PM</button>
              <button type="button" className="availability-muted-action" onClick={clearWeek}>Clear week</button>
            </fieldset> : null}
            {orderedDays.map(day => <div key={day.id} className="availability-compact-day" data-testid={`availability-day-${day.id}`}>
              <button type="button" className="availability-day-toggle" aria-expanded={editDay === day.id} aria-controls={`compact-day-${member.id}-${day.id}`} disabled={busy} onClick={() => setEditDay(editDay === day.id ? null : day.id)}><strong>{day.label}</strong><span>{week[day.id].working.length ? formatIntervalList(week[day.id].working) : "Off"}{week[day.id].breaks.length ? <small>Break · {formatIntervalList(week[day.id].breaks)}</small> : null}</span><span aria-hidden="true">{editDay === day.id ? "⌃" : week[day.id].working.length ? "›" : "+"}</span></button>
              {editDay === day.id ? <fieldset id={`compact-day-${member.id}-${day.id}`} className="availability-inline-editor" disabled={!canManage || busy}><legend className="sr-only">{day.label} hours</legend>
                {renderIntervals(day.id,"working")}
                {week[day.id].working.length ? <><span className="availability-editor-label">Breaks</span>{renderIntervals(day.id,"breaks")}<button type="button" className="availability-muted-action" onClick={() => toggleDay(day.id,false)}>Set day off</button></> : null}
                <button type="button" disabled={false} onClick={() => setEditDay(null)}>Done</button>
              </fieldset> : null}
            </div>)}
            <div className="availability-compact-title availability-timeoff-title"><h3>Time off</h3>{canManage ? <button type="button" disabled={busy} aria-expanded={showTimeOffForm} onClick={() => {setShowTimeOffForm(!showTimeOffForm);setTimeOffResult(null);}}>+ Add</button> : null}</div>
            <Message result={timeOffResult}/>
            {!blocks.length ? <p className="availability-empty">No upcoming time off.</p> : blocks.map(block => <details key={block.id} className="availability-timeoff-item"><summary><span aria-hidden="true">▦</span><span><strong>{formatDateRangeText(block, timezone)}</strong>{block.reason ? <small>{block.reason}</small> : null}</span><span aria-hidden="true">›</span></summary><div className="availability-timeoff-detail"><p>{formatDateTime(block.starts_at,timezone)} – {formatDateTime(block.ends_at,timezone)}</p>{canManage ? <button type="button" disabled={busy} onClick={() => cancelTimeOff(block.id)}>Remove time off</button> : null}<small>To change dates, remove this entry and add the corrected range.</small></div></details>)}
            {showTimeOffForm ? <fieldset className="availability-inline-editor" disabled={!canManage || busy}>
              <legend>Add time off</legend><div className="availability-date-range"><label>From<input type="date" value={timeOffStartDate} onChange={event => {setTimeOffStartDate(event.target.value);if(event.target.value > timeOffEndDate)setTimeOffEndDate(event.target.value);}}/></label><label>To<input type="date" min={timeOffStartDate} value={timeOffEndDate} onChange={event => setTimeOffEndDate(event.target.value)}/></label></div>
              <label>Reason (optional)<input value={timeOffReason} onChange={event => setTimeOffReason(event.target.value)}/></label>
              <button type="button" onClick={() => createTimeOff(false)}>{isTimeOffPending ? "Saving…" : "Add time off"}</button>
              {!timeOffResult?.ok && timeOffResult?.conflicts?.length ? <button type="button" onClick={() => createTimeOff(true)}>Save time off with override</button> : null}
            </fieldset> : null}
            <p className="availability-empty">{canManage ? "Tap a day to edit hours or add a break." : "You have read-only availability access."}</p>
            {weekDirty && canManage ? <div className="availability-compact-save"><button type="button" disabled={busy} onClick={saveWeek}>{isPending ? "Saving…" : "Save changes"}</button><span>Unsaved changes</span><button type="button" disabled={busy} className="availability-discard" onClick={() => setWeekState({key:weekStateKey,week:initialWeek})}>Discard</button></div> : null}
          </div> : null}
        </article>;
      })}
    </section>;
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
          const displayName =
            "staff_profile_display_name" in member
              ? member.staff_profile_display_name
              : member.display_name;
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
                    <h4>{displayName}</h4>
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
                      ? `Collapse ${displayName}`
                      : `Expand ${displayName}`
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
                        <details data-dismissible-popover className="booking-availability-menu">
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
                        <details data-dismissible-popover className="booking-availability-menu">
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
