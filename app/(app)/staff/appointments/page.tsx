import { StaffScheduleInteractions, StaffAppointmentStatus } from "@/app/staff/appointments/staff-schedule-interactions";
import { StaffScheduleCalendar } from "@/app/staff/appointments/staff-schedule-calendar";
import { StaffConfirmBookingButton } from "@/app/staff/appointments/staff-confirm-booking-button";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { StaffNoShowButton } from "@/app/staff/appointments/staff-no-show-button";
import { StaffCreateAppointment } from "@/app/staff/appointments/staff-create-appointment";
import { StaffBookingSettings } from "@/app/staff/appointments/staff-booking-settings-client";
import {
  getCurrentStaffAppointments,
  type StaffAppointmentLine,
  type StaffAppointmentsData,
  type StaffAppointmentsSearchParams,
} from "@/lib/staff-appointments";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

type StaffAppointmentsPageProps = {
  searchParams?: Promise<StaffAppointmentsSearchParams>;
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

function StatusBadge({ status, kind }: {status:string; kind?:import("@/lib/booking-no-show").NoShowKind}) {
  return (
    <span
      className={classNames(
        "staff-appointments-status-badge inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold",
        statusTone(status),
      )}
    >
      {status === "no_show" ? bookingStatusLabel(status,kind) : STATUS_LABELS[status] ?? status}
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
  const today = todayInTimeZone(data.timezone);
  const tomorrow = addDays(today, 1);
  const prefix = selectedDate === today ? "Today, " : selectedDate === tomorrow ? "Tomorrow, " : "";
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`));
  return <header className="staff-appointments-header"><div className="staff-appointments-frame staff-schedule-header">
    <nav className="staff-schedule-tabs" aria-label="Schedule navigation">
      <Link className="staff-schedule-tab" aria-current={selectedDate === today && data.view === "day" ? "page" : undefined} href={buildHref(params, {date: today, view: "day"})}><CalendarIcon /><span>Today</span></Link>
      <Link className="staff-schedule-tab" aria-current={selectedDate === tomorrow && data.view === "day" ? "page" : undefined} href={buildHref(params, {date: tomorrow, view: "day"})}><ChevronIcon direction="right" /><span>Next day</span></Link>
      <StaffScheduleCalendar date={selectedDate} range={firstParam(params.range) === "all" ? "all" : firstParam(params.range) === "next7" || data.view === "week" ? "next7" : "day"} status={firstParam(params.status) ?? ""} />
      {data.staff && salonId ? <StaffBookingSettings salonId={salonId} assignedServices={data.assignedServices} availabilityRules={data.availabilityRules} salonBookingStatus={data.salonBookingStatus} staff={data.staff} timeBlocks={data.timeBlocks} timezone={data.timezone} variant="toolbar" /> : null}
    </nav>
    <div className="staff-schedule-date-line"><h1>{prefix}{label}</h1><div className="staff-schedule-heading-actions"><span title="Your future bookings across all dates">{data.upcomingCount} upcoming</span>{data.staff && salonId ? <StaffCreateAppointment salonId={salonId} date={selectedDate} /> : null}</div></div>
  </div></header>;
}

function AppointmentSummary({
  appointment,
  compact = false,
  showDate = true,
  timezone,
}: {
  appointment: StaffAppointmentLine;
  compact?: boolean;
  params: StaffAppointmentsSearchParams;
  showDate?: boolean;
  timezone: string;
}) {
  const displayStatus = appointmentDisplayStatus(appointment);
  const minutes = Math.max(0, Math.round((Date.parse(appointment.endAt) - Date.parse(appointment.startAt)) / 60000));
  return <details name="staff-appointment" className={classNames("staff-schedule-appointment", compact && "staff-schedule-appointment--compact")} data-status={displayStatus}>
    <summary className="staff-schedule-row">
      <div className="staff-schedule-time">{showDate ? <span>{formatAppointmentDate(appointment.startAt, timezone)}</span> : null}<strong>{formatTime(appointment.startAt, timezone)}</strong></div>
      <div className="staff-schedule-customer"><strong>{appointment.customerName}</strong><span>{appointment.serviceName} · {minutes} min · {formatPrice(appointment.price)}</span></div>
      <StaffAppointmentStatus bookingId={appointment.bookingId}><StatusBadge status={displayStatus} kind={appointment.noShowKind} /></StaffAppointmentStatus><span className="staff-schedule-expand" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
    </summary>
    <AppointmentExpanded appointment={appointment} />
  </details>;
}

function formatPrice(price: number) {
  return Number.isFinite(price) ? new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 2}).format(price) : "Price unavailable";
}

function AppointmentExpanded({appointment}: {appointment: StaffAppointmentLine}) {
  const active = !["cancelled", "no_show", "completed"].includes(appointment.status);
  const eligible = active && !appointment.ticketId && ["pending", "confirmed"].includes(appointment.status) && appointment.lineStatus === "scheduled" && appointment.noShowEligible;
  return <div className="staff-schedule-expanded">
    <dl className="staff-schedule-contact">
      <div><dt>Phone</dt><dd>{appointment.customerPhone ? <a href={`tel:${appointment.customerPhone.replace(/[^+\d]/g, "")}`}>{appointment.customerPhone}</a> : "No phone provided"}</dd></div>
      {appointment.publicNotes ? <div><dt>Customer note</dt><dd>{appointment.publicNotes}</dd></div> : null}
      {appointment.serviceNote ? <div><dt>Service note</dt><dd>{appointment.serviceNote}</dd></div> : null}
      {appointment.noShowCount > 0 ? <div><dt>No-show history</dt><dd>{appointment.noShowCount} previous {appointment.noShowCount === 1 ? "no-show" : "no-shows"} without a reason</dd></div> : null}
      {appointment.noShowReason ? <div><dt>No-show note</dt><dd>{appointment.noShowReason}</dd></div> : null}
      <AppointmentInspiration appointment={appointment} />
    </dl>
    <div className="staff-schedule-row-actions">
      {active && appointmentRequiresConfirmation(appointment) ? <StaffConfirmBookingButton bookingId={appointment.bookingId} /> : null}
      <StaffNoShowButton bookingId={appointment.bookingId} confirmed={!appointmentRequiresConfirmation(appointment)} eligible={eligible} />
    </div>
  </div>;
}

function NextAppointmentDays({
  data,
  params,
}: {
  data: StaffAppointmentsData;
  params: StaffAppointmentsSearchParams;
}) {
  const appointments = data.nextAppointmentDays.appointments;
  const date = data.days[0]?.date;
  const weekHref = buildHref(params, {
    date,
    view: "week",
  });

  return (
    <aside className="staff-appointments-day-next-panel">
      <div className="staff-appointments-day-next-head">
        <div>
          <h3>Next appointments</h3>
          <p>{appointments.length} upcoming this week</p>
        </div>
      </div>
      {appointments.length > 0 ? (
        <div className="staff-appointments-day-next-list">
          {appointments.map((appointment) => (
            <AppointmentSummary
              appointment={appointment}
              compact
              key={appointment.id}
              params={params}
              timezone={data.timezone}
            />
          ))}
          {data.nextAppointmentDays.hasMore ? (
            <Link className="staff-appointments-day-next-more" href={weekHref}>
              View more
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="staff-appointments-empty p-4 text-sm">
          No upcoming appointments later this week.
        </div>
      )}
    </aside>
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
  return <div aria-label={`Appointment for ${appointment.customerName}`} className={classNames("staff-appointments-quick-popover", className)} role="dialog" style={style}>
    <AppointmentExpanded appointment={appointment} />
    <Link className="staff-appointments-secondary-button" href={buildHref(params, {quickId: null})}>Close</Link>
  </div>;
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
  const statusLabel = displayStatus === "no_show" ? bookingStatusLabel(displayStatus,appointment.noShowKind) : STATUS_LABELS[displayStatus] ?? displayStatus;
  const timeRange = appointmentTimeRange(appointment, timezone);
  const isShortCard = itemPosition.height < 58;
  const cardLabel = `${appointment.customerName}, ${appointment.serviceName}, ${timeRange}, ${statusLabel}`;

  return (
    <>
      <Link
        aria-label={cardLabel}
        className={classNames(
          "staff-appointments-timeline-card",
          compact && "staff-appointments-timeline-card--compact",
          isShortCard && "staff-appointments-timeline-card--short",
        )}
        data-status={displayStatus}
        href={buildHref(params, { quickId: appointment.bookingId })}
        style={{ height: itemPosition.height, top: itemPosition.top }}
        title={cardLabel}
      >
        <span className="staff-appointments-timeline-card-head">
          <span className="staff-appointments-timeline-card-time">
            {timeRange}
          </span>
          <span className="staff-appointments-timeline-card-status">
            {statusLabel}
          </span>
        </span>
        <span className="staff-appointments-timeline-card-title">
          {appointment.customerName}
        </span>
        <span className="staff-appointments-timeline-card-service">
          {appointment.serviceName}
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
      <div className="staff-schedule-day-layout">
        <div className="staff-appointments-day-card-list staff-appointments-day-card-list--compact">
          {dayAppointments.length > 0 ? (
            dayAppointments.map((appointment) => (
              <AppointmentSummary
                appointment={appointment}
                compact
                key={appointment.id}
                params={params}
                showDate={false}
                timezone={data.timezone}
              />
            ))
          ) : (
            <div className="staff-appointments-empty p-4 text-sm">
              No assigned appointments for this day.
            </div>
          )}
        </div>
        {dayAppointments.length === 0 ? <NextAppointmentDays data={data} params={params} /> : null}
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
              {dayAppointments.length === 0 && dayBlocks.length === 0 ? (
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
              <div className="staff-appointments-week-mobile-heading">
                <h2>{day.label}</h2>
                <p>{dayAppointments.length ? `${dayAppointments.length} assigned` : "No appointments"}</p>
              </div>
              {dayAppointments.map((appointment) => (
                  <AppointmentSummary
                    appointment={appointment}
                    key={appointment.id}
                    params={params}
                    timezone={data.timezone}
                  />
                ))}
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
    <div className="staff-appointments-list">
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

  return <div className="staff-appointments-detail-overlay">
    <Link aria-label="Close appointment detail" className="staff-appointments-detail-backdrop" href={buildHref(params, {bookingId: null})} />
    <aside className="staff-appointments-detail-sheet" role="dialog" aria-label="Appointment information">
      <div className="staff-appointments-detail-head"><div><h2>{appointment.customerName}</h2><p>{formatDateTime(appointment.startAt, timezone)}</p><p>{appointment.serviceName} · {formatPrice(appointment.price)}</p></div><Link className="staff-appointments-detail-close" aria-label="Close appointment detail" href={buildHref(params, {bookingId: null})}>×</Link></div>
      <StaffAppointmentStatus bookingId={appointment.bookingId}><StatusBadge status={appointmentDisplayStatus(appointment)} kind={appointment.noShowKind} /></StaffAppointmentStatus>
      <AppointmentExpanded appointment={appointment} />
    </aside>
  </div>;
}

export default async function StaffAppointmentsPage({
  searchParams,
}: StaffAppointmentsPageProps) {
  const params = (await searchParams) ?? {};
  const data = await getCurrentStaffAppointments(params);
  const statusFilter = firstParam(params.status);
  if (["confirmed", "pending", "no_show"].includes(statusFilter ?? "")) {
    data.appointments = data.appointments.filter(item => appointmentDisplayStatus(item) === statusFilter);
    data.nextAppointmentDays.appointments = data.nextAppointmentDays.appointments.filter(item => appointmentDisplayStatus(item) === statusFilter);
  }
  const salonId = data.context.currentStaffSalon?.id ?? data.context.salonId;

  if (!data.context.user) {
    redirect("/login?next=/staff/appointments");
  }

  return (
    <StaffScheduleInteractions key={`${data.rangeStart}:${data.rangeEnd}:${data.appointments.map(item => `${item.id}:${item.status}:${item.confirmationStatus}`).join(",")}`}><main
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
    </main></StaffScheduleInteractions>
  );
}
