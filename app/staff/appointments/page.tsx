import {
  completeStaffAppointmentLineAction,
  startStaffAppointmentLineAction,
} from "@/app/staff/appointments/actions";
import {
  getCurrentStaffAppointments,
  type StaffAppointmentLine,
  type StaffAppointmentsData,
  type StaffAppointmentsSearchParams,
  type StaffAppointmentView,
} from "@/lib/staff-appointments";
import Link from "next/link";
import { redirect } from "next/navigation";

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
        "inline-flex w-fit rounded-md border px-2 py-1 text-xs font-semibold",
        statusTone(status),
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function SetupSummary({ data }: { data: StaffAppointmentsData }) {
  const readiness = data.bookingReadiness;
  const workingRules = data.availabilityRules.filter(
    (rule) => rule.rule_type === "working",
  );
  const breaks = data.availabilityRules.filter((rule) => rule.rule_type === "break");

  return (
    <section className="staff-appointments-panel grid gap-4 p-5">
      <div>
        <p className="text-xs font-semibold uppercase text-zinc-500">
          Booking setup
        </p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-950">
          {readiness?.ready ? "Booking ready" : "Needs setup"}
        </h2>
      </div>
      {readiness && readiness.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {readiness.reasons.map((reason) => (
            <span
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
              key={reason.code}
            >
              {reason.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 text-sm">
        <div>
          <p className="font-semibold text-zinc-950">Assigned services</p>
          <p className="mt-1 text-zinc-600">
            {data.assignedServices.length > 0
              ? data.assignedServices
                  .map(
                    (service) =>
                      `${service.name}${service.onlineBookable ? "" : " (offline)"}`,
                  )
                  .join(", ")
              : "None"}
          </p>
        </div>
        <div>
          <p className="font-semibold text-zinc-950">Recurring schedule</p>
          <p className="mt-1 text-zinc-600">
            {workingRules.length} working intervals / {breaks.length} breaks
          </p>
        </div>
        <div>
          <p className="font-semibold text-zinc-950">Upcoming blocks</p>
          <p className="mt-1 text-zinc-600">
            {data.timeBlocks.length > 0
              ? data.timeBlocks
                  .slice(0, 3)
                  .map((block) => block.reason || block.block_type.replace(/_/g, " "))
                  .join(", ")
              : "None"}
          </p>
        </div>
      </div>
    </section>
  );
}

function buildHref(params: StaffAppointmentsSearchParams, next: Record<string, string>) {
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
    query.set(key, value);
  }

  return `/staff/appointments?${query.toString()}`;
}

function Header({
  data,
  params,
}: {
  data: StaffAppointmentsData;
  params: StaffAppointmentsSearchParams;
}) {
  const selectedDate = firstParam(params.date) ?? data.days[0]?.date ?? "";
  const step = data.view === "week" ? 7 : 1;

  return (
    <div className="staff-appointments-header">
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-500">
              {data.context.currentOrganization?.name} /{" "}
              {data.context.currentStaffSalon?.name}
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
              Staff Appointments
            </h1>
            <p className="mt-2 text-sm text-zinc-600">
              Your assigned appointments, service notes, and schedule blocks.
            </p>
          </div>
          <nav className="staff-appointments-view-tabs">
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
        </div>
        <div className="staff-appointments-toolbar">
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
      </div>
    </div>
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
  return (
    <Link
      className="staff-appointments-card grid gap-2 p-3"
      href={buildHref(params, { bookingId: appointment.bookingId })}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-950">
            {formatTime(appointment.startAt, timezone)} -{" "}
            {formatTime(appointment.endAt, timezone)}
          </p>
          <p className="mt-1 text-sm text-zinc-700">{appointment.customerName}</p>
        </div>
        <StatusBadge status={appointment.status} />
      </div>
      <p className="text-sm text-zinc-600">{appointment.serviceName}</p>
      <p className="text-xs font-semibold text-zinc-500">
        Line: {appointment.lineStatus.replace(/_/g, " ")}
      </p>
    </Link>
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
  const dayAppointments = data.appointments.filter(
    (appointment) => dateParts(appointment.startAt, data.timezone).date === date,
  );
  const starts = dayAppointments.map(
    (appointment) => dateParts(appointment.startAt, data.timezone).minutes,
  );
  const ends = dayAppointments.map(
    (appointment) => dateParts(appointment.endAt, data.timezone).minutes,
  );
  const start = Math.max(0, Math.min(...starts, 9 * 60) - 60);
  const end = Math.min(24 * 60, Math.max(...ends, 18 * 60) + 60);
  const total = Math.max(240, end - start);
  const height = Math.max(420, Math.ceil(total / 60) * 68);
  const hours = Array.from({ length: Math.ceil(total / 60) + 1 }, (_, index) => start + index * 60);
  const position = (startAt: string, endAt: string) => {
    const top = ((dateParts(startAt, data.timezone).minutes - start) / total) * height;
    const blockHeight =
      ((dateParts(endAt, data.timezone).minutes -
        dateParts(startAt, data.timezone).minutes) /
        total) *
      height;

    return { height: Math.max(44, blockHeight), top };
  };

  return (
    <section className="staff-appointments-panel overflow-hidden">
      <div className="border-b border-[#e7dfe5] bg-[#fbfafb] px-4 py-3">
        <h2 className="font-semibold text-zinc-950">{data.days[0]?.label}</h2>
        <p className="mt-1 text-sm text-zinc-500">{data.timezone}</p>
      </div>
      <div className="grid grid-cols-[72px_minmax(0,1fr)]">
        <div className="relative bg-zinc-50" style={{ height }}>
          {hours.map((hour) => (
            <div
              className="absolute left-0 right-0 -translate-y-2 px-3 text-xs text-zinc-500"
              key={hour}
              style={{ top: ((hour - start) / total) * height }}
            >
              {Math.floor(hour / 60)}:00
            </div>
          ))}
        </div>
        <div className="relative" style={{ height }}>
          {hours.map((hour) => (
            <div
              className="absolute left-0 right-0 border-t border-zinc-100"
              key={hour}
              style={{ top: ((hour - start) / total) * height }}
            />
          ))}
          {data.timeBlocks.map((block) => {
            const blockPosition = position(block.starts_at, block.ends_at);

            return (
              <div
                className="absolute left-3 right-3 rounded-md border border-zinc-300 bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600"
                key={block.id}
                style={{ height: blockPosition.height, top: blockPosition.top }}
              >
                {block.reason || block.block_type.replace(/_/g, " ")}
              </div>
            );
          })}
          {dayAppointments.map((appointment) => {
            const itemPosition = position(appointment.startAt, appointment.endAt);

            return (
              <Link
                className="absolute left-3 right-3 rounded-md border border-[#642a56] bg-[#642a56] px-3 py-2 text-white shadow-sm"
                href={buildHref(params, { bookingId: appointment.bookingId })}
                key={appointment.id}
                style={{ height: itemPosition.height, top: itemPosition.top }}
              >
                <span className="block truncate text-sm font-semibold">
                  {appointment.customerName}
                </span>
                <span className="mt-1 block truncate text-xs text-zinc-200">
                  {appointment.serviceName}
                </span>
                <span className="mt-1 block text-xs text-zinc-300">
                  {appointment.lineStatus.replace(/_/g, " ")}
                </span>
              </Link>
            );
          })}
          {dayAppointments.length === 0 ? (
            <div className="staff-appointments-empty absolute inset-x-4 top-8 p-4 text-sm">
              No assigned appointments for this day.
            </div>
          ) : null}
        </div>
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
  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {data.days.map((day) => {
        const dayAppointments = data.appointments.filter(
          (appointment) => dateParts(appointment.startAt, data.timezone).date === day.date,
        );

        return (
          <section className="staff-appointments-panel overflow-hidden" key={day.date}>
            <div className="border-b border-[#e7dfe5] bg-[#fbfafb] px-3 py-2">
              <h2 className="text-sm font-semibold text-zinc-950">{day.label}</h2>
              <p className="text-xs text-zinc-500">
                {dayAppointments.length} assigned
              </p>
            </div>
            <div className="grid gap-2 p-2">
              {dayAppointments.length === 0 ? (
                  <p className="staff-appointments-empty px-3 py-6 text-sm">
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
            </div>
          </section>
        );
      })}
    </div>
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

function DetailPanel({
  appointment,
  canViewTickets,
  timezone,
}: {
  appointment: StaffAppointmentLine | null;
  canViewTickets: boolean;
  timezone: string;
}) {
  if (!appointment) {
    return (
      <aside className="staff-appointments-empty p-5 text-sm">
        Select an appointment to see service details.
      </aside>
    );
  }

  const canStart =
    appointment.lineStatus === "scheduled" &&
    appointment.status !== "cancelled" &&
    appointment.status !== "no_show";
  const canComplete =
    (appointment.lineStatus === "scheduled" ||
      appointment.lineStatus === "in_service") &&
    appointment.status !== "cancelled" &&
    appointment.status !== "no_show";

  return (
    <aside className="staff-appointments-panel grid gap-4 p-5">
      <div>
        <p className="text-xs font-semibold uppercase text-zinc-500">
          Appointment detail
        </p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-950">
          {appointment.customerName}
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          {formatDateTime(appointment.startAt, timezone)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <StatusBadge status={appointment.status} />
        <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
          Line: {appointment.lineStatus.replace(/_/g, " ")}
        </span>
        {appointment.ticketId && canViewTickets ? (
          <Link
            className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800"
            href={`/pos-tickets/${appointment.ticketId}`}
          >
            Open ticket
          </Link>
        ) : null}
      </div>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="font-semibold text-zinc-950">Service</dt>
          <dd className="text-zinc-700">{appointment.serviceName}</dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-950">Contact</dt>
          <dd className="text-zinc-700">
            {appointment.customerPhone || "No day-of phone"}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-950">Customer note</dt>
          <dd className="text-zinc-700">{appointment.publicNotes || "None"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-zinc-950">Service note</dt>
          <dd className="text-zinc-700">{appointment.serviceNote || "None"}</dd>
        </div>
      </dl>
      {appointment.status === "cancelled" || appointment.status === "no_show" ? (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
          This appointment is no longer active.
        </p>
      ) : null}
      <form action={startStaffAppointmentLineAction} className="grid gap-2">
        <input name="booking_line_id" type="hidden" value={appointment.id} />
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700">Service note</span>
          <textarea
            className="staff-appointments-field min-h-20 py-2"
            defaultValue={appointment.serviceNote ?? ""}
            name="service_note"
          />
        </label>
        <div className="flex flex-wrap gap-2">
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
    </aside>
  );
}

export default async function StaffAppointmentsPage({
  searchParams,
}: StaffAppointmentsPageProps) {
  const params = (await searchParams) ?? {};
  const data = await getCurrentStaffAppointments(params);

  if (!data.context.user) {
    redirect("/login?next=/staff/appointments");
  }

  return (
    <main
      className="staff-appointments-root"
      data-staff-appointments-surface="staff"
    >
      <Header data={data} params={params} />
      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="min-w-0">
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
        </div>
        <div className="grid h-fit gap-4">
          <DetailPanel
            appointment={data.selectedAppointment}
            canViewTickets={data.canViewTickets}
            timezone={data.timezone}
          />
          <SetupSummary data={data} />
        </div>
      </section>
    </main>
  );
}
