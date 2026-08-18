"use client";

import {
  cancelStaffTimeBlockAction,
  createStaffTimeBlockAction,
  saveStaffWeeklyAvailabilityAction,
  type BookingSetupActionResult,
} from "@/app/booking-setup/actions";
import { updateStaffOnlineBookingAction } from "@/app/staff/appointments/actions";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
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
  assignedServices,
  availabilityRules,
  salonBookingStatus,
  salonId,
  staff,
  timeBlocks,
  timezone,
  variant = "summary",
}: {
  assignedServices: StaffSettingsService[];
  availabilityRules: StaffAvailabilityRule[];
  salonBookingStatus: SalonOnlineBookingStatus;
  salonId: string;
  staff: StaffSettingsStaff;
  timeBlocks: StaffTimeBlock[];
  timezone: string;
  variant?: "summary" | "toolbar";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    staff,
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
        endLocal: `${timeOffEndDate}T23:59`,
        overrideConflicts,
        reason: timeOffReason,
        staffId: staff.id,
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

  const trigger =
    variant === "toolbar" ? (
      <button
        className="staff-appointments-secondary-button staff-booking-settings-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        Booking settings
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
          onClick={() => setOpen(true)}
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
                  <h3>Accept online bookings</h3>
                  <p>{status.body}</p>
                </div>
                <form action={updateStaffOnlineBookingAction}>
                  <input name="salon_id" type="hidden" value={salonId} />
                  <input
                    name="online_booking_enabled"
                    type="hidden"
                    value={staff.onlineBookingEnabled ? "false" : "true"}
                  />
                  <button
                    className={classNames(
                      "staff-booking-settings-toggle",
                      staff.onlineBookingEnabled &&
                        "staff-booking-settings-toggle--on",
                    )}
                    type="submit"
                  >
                    {staff.onlineBookingEnabled ? "On" : "Off"}
                  </button>
                </form>
              </section>

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
                  {DAYS.map((day) => {
                    const intervals = week[day.id].working;
                    const enabled = intervals.length > 0;

                    return (
                      <div
                        className={classNames(
                          "staff-booking-hours-row",
                          !enabled && "staff-booking-hours-row--off",
                        )}
                        key={day.id}
                      >
                        <div className="staff-booking-hours-day">
                          <strong>{day.label}</strong>
                          <label>
                            <input
                              checked={enabled}
                              onChange={(event) =>
                                toggleDay(day.id, event.target.checked)
                              }
                              type="checkbox"
                            />
                            <span>{enabled ? "Working" : "Off"}</span>
                          </label>
                        </div>
                        <div className="staff-booking-hours-intervals">
                          {enabled ? (
                            <>
                              {intervals.map((interval, index) => (
                                <div
                                  className="staff-booking-hours-interval"
                                  key={`${day.id}-${index}`}
                                >
                                  <input
                                    aria-label={`${day.label} start`}
                                    className="staff-appointments-field"
                                    onChange={(event) =>
                                      updateDay(day.id, (current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                startsAt: event.target.value,
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                    type="time"
                                    value={interval.startsAt}
                                  />
                                  <span>-</span>
                                  <input
                                    aria-label={`${day.label} end`}
                                    className="staff-appointments-field"
                                    onChange={(event) =>
                                      updateDay(day.id, (current) =>
                                        current.map((item, itemIndex) =>
                                          itemIndex === index
                                            ? {
                                                ...item,
                                                endsAt: event.target.value,
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                    type="time"
                                    value={interval.endsAt}
                                  />
                                  <button
                                    aria-label={`Remove ${day.label} interval`}
                                    className="staff-appointments-icon-button"
                                    onClick={() =>
                                      updateDay(day.id, (current) =>
                                        current.filter(
                                          (_, itemIndex) => itemIndex !== index,
                                        ),
                                      )
                                    }
                                    type="button"
                                  >
                                    x
                                  </button>
                                </div>
                              ))}
                              <button
                                className="staff-booking-settings-link"
                                onClick={() =>
                                  updateDay(day.id, (current) => [
                                    ...current,
                                    defaultWorkingInterval(),
                                  ])
                                }
                                type="button"
                              >
                                Add interval
                              </button>
                            </>
                          ) : (
                            <button
                              className="staff-booking-settings-link"
                              onClick={() => toggleDay(day.id, true)}
                              type="button"
                            >
                              Set hours
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
                    ownTimeOff.slice(0, 4).map((block) => (
                      <div className="staff-booking-timeoff-item" key={block.id}>
                        <div>
                          <strong>
                            {formatDateTime(block.starts_at, timezone)} -{" "}
                            {formatDateTime(block.ends_at, timezone)}
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
                <div className="staff-booking-timeoff-form">
                  <label>
                    <span>From</span>
                    <input
                      className="staff-appointments-field"
                      onChange={(event) => setTimeOffStartDate(event.target.value)}
                      type="date"
                      value={timeOffStartDate}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      className="staff-appointments-field"
                      onChange={(event) => setTimeOffEndDate(event.target.value)}
                      type="date"
                      value={timeOffEndDate}
                    />
                  </label>
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
                </div>
                {!timeOffResult?.ok && timeOffResult?.conflicts?.length ? (
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

              <section className="staff-booking-settings-section">
                <div>
                  <h3>Bookable services</h3>
                  <p>
                    {assignedServices.length > 0
                      ? `${assignedServices.length} assigned by salon`
                      : "No services assigned by salon"}
                  </p>
                </div>
                <span className="staff-booking-settings-readonly">Read-only</span>
              </section>

              <section className="staff-booking-settings-section">
                <div>
                  <h3>Booking notifications</h3>
                  <p>New bookings and booking changes are sent to notifications.</p>
                </div>
                <span className="staff-booking-settings-readonly">On</span>
              </section>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
