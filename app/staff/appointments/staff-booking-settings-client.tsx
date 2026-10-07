"use client";

import {
  cancelStaffTimeBlockAction,
  createStaffTimeBlockAction,
  saveStaffWeeklyAvailabilityAction,
  type BookingSetupActionResult,
} from "@/app/booking-setup/actions";
import { TimeOffRangePicker } from "./time-off-range-picker";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import type { SalonOnlineBookingStatus } from "@/lib/booking-status";
import type { StaffAvailabilityRule, StaffTimeBlock } from "@/types/booking";

type StaffSettingsStaff = {
  displayName: string;
  id: string;
  jobTitle: string | null;
  onlineBookingEnabled: boolean;
};

type StaffSettingsService = {
  category: string | null;
  durationMinutes: number;
  id: string;
  name: string;
  onlineBookable: boolean;
};

type TimeIntervalDraft = {
  endsAt: string;
  startsAt: string;
};

type DayDraft = {
  working: TimeIntervalDraft[];
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

const EMPTY_WEEK = Object.fromEntries(
  DAYS.map((day) => [day.id, { working: [] }]),
) as Record<number, DayDraft>;

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function defaultWorkingInterval(): TimeIntervalDraft {
  return { endsAt: "17:00", startsAt: "09:00" };
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
  return `${formatTimeText(interval.startsAt)}-${formatTimeText(interval.endsAt)}`;
}

function weekKey(week: Record<number, DayDraft>) {
  return JSON.stringify(DAYS.map((day) => [day.id, week[day.id].working]));
}

function staffScopedRules(
  rules: StaffAvailabilityRule[],
  staffId: string,
  ruleType: StaffAvailabilityRule["rule_type"],
) {
  const activeRules = rules.filter(
    (rule) => rule.is_active && rule.rule_type === ruleType,
  );
  const staffRules = activeRules.filter((rule) => rule.staff_id === staffId);

  return staffRules.length > 0
    ? staffRules
    : activeRules.filter((rule) => !rule.staff_id);
}

function buildWeekDraft(
  rules: StaffAvailabilityRule[],
  staffId: string,
): Record<number, DayDraft> {
  const week = structuredClone(EMPTY_WEEK);

  for (const rule of staffScopedRules(rules, staffId, "working")) {
    week[rule.day_of_week].working.push({
      endsAt: rule.ends_at_local.slice(0, 5),
      startsAt: rule.starts_at_local.slice(0, 5),
    });
  }

  for (const day of DAYS) {
    week[day.id].working.sort((left, right) =>
      left.startsAt.localeCompare(right.startsAt),
    );
  }

  return week;
}

function summarizeWeeklyHours(week: Record<number, DayDraft>) {
  const enabledDays = DAYS.filter((day) => week[day.id].working.length > 0);

  if (enabledDays.length === 0) {
    return "No booking hours";
  }

  const firstSummary = week[enabledDays[0].id].working
    .map(formatIntervalRange)
    .join(", ");
  const sameHours = enabledDays.every(
    (day) =>
      week[day.id].working.map(formatIntervalRange).join(", ") === firstSummary,
  );
  const visibleDays = enabledDays.map((day) => day.label).slice(0, 5).join(", ");
  const extra = enabledDays.length > 5 ? ` +${enabledDays.length - 5}` : "";

  return sameHours
    ? `${visibleDays}${extra} / ${firstSummary}`
    : `${enabledDays.length} available days`;
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatTimeOff(block: StaffTimeBlock, timezone: string) {
  const localTime = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  if (localTime(block.starts_at) === "00:00" && localTime(block.ends_at) === "00:00") {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", year: "numeric" });
    const first = formatter.format(new Date(block.starts_at));
    const last = formatter.format(new Date(Date.parse(block.ends_at) - 1));
    return first === last ? first : `${first} – ${last}`;
  }
  return `${formatDateTime(block.starts_at, timezone)} – ${formatDateTime(block.ends_at, timezone)}`;
}

function nextLocalDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "00";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

function upcomingOwnTimeOff(blocks: StaffTimeBlock[], staffId: string) {
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

function statusCopy(input: {
  assignedServices: StaffSettingsService[];
  salonBookingStatus: SalonOnlineBookingStatus;
  staff: StaffSettingsStaff;
  week: Record<number, DayDraft>;
}) {
  const onlineServiceCount = input.assignedServices.filter(
    (service) => service.onlineBookable,
  ).length;
  const hasHours = DAYS.some((day) => input.week[day.id].working.length > 0);

  if (!input.salonBookingStatus.onlineBookingOpen) {
    const isBookingOff = input.salonBookingStatus.state === "booking_off";

    return {
      body: "Your personal booking settings are saved, but the salon is not currently accepting online bookings.",
      label: isBookingOff ? "Salon off" : "Salon paused",
      tone: "attention" as const,
    };
  }

  if (!input.staff.onlineBookingEnabled) {
    return {
      body: "The salon is accepting online bookings, but you're currently unavailable online.",
      label: "Off for you",
      tone: "off" as const,
    };
  }

  if (!hasHours) {
    return {
      body: "Set the hours when customers can book you.",
      label: "Booking hours needed",
      tone: "attention" as const,
    };
  }

  if (onlineServiceCount === 0) {
    return {
      body: "Services are assigned by the salon owner.",
      label: "No services",
      tone: "attention" as const,
    };
  }

  return {
    body: "You're accepting online appointments.",
    label: "Online booking active",
    tone: "ready" as const,
  };
}

function Message({ result }: { result: BookingSetupActionResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <div
      className={classNames(
        "staff-booking-settings-message",
        result.ok
          ? "staff-booking-settings-message--ok"
          : "staff-booking-settings-message--error",
      )}
    >
      {result.ok ? "Saved." : result.error ?? "Save failed."}
      {!result.ok && result.conflicts && result.conflicts.length > 0 ? (
        <ul>
          {result.conflicts.slice(0, 3).map((conflict) => (
            <li key={conflict.booking_line_id}>
              {conflict.customer_name} / {conflict.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function StaffBookingSettings({
  salonId,
  assignedServices,
  availabilityRules,
  salonBookingStatus,
  staff,
  timeBlocks,
  timezone,
  variant = "summary",
}: {
  salonId: string;
  assignedServices: StaffSettingsService[];
  availabilityRules: StaffAvailabilityRule[];
  salonBookingStatus: SalonOnlineBookingStatus;
  staff: StaffSettingsStaff;
  timeBlocks: StaffTimeBlock[];
  timezone: string;
  variant?: "summary" | "toolbar";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preferences, setPreferences] = useState<{ online: boolean; notifications: boolean } | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  const [preferencePending, startPreferenceTransition] = useTransition();
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const preferenceReadVersion = useRef(0);
  async function requestPreferences(change?: { preference: "online" | "notifications"; enabled: boolean }) {
    try {
      const response = await fetch("/api/staff/booking-preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salonId, ...change }),
      });
      return await response.json() as { ok: boolean; online: boolean; notifications: boolean; error?: string };
    } catch {
      return { ok: false, online: false, notifications: false, error: "Unable to save preferences. Please try again." };
    }
  }
  async function openSettings() {
    setOpen(true);
    if (preferencePending) return;
    const readVersion = ++preferenceReadVersion.current;
    setPreferences(null);
    setPreferenceError("");
    const response = await requestPreferences();
    if (readVersion !== preferenceReadVersion.current) return;
    if (response.ok) setPreferences(response);
    else setPreferenceError(response.error ?? "Unable to save preferences.");
  }
  function togglePreference(preference: "online" | "notifications") {
    if (!preferences) return;
    preferenceReadVersion.current++;
    setPreferenceError("");
    startPreferenceTransition(async () => {
      const response = await requestPreferences({ preference, enabled: !preferences[preference] });
      if (response.ok) { setPreferences(response); }
      else setPreferenceError(response.error ?? "Unable to save preferences.");
    });
  }
  const initialWeek = useMemo(
    () => buildWeekDraft(availabilityRules, staff.id),
    [availabilityRules, staff.id],
  );
  const initialWeekKey = weekKey(initialWeek);
  const [weekState, setWeekState] = useState({
    key: initialWeekKey,
    week: initialWeek,
  });
  const week = weekState.key === initialWeekKey ? weekState.week : initialWeek;
  const weekDirty = weekKey(week) !== initialWeekKey;
  const [result, setResult] = useState<BookingSetupActionResult | null>(null);
  const [timeOffResult, setTimeOffResult] =
    useState<BookingSetupActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isTimeOffPending, startTimeOffTransition] = useTransition();
  const nextDate = useMemo(() => nextLocalDate(timezone), [timezone]);
  const [timeOffStartDate, setTimeOffStartDate] = useState(nextDate);
  const [timeOffEndDate, setTimeOffEndDate] = useState(nextDate);
  const [timeOffReason, setTimeOffReason] = useState("");
  const ownTimeOff = upcomingOwnTimeOff(timeBlocks, staff.id);
  const status = statusCopy({
    assignedServices,
    salonBookingStatus,
    staff: { ...staff, onlineBookingEnabled: preferences?.online ?? staff.onlineBookingEnabled },
    week,
  });
  const staffBreakRules = availabilityRules.filter(
    (rule) =>
      rule.is_active && rule.staff_id === staff.id && rule.rule_type === "break",
  );

  function updateDay(
    dayId: number,
    updater: (intervals: TimeIntervalDraft[]) => TimeIntervalDraft[],
  ) {
    setWeekState({
      key: initialWeekKey,
      week: {
        ...week,
        [dayId]: {
          working: updater(week[dayId].working),
        },
      },
    });
  }

  function toggleDay(dayId: number, enabled: boolean) {
    updateDay(dayId, (intervals) =>
      enabled ? (intervals.length > 0 ? intervals : [defaultWorkingInterval()]) : [],
    );
  }

  function saveWeek() {
    const allIntervals = DAYS.flatMap(day => week[day.id].working);
    if (!allIntervals.length) {
      setResult({ ok: false, error: "Add a booking day, or switch online booking off to pause all days." });
      return;
    }
    for (const day of DAYS) {
      const intervals = [...week[day.id].working].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      if (intervals.some((interval, index) => !interval.startsAt || !interval.endsAt || interval.startsAt >= interval.endsAt || (index > 0 && intervals[index - 1].endsAt > interval.startsAt))) {
        setResult({ ok: false, error: `Check ${day.label}: each end time must follow its start, without overlapping intervals.` });
        return;
      }
    }
    const rules = DAYS.flatMap((day) =>
      week[day.id].working.map((interval) => ({
        dayOfWeek: day.id,
        endsAtLocal: interval.endsAt,
        ruleType: "working" as const,
        startsAtLocal: interval.startsAt,
        timezoneIana: timezone,
      })),
    );
    const preservedStaffBreaks = staffBreakRules.map((rule) => ({
      dayOfWeek: rule.day_of_week,
      effectiveEndDate: rule.effective_end_date,
      effectiveStartDate: rule.effective_start_date,
      endsAtLocal: rule.ends_at_local.slice(0, 5),
      ruleType: "break" as const,
      startsAtLocal: rule.starts_at_local.slice(0, 5),
      timezoneIana: rule.timezone_iana || timezone,
    }));

    setResult(null);
    startTransition(async () => {
      const response = await saveStaffWeeklyAvailabilityAction({
        rules: [...rules, ...preservedStaffBreaks],
        staffId: staff.id,
      });

      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function createTimeOff(overrideConflicts = false) {
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
        endLocal: `${new Date(Date.parse(`${timeOffEndDate}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)}T00:00`,
        overrideConflicts,
        reason: timeOffReason,
        staffId: staff.id,
        startLocal: `${timeOffStartDate}T00:00`,
        timezoneIana: timezone,
      });

      setTimeOffResult(response);

      if (response.ok) {
        setTimeOffReason("");
        setShowTimeOffForm(false);
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

  const trigger =
    variant === "toolbar" ? (
      <button
        className="staff-schedule-tab staff-booking-settings-trigger"
        onClick={openSettings}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg><span>Settings</span>
      </button>
    ) : (
      <section className="staff-booking-settings-summary">
        <div>
          <p className="staff-booking-settings-kicker">Online booking</p>
          <h2>{status.label}</h2>
          <p>{status.body}</p>
          <p className="staff-booking-settings-hours">
            {summarizeWeeklyHours(week)}
          </p>
        </div>
        <button
          className="staff-appointments-secondary-button"
          onClick={openSettings}
          type="button"
        >
          Booking settings
        </button>
      </section>
    );

  return (
    <>
      {trigger}

      {open ? (
        <div className="staff-booking-settings-overlay">
          <button
            aria-label="Close booking settings"
            className="staff-booking-settings-backdrop"
            onClick={() => setOpen(false)}
            type="button"
          />
          <aside
            aria-label="Booking settings"
            aria-modal="true"
            className="staff-booking-settings-sheet"
            role="dialog"
          >
            <div className="staff-booking-settings-head">
              <div>
                <p className="staff-booking-settings-kicker">Booking settings</p>
                <h2>{staff.displayName}</h2>
              </div>
              <button
                aria-label="Close booking settings"
                className="staff-appointments-icon-button"
                onClick={() => setOpen(false)}
                type="button"
              >
                x
              </button>
            </div>

            <div className="staff-booking-settings-content">
              <section className="staff-booking-settings-section">
                <div>
                  <h3>Online booking</h3>
                  <p>{status.body}</p>
                </div>
                <button type="button" role="switch" aria-label="Online booking" aria-checked={preferences?.online ?? staff.onlineBookingEnabled} disabled={!preferences || preferencePending} className="staff-settings-switch" onClick={() => togglePreference("online")}><span aria-hidden="true" />{(preferences?.online ?? staff.onlineBookingEnabled) ? "On" : "Off"}</button>
              </section>

              {preferenceError ? <p role="alert" className="staff-booking-settings-message staff-booking-settings-message--error">{preferenceError}</p> : null}
              <section className="staff-booking-settings-section staff-booking-settings-section--stack">
                <div className="staff-booking-settings-section-head">
                  <div>
                    <h3>Booking hours</h3>
                    <p>{summarizeWeeklyHours(week)}</p>
                  </div>
                  <button
                    className="staff-appointments-primary-button disabled:opacity-50"
                    disabled={!weekDirty || isPending}
                    onClick={saveWeek}
                    type="button"
                  >
                    {isPending ? "Saving" : "Save hours"}
                  </button>
                </div>
                <Message result={result} />
                <div className="staff-booking-hours-list">
                  {DAYS.filter(day => week[day.id].working.length > 0).map(day => (
                    <div className="staff-hours-line" key={day.id}>
                      <strong>{day.label}</strong>
                      <div className="staff-hours-times">
                        {week[day.id].working.map((interval, index) => <div className="staff-hours-pair" key={index}>
                          <input aria-label={`${day.label} start ${index + 1}`} type="time" value={interval.startsAt} onChange={event => updateDay(day.id, current => current.map((item, i) => i === index ? {...item, startsAt: event.target.value} : item))} />
                          <span>–</span>
                          <input aria-label={`${day.label} end ${index + 1}`} type="time" value={interval.endsAt} onChange={event => updateDay(day.id, current => current.map((item, i) => i === index ? {...item, endsAt: event.target.value} : item))} />
                          <button type="button" className="staff-small-remove" aria-label={`Remove ${day.label} interval ${index + 1}`} onClick={() => updateDay(day.id, current => current.filter((_, i) => i !== index))}>×</button>
                        </div>)}
                        <button type="button" className="staff-subtle-link" onClick={() => updateDay(day.id, current => [...current, defaultWorkingInterval()])}>add interval</button>
                      </div>
                    </div>
                  ))}
                  {DAYS.some(day => week[day.id].working.length === 0) ? <label className="staff-add-day"><span>Add day</span><select aria-label="Add day" value="" onChange={event => { if (event.target.value !== "") toggleDay(Number(event.target.value), true); }}><option value="" disabled>Choose day</option>{DAYS.filter(day => !week[day.id].working.length).map(day => <option key={day.id} value={day.id}>{day.label}</option>)}</select></label> : null}
                </div>
              </section>

              <section className="staff-booking-settings-section staff-booking-settings-section--stack">
                <div className="staff-booking-settings-section-head">
                  <div>
                    <h3>Time off</h3>
                    <p>
                      {ownTimeOff.length === 0
                        ? "No upcoming time off"
                        : `${ownTimeOff.length} upcoming range${
                            ownTimeOff.length === 1 ? "" : "s"
                          }`}
                    </p>
                  </div>
                </div>
                <Message result={timeOffResult} />
                <div className="staff-booking-timeoff-list">
                  {ownTimeOff.length === 0 ? (
                    <p className="staff-booking-settings-muted">
                      Time off added here is visible to Owner and blocks public slots.
                    </p>
                  ) : (
                    ownTimeOff.map((block) => (
                      <div className="staff-booking-timeoff-item" key={block.id}>
                        <div>
                          <strong>
                            {formatTimeOff(block, timezone)}
                          </strong>
                          {block.reason ? <p>{block.reason}</p> : null}
                        </div>
                        <button
                          className="staff-booking-settings-link staff-booking-settings-link--danger"
                          disabled={isTimeOffPending}
                          onClick={() => cancelTimeOff(block.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <button type="button" className="staff-subtle-link" onClick={() => { setShowTimeOffForm(!showTimeOffForm); setTimeOffResult(null); }}>{showTimeOffForm ? "Cancel" : ownTimeOff.length ? "+ Add more time off" : "+ Add time off"}</button>
                {showTimeOffForm ? <div className="staff-booking-timeoff-form">
                  <TimeOffRangePicker start={timeOffStartDate} end={timeOffEndDate} onChange={(start, end) => { setTimeOffStartDate(start); setTimeOffEndDate(end); setTimeOffResult(null); }} />
                  <p className="staff-booking-settings-muted">Full days off</p>
                  <label>
                    <span>Reason</span>
                    <input
                      className="staff-appointments-field"
                      onChange={(event) => setTimeOffReason(event.target.value)}
                      placeholder="Optional"
                      value={timeOffReason}
                    />
                  </label>
                  <button
                    className="staff-appointments-primary-button disabled:opacity-50"
                    disabled={isTimeOffPending}
                    onClick={() => createTimeOff(false)}
                    type="button"
                  >
                    Add time off
                  </button>
                </div> : null}
                {showTimeOffForm && !timeOffResult?.ok && timeOffResult?.conflicts?.length ? (
                  <button
                    className="staff-appointments-secondary-button staff-booking-settings-override disabled:opacity-50"
                    disabled={isTimeOffPending}
                    onClick={() => createTimeOff(true)}
                    type="button"
                  >
                    Save time off with override
                  </button>
                ) : null}
              </section>

              <section className="staff-booking-settings-section staff-booking-settings-section--stack">
                <div><h3>Bookable services</h3><p>Assigned by your salon · Read-only</p></div>
                {assignedServices.filter(service => service.onlineBookable).length ? <ul className="staff-settings-service-list">{assignedServices.filter(service => service.onlineBookable).map(service => <li key={service.id}><span>{service.name}</span><span>{service.durationMinutes} min</span></li>)}</ul> : <p>No online services assigned. Ask your salon to assign services.</p>}
              </section>
              <section className="staff-booking-settings-section">
                <div><h3>Booking notifications</h3><p>New bookings and changes. Existing notifications are kept.</p></div>
                <button type="button" role="switch" aria-label="Booking notifications" aria-checked={preferences?.notifications ?? true} disabled={!preferences || preferencePending} className="staff-settings-switch" onClick={() => togglePreference("notifications")}><span aria-hidden="true" />{preferences ? preferences.notifications ? "On" : "Off" : "…"}</button>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
