import {
  confirmStaffBookingAction,
  completeStaffAppointmentLineAction,
  startStaffAppointmentLineAction,
} from "@/app/staff/appointments/actions";
import { StaffBookingSettings } from "@/app/staff/appointments/staff-booking-settings-client";
import {
  getCurrentStaffAppointments,
  type StaffAppointmentLine,
  type StaffAppointmentsData,
  type StaffAppointmentsSearchParams,
  type StaffAppointmentView,
} from "@/lib/staff-appointments";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

type StaffAppointmentsPageProps = {
  searchParams?: Promise<StaffAppointmentsSearchParams>;
};

const VIEW_LABELS: Record<StaffAppointmentView, string> = {
  day: "Day",
  list: "List",
  week: "Week",
};

const STATUS_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  checked_in: "Checked in",
  completed: "Completed",
  confirmed: "Confirmed",
  in_service: "In service",
  no_show: "No-show",
  pending: "Pending",
  scheduled: "Confirmed",
};

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}`;
}

function dateParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    minutes: Number(getPart("hour")) * 60 + Number(getPart("minute")),
  };
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
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

function formatToolbarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "Today";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(`${value}T12:00:00Z`));
}

function todayInTimeZone(timeZone: string) {
  return dateParts(new Date().toISOString(), timeZone).date;
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function statusTone(status: string) {
  switch (status) {
    case "cancelled":
    case "no_show":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "checked_in":
    case "in_service":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-zinc-300 bg-white text-zinc-700";
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={classNames(
        "staff-appointments-status-badge inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold",
        statusTone(status),
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ConfirmationBadge({
  confirmationStatus,
}: {
  confirmationStatus: StaffAppointmentLine["confirmationStatus"];
}) {
  if (confirmationStatus !== "requested") {
    return null;
  }

  return (
    <span className="staff-appointments-confirmation-badge">
      Pending
    </span>
  );
}

function appointmentRequiresConfirmation(appointment: StaffAppointmentLine) {
  return (
    appointment.status === "pending" ||
    appointment.confirmationStatus === "requested"
  );
}

function appointmentDisplayStatus(appointment: StaffAppointmentLine) {
  return appointmentRequiresConfirmation(appointment)
    ? "pending"
    : appointment.status;
}

function formatAppointmentDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(new Date(value));
}

function buildHref(
  params: StaffAppointmentsSearchParams,
  next: Record<string, null | string | undefined>,
) {
  const query = new URLSearchParams();
  const date = firstParam(params.date);
  const view = firstParam(params.view);

  if (date) {
    query.set("date", date);
  }

  if (view) {
    query.set("view", view);
  }

  for (const [key, value] of Object.entries(next)) {
    if (!value) {
      continue;
    }

    query.set(key, value);
  }

  const queryString = query.toString();

  return queryString ? `/staff/appointments?${queryString}` : "/staff/appointments";
}

function Header({
  data,
  params,
  salonId,
}: {
  data: StaffAppointmentsData;
  params: StaffAppointmentsSearchParams;
  salonId: string | null;
}) {
  const selectedDate =
    firstParam(params.date) ?? data.days[0]?.date ?? todayInTimeZone(data.timezone);
  const step = data.view === "week" ? 7 : 1;
  const salonName =
    data.context.currentStaffSalon?.name ??
    data.context.salonName ??
    "Staff schedule";

  return (
    <header className="staff-appointments-header">
      <div className="staff-appointments-frame staff-appointments-header-frame">
        <div className="staff-appointments-titlebar">
          <div className="min-w-0">
            <p className="staff-appointments-title-kicker">Staff appointments</p>
            <h1>{salonName}</h1>
          </div>
          <p className="staff-appointments-title-date">
            {formatToolbarDate(selectedDate)}
          </p>
        </div>
        <div className="staff-appointments-toolbar">
          <div className="staff-appointments-toolbar-controls">
            <Link
              className="staff-appointments-secondary-button"
              href={buildHref(params, { date: todayInTimeZone(data.timezone) })}
            >
              Today
            </Link>
            <Link
              className="staff-appointments-icon-button"
              href={buildHref(params, { date: addDays(selectedDate, -step) })}
            >
              <ChevronIcon direction="left" />
              <span className="sr-only">Previous range</span>
            </Link>
            <div className="staff-appointments-date-display">
              <span>{formatToolbarDate(selectedDate)}</span>
              <CalendarIcon />
            </div>
            <Link
              className="staff-appointments-icon-button"
              href={buildHref(params, { date: addDays(selectedDate, step) })}
            >
              <ChevronIcon direction="right" />
              <span className="sr-only">Next range</span>
            </Link>
          </div>
          <div className="staff-appointments-toolbar-actions">
            <nav className="staff-appointments-view-tabs staff-appointments-toolbar-tabs">
              {(["list", "day", "week"] as const).map((view) => (
                <Link
                  aria-current={data.view === view ? "page" : undefined}
                  className={classNames(
                    "staff-appointments-view-tab",
                    data.view === view
                      ? "staff-appointments-view-tab--active"
                      : "staff-appointments-view-tab--idle",
                  )}
                  href={buildHref(params, { view })}
                  key={view}
                >
                  {VIEW_LABELS[view]}
                </Link>
              ))}
            </nav>
            {data.staff && salonId ? (
              <StaffBookingSettings
                assignedServices={data.assignedServices}
                availabilityRules={data.availabilityRules}
                salonBookingStatus={data.salonBookingStatus}
                salonId={salonId}
                staff={data.staff}
                timeBlocks={data.timeBlocks}
                timezone={data.timezone}
                variant="toolbar"
              />
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

function AppointmentSummary({
  appointment,
  params,
  timezone,
}: {
  appointment: StaffAppointmentLine;
  params: StaffAppointmentsSearchParams;
  timezone: string;
}) {
  const displayStatus = appointmentDisplayStatus(appointment);
  const isQuickOpen = firstParam(params.quickId) === appointment.bookingId;

  return (
    <article
      className="staff-appointments-card staff-appointments-appointment-card"
      data-status={displayStatus}
    >
      <Link
        className="staff-appointments-appointment-row"
        href={buildHref(params, { quickId: appointment.bookingId })}
      >
        <div className="staff-appointments-appointment-primary">
          <span>{formatAppointmentDate(appointment.startAt, timezone)}</span>
          <strong>{appointmentTimeRange(appointment, timezone)}</strong>
        </div>
        <div className="staff-appointments-appointment-main">
          <strong>{appointment.serviceName}</strong>
          <span>{appointment.customerName}</span>
        </div>
        <div className="staff-appointments-appointment-status">
          <StatusBadge status={displayStatus} />
        </div>
      </Link>
      {isQuickOpen ? (
        <QuickAppointmentPopover
          appointment={appointment}
          params={params}
        />
      ) : null}
    </article>
  );
}

function QuickAppointmentPopover({
  appointment,
  className,
  params,
  style,
}: {
  appointment: StaffAppointmentLine;
  className?: string;
  params: StaffAppointmentsSearchParams;
  style?: CSSProperties;
}) {
  const canConfirm =
    appointmentRequiresConfirmation(appointment) &&
    appointment.status !== "cancelled" &&
    appointment.status !== "no_show";

  return (
    <div
      aria-label={`Quick actions for ${appointment.customerName}`}
      className={classNames("staff-appointments-quick-popover", className)}
      role="dialog"
      style={style}
    >
      {canConfirm ? (
        <div className="staff-appointments-quick-actions">
          <form action={confirmStaffBookingAction}>
            <input name="booking_id" type="hidden" value={appointment.bookingId} />
            <button className="staff-appointments-primary-button" type="submit">
              Confirm
            </button>
          </form>
          <Link
            className="staff-appointments-secondary-button"
            href={buildHref(params, { quickId: null })}
          >
            Cancel
          </Link>
        </div>
      ) : (
        <div className="staff-appointments-quick-state">
          <StatusBadge status={appointmentDisplayStatus(appointment)} />
          <Link
            className="staff-appointments-secondary-button"
            href={buildHref(params, { quickId: null })}
          >
            Close
          </Link>
        </div>
      )}
      <Link
        className="staff-appointments-quick-detail"
        href={buildHref(params, { bookingId: appointment.bookingId })}
      >
        Detail
      </Link>
    </div>
  );
}

function timeToMinutes(value: string) {
  const [hour = "0", minute = "0"] = value.slice(0, 5).split(":");
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);

  if (!Number.isFinite(hourNumber) || !Number.isFinite(minuteNumber)) {
    return 0;
  }

  return hourNumber * 60 + minuteNumber;
}

function endTimeToMinutes(value: string) {
  const minutes = timeToMinutes(value);

  return minutes === 0 ? 24 * 60 : minutes;
}

function minutesLabel(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minute ? "2-digit" : undefined,
    timeZone: "UTC",
  }).format(date);
}

function dayOfWeek(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function effectiveRulesForStaff(
  data: StaffAppointmentsData,
  ruleType: "break" | "working",
) {
  const staffId = data.staff?.id;
  const activeRules = data.availabilityRules.filter(
    (rule) => rule.is_active && rule.rule_type === ruleType,
  );

  if (!staffId) {
    return activeRules.filter((rule) => !rule.staff_id);
  }

  const staffRules = activeRules.filter((rule) => rule.staff_id === staffId);

  return staffRules.length > 0
    ? staffRules
    : activeRules.filter((rule) => !rule.staff_id);
}

function isRuleEffectiveOnDate(
  rule: StaffAppointmentsData["availabilityRules"][number],
  date: string,
) {
  return (
    rule.day_of_week === dayOfWeek(date) &&
    (!rule.effective_start_date || rule.effective_start_date <= date) &&
    (!rule.effective_end_date || rule.effective_end_date >= date)
  );
}

function appointmentsForDate(data: StaffAppointmentsData, date: string) {
  return data.appointments.filter(
    (appointment) => dateParts(appointment.startAt, data.timezone).date === date,
  );
}

function blocksForDate(data: StaffAppointmentsData, date: string) {
  return data.timeBlocks.filter((block) => {
    const startDate = dateParts(block.starts_at, data.timezone).date;
    const endMs = new Date(block.ends_at).getTime();
    const inclusiveEnd = Number.isFinite(endMs)
      ? new Date(Math.max(0, endMs - 1)).toISOString()
      : block.ends_at;
    const endDate = dateParts(inclusiveEnd, data.timezone).date;

    return startDate <= date && endDate >= date;
  });
}

function timelineBounds(data: StaffAppointmentsData) {
  const appointmentStarts: number[] = [];
  const appointmentEnds: number[] = [];
  const workingStarts: number[] = [];
  const workingEnds: number[] = [];
  const workingRules = effectiveRulesForStaff(data, "working");

  for (const day of data.days) {
    for (const rule of workingRules) {
      if (!isRuleEffectiveOnDate(rule, day.date)) {
        continue;
      }

      workingStarts.push(timeToMinutes(rule.starts_at_local));
      workingEnds.push(endTimeToMinutes(rule.ends_at_local));
    }

    for (const appointment of appointmentsForDate(data, day.date)) {
      appointmentStarts.push(dateParts(appointment.startAt, data.timezone).minutes);
      appointmentEnds.push(dateParts(appointment.endAt, data.timezone).minutes);
    }
  }

  const starts = workingStarts.length > 0 ? workingStarts : appointmentStarts;
  const ends = workingEnds.length > 0 ? workingEnds : appointmentEnds;
  const start = Math.max(0, Math.min(...starts, 9 * 60));
  const end = Math.min(24 * 60, Math.max(...ends, 17 * 60));

  return {
    end: Math.max(end, start + 60),
    start,
  };
}

function timelineMetrics(data: StaffAppointmentsData) {
  const bounds = timelineBounds(data);
  const total = Math.max(60, bounds.end - bounds.start);
  const height = Math.max(320, Math.ceil(total / 60) * 72);
  const ticks: number[] = [];

  for (let tick = bounds.start; tick <= bounds.end; tick += 60) {
    ticks.push(tick);
  }

  if (ticks[ticks.length - 1] !== bounds.end) {
    ticks.push(bounds.end);
  }

  const position = (startMinutes: number, endMinutes: number) => {
    const visibleStart = Math.max(bounds.start, Math.min(bounds.end, startMinutes));
    const visibleEnd = Math.max(visibleStart + 1, Math.min(bounds.end, endMinutes));
    const top = ((visibleStart - bounds.start) / total) * height;
    const blockHeight = ((visibleEnd - visibleStart) / total) * height;

    return {
      height: Math.max(46, blockHeight),
      top,
    };
  };

  return { ...bounds, height, position, ticks, total };
}

function appointmentPosition(
  appointment: StaffAppointmentLine,
  timezone: string,
  metrics: ReturnType<typeof timelineMetrics>,
) {
  return metrics.position(
    dateParts(appointment.startAt, timezone).minutes,
    dateParts(appointment.endAt, timezone).minutes,
  );
}

function appointmentTimeRange(appointment: StaffAppointmentLine, timezone: string) {
  return `${formatTime(appointment.startAt, timezone)}-${formatTime(
    appointment.endAt,
    timezone,
  )}`;
}

function TimelineAppointmentCard({
  appointment,
  compact = false,
  metrics,
  params,
  timezone,
}: {
  appointment: StaffAppointmentLine;
  compact?: boolean;
  metrics: ReturnType<typeof timelineMetrics>;
  params: StaffAppointmentsSearchParams;
  timezone: string;
}) {
  const itemPosition = appointmentPosition(appointment, timezone, metrics);
  const displayStatus = appointmentDisplayStatus(appointment);
  const isQuickOpen = firstParam(params.quickId) === appointment.bookingId;

  return (
    <>
      <Link
        className={classNames(
          "staff-appointments-timeline-card",
          compact && "staff-appointments-timeline-card--compact",
        )}
        data-status={displayStatus}
        href={buildHref(params, { quickId: appointment.bookingId })}
        style={{ height: itemPosition.height, top: itemPosition.top }}
      >
        <span className="staff-appointments-status-dot" />
        <span className="staff-appointments-timeline-card-title">
          {appointment.customerName}
        </span>
        <span className="staff-appointments-timeline-card-service">
          {appointment.serviceName}
        </span>
        <span className="staff-appointments-timeline-card-time">
          {appointmentTimeRange(appointment, timezone)}
        </span>
        <span className="staff-appointments-timeline-card-status">
          {STATUS_LABELS[displayStatus] ?? displayStatus}
        </span>
      </Link>
      {isQuickOpen ? (
        <QuickAppointmentPopover
          appointment={appointment}
          className="staff-appointments-timeline-popover"
          params={params}
          style={{ top: itemPosition.top + Math.min(itemPosition.height, 52) }}
        />
      ) : null}
    </>
  );
}

function DayCanvas({
  data,
  params,
}: {
  data: StaffAppointmentsData;
  params: StaffAppointmentsSearchParams;
}) {
  const date = data.days[0]?.date;
  const dayAppointments = date ? appointmentsForDate(data, date) : [];

  return (
    <section className="staff-appointments-panel staff-appointments-day-board">
      <div className="staff-appointments-section-head staff-appointments-day-head">
        <div>
          <h2>{data.days[0]?.label}</h2>
          <p>{dayAppointments.length} assigned appointments</p>
        </div>
        <span>{data.timezone}</span>
      </div>
      <div className="staff-appointments-day-card-list">
        {dayAppointments.length > 0 ? (
          dayAppointments.map((appointment) => (
            <AppointmentSummary
              appointment={appointment}
              key={appointment.id}
              params={params}
              timezone={data.timezone}
            />
          ))
        ) : (
          <div className="staff-appointments-empty p-4 text-sm">
            No assigned appointments for this day.
          </div>
        )}
      </div>
    </section>
  );
}

function WeekView({
  data,
  params,
}: {
  data: StaffAppointmentsData;
  params: StaffAppointmentsSearchParams;
}) {
  const metrics = timelineMetrics(data);

  return (
    <section className="staff-appointments-panel staff-appointments-week-panel">
      <div className="staff-appointments-section-head staff-appointments-week-head">
        <div className="staff-appointments-week-head-gutter" />
        {data.days.map((day) => {
          return (
            <div className="staff-appointments-week-day-head" key={day.date}>
              <h2>{day.label}</h2>
              <p>{appointmentsForDate(data, day.date).length} assigned</p>
            </div>
          );
        })}
      </div>
      <div
        className="staff-appointments-week-timeline"
        style={{
          gridTemplateColumns: `72px repeat(${data.days.length}, minmax(0, 1fr))`,
        }}
      >
        <div className="staff-appointments-time-gutter" style={{ height: metrics.height }}>
          {metrics.ticks.map((hour) => (
            <div
              className="staff-appointments-time-label"
              key={hour}
              style={{ top: ((hour - metrics.start) / metrics.total) * metrics.height }}
            >
              {minutesLabel(hour)}
            </div>
          ))}
        </div>
        {data.days.map((day) => {
          const dayAppointments = appointmentsForDate(data, day.date);
          const dayBlocks = blocksForDate(data, day.date);

          return (
            <div
              className="staff-appointments-day-column"
              key={day.date}
              style={{ height: metrics.height }}
            >
              {metrics.ticks.map((hour) => (
                <div
                  className="staff-appointments-time-line"
                  key={hour}
                  style={{
                    top: ((hour - metrics.start) / metrics.total) * metrics.height,
                  }}
                />
              ))}
              {dayBlocks.map((block) => {
                const blockStart = dateParts(block.starts_at, data.timezone);
                const blockEnd = dateParts(block.ends_at, data.timezone);
                const blockPosition = metrics.position(
                  blockStart.date < day.date ? metrics.start : blockStart.minutes,
                  blockEnd.date > day.date || blockEnd.minutes === 0
                    ? metrics.end
                    : blockEnd.minutes,
                );

                return (
                  <div
                    className="staff-appointments-time-block"
                    key={block.id}
                    style={{ height: blockPosition.height, top: blockPosition.top }}
                  >
                    {block.reason || block.block_type.replace(/_/g, " ")}
                  </div>
                );
              })}
              {dayAppointments.map((appointment) => (
                <TimelineAppointmentCard
                  appointment={appointment}
                  compact
                  key={appointment.id}
                  metrics={metrics}
                  params={params}
                  timezone={data.timezone}
                />
              ))}
              {dayAppointments.length === 0 ? (
                <div className="staff-appointments-day-empty">No appointments</div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="staff-appointments-week-mobile">
        {data.days.map((day) => {
          const dayAppointments = appointmentsForDate(data, day.date);

          return (
            <section className="staff-appointments-week-mobile-day" key={day.date}>
              <div>
                <h2>{day.label}</h2>
                <p>{dayAppointments.length} assigned</p>
              </div>
              {dayAppointments.length === 0 ? (
                <p className="staff-appointments-empty p-4 text-sm">
                  No appointments
                </p>
              ) : (
                dayAppointments.map((appointment) => (
                  <AppointmentSummary
                    appointment={appointment}
                    key={appointment.id}
                    params={params}
                    timezone={data.timezone}
                  />
                ))
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ListView({
  data,
  params,
}: {
  data: StaffAppointmentsData;
  params: StaffAppointmentsSearchParams;
}) {
  if (data.appointments.length === 0) {
    return (
      <div className="staff-appointments-empty p-6 text-sm">
        No assigned appointments in this range.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {data.appointments.map((appointment) => (
        <AppointmentSummary
          appointment={appointment}
          key={appointment.id}
          params={params}
          timezone={data.timezone}
        />
      ))}
    </div>
  );
}

function AppointmentInspiration({
  appointment,
}: {
  appointment: StaffAppointmentLine;
}) {
  const inspiration = appointment.inspiration;

  if (!inspiration) {
    return null;
  }

  return (
    <div className="rounded-lg bg-zinc-50 p-3">
      <dt className="font-semibold text-zinc-950">Customer inspiration</dt>
      <dd className="mt-2 grid gap-3 sm:grid-cols-[80px_1fr]">
        <a
          className="block h-20 w-20 overflow-hidden rounded-lg bg-zinc-100"
          href={inspiration.imageUrl ?? undefined}
          rel="noreferrer"
          target={inspiration.imageUrl ? "_blank" : undefined}
        >
          {inspiration.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-full w-full object-cover" src={inspiration.imageUrl} />
          ) : (
            <span className="grid h-full w-full place-items-center text-sm font-semibold text-zinc-500">
              Look
            </span>
          )}
        </a>
        <span className="min-w-0 text-zinc-700">
          <span className="block font-semibold text-zinc-950">
            {inspiration.source_title_snapshot ?? "Booked look"}
          </span>
          <span className="mt-1 block text-sm">
            {[
              inspiration.service_name_snapshot,
              inspiration.credited_staff_name_snapshot
                ? `By ${inspiration.credited_staff_name_snapshot}`
                : null,
            ]
              .filter(Boolean)
              .join(" / ") || "Saved with this booking"}
          </span>
          {inspiration.source_caption_snapshot ? (
            <span className="mt-2 line-clamp-2 block text-sm text-zinc-600">
              {inspiration.source_caption_snapshot}
            </span>
          ) : null}
        </span>
      </dd>
    </div>
  );
}

function DetailPanel({
  appointment,
  canViewTickets,
  params,
  timezone,
}: {
  appointment: StaffAppointmentLine | null;
  canViewTickets: boolean;
  params: StaffAppointmentsSearchParams;
  timezone: string;
}) {
  if (!appointment) {
    return null;
  }

  const appointmentClosed =
    appointment.status === "cancelled" || appointment.status === "no_show";
  const requiresConfirmation = appointmentRequiresConfirmation(appointment);
  const canConfirm = requiresConfirmation && !appointmentClosed;
  const canStart =
    appointment.lineStatus === "scheduled" &&
    !requiresConfirmation &&
    !appointmentClosed;
  const canComplete =
    (appointment.lineStatus === "scheduled" ||
      appointment.lineStatus === "in_service") &&
    !requiresConfirmation &&
    !appointmentClosed;

  return (
    <div className="staff-appointments-detail-overlay">
      <Link
        aria-label="Close appointment detail"
        className="staff-appointments-detail-backdrop"
        href={buildHref(params, { bookingId: null })}
      />
      <aside className="staff-appointments-detail-sheet">
        <div className="staff-appointments-detail-head">
          <div>
            <p className="staff-appointments-detail-kicker">
              Appointment detail
            </p>
            <h2>
              {appointment.customerName}
            </h2>
            <p>
              {formatDateTime(appointment.startAt, timezone)}
            </p>
          </div>
          <Link
            aria-label="Close appointment detail"
            className="staff-appointments-detail-close"
            href={buildHref(params, { bookingId: null })}
          >
            x
          </Link>
        </div>
        <div className="staff-appointments-detail-body">
          <div className="staff-appointments-detail-badges">
            <StatusBadge status={appointmentDisplayStatus(appointment)} />
            <ConfirmationBadge confirmationStatus={appointment.confirmationStatus} />
            <span className="staff-appointments-line-status">
              Line: {appointment.lineStatus.replace(/_/g, " ")}
            </span>
            {appointment.ticketId && canViewTickets ? (
              <Link
                className="staff-appointments-ticket-link"
                href={`/pos-tickets/${appointment.ticketId}`}
              >
                Open ticket
              </Link>
            ) : null}
          </div>
          <dl className="staff-appointments-detail-list">
            <div>
              <dt>Service</dt>
              <dd>{appointment.serviceName}</dd>
            </div>
            <AppointmentInspiration appointment={appointment} />
            <div>
              <dt>Contact</dt>
              <dd>{appointment.customerPhone || "No day-of phone"}</dd>
            </div>
            <div>
              <dt>Customer note</dt>
              <dd>{appointment.publicNotes || "None"}</dd>
            </div>
          </dl>
          {appointmentClosed ? (
            <p className="staff-appointments-detail-muted">
              This appointment is no longer active.
            </p>
          ) : null}
          {requiresConfirmation ? (
            <div className="staff-appointments-warning staff-appointments-detail-warning">
              <p>Customer booking is waiting for confirmation.</p>
              <form action={confirmStaffBookingAction}>
                <input name="booking_id" type="hidden" value={appointment.bookingId} />
                <button
                  className="staff-appointments-primary-button disabled:opacity-50"
                  disabled={!canConfirm}
                  type="submit"
                >
                  Confirm booking
                </button>
              </form>
            </div>
          ) : null}
          <form
            action={startStaffAppointmentLineAction}
            className="staff-appointments-detail-form"
          >
            <input name="booking_line_id" type="hidden" value={appointment.id} />
            <label>
              <span>Service note</span>
              <textarea
                className="staff-appointments-field"
                defaultValue={appointment.serviceNote ?? ""}
                name="service_note"
              />
            </label>
            <div className="staff-appointments-detail-actions">
              <button
                className="staff-appointments-primary-button disabled:opacity-50"
                disabled={!canStart}
                type="submit"
              >
                Start service
              </button>
              <button
                className="staff-appointments-secondary-button disabled:opacity-50"
                formAction={completeStaffAppointmentLineAction}
                disabled={!canComplete}
                type="submit"
              >
                Complete service
              </button>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}

export default async function StaffAppointmentsPage({
  searchParams,
}: StaffAppointmentsPageProps) {
  const params = (await searchParams) ?? {};
  const data = await getCurrentStaffAppointments(params);
  const salonId = data.context.currentStaffSalon?.id ?? data.context.salonId;

  if (!data.context.user) {
    redirect("/login?next=/staff/appointments");
  }

  return (
    <main
      className="staff-appointments-root"
      data-staff-appointments-surface="staff"
    >
      <Header data={data} params={params} salonId={salonId} />
      <section className="staff-appointments-frame staff-appointments-body py-4">
        {!data.staff ? (
          <div className="staff-appointments-empty p-6 text-sm">
            No active staff profile is linked to this account for the selected
            staff workspace.
          </div>
        ) : data.view === "week" ? (
          <WeekView data={data} params={params} />
        ) : data.view === "list" ? (
          <ListView data={data} params={params} />
        ) : (
          <DayCanvas data={data} params={params} />
        )}
        <DetailPanel
          appointment={data.selectedAppointment}
          canViewTickets={data.canViewTickets}
          params={params}
          timezone={data.timezone}
        />
      </section>
    </main>
  );
}
