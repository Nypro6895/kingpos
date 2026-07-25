import { getPortableTicketData } from "@/app/pos/portable/actions";

type PortableTicketPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatDate(value: string, timeZone: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function isDateInputValue(value: string | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ");
}

function statusClass(value: string) {
  if (value === "closed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (value === "cancelled" || value === "voided") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }

  return "border-orange-200 bg-orange-50 text-orange-800";
}

export default async function PortableTicketPage({
  searchParams,
}: PortableTicketPageProps) {
  const { date } = await searchParams;
  const selectedDate = isDateInputValue(date) ? date : undefined;
  const data = await getPortableTicketData(selectedDate);
  const totals = data.tickets.reduce(
    (summary, ticket) => ({
      openCount: summary.openCount + (ticket.status === "open" ? 1 : 0),
      paid: summary.paid + ticket.paid,
      remaining: summary.remaining + Math.max(0, ticket.remaining),
      total: summary.total + ticket.total,
    }),
    { openCount: 0, paid: 0, remaining: 0, total: 0 },
  );

  return (
    <section
      className="h-full overflow-auto px-4 py-5 text-zinc-950 sm:px-6"
      data-portable-pos-page="ticket"
    >
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="border-b border-zinc-200 pb-4">
          <p className="text-sm font-semibold uppercase text-teal-800">
            Portable Ticket
          </p>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">
                {data.salonName}
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                {formatDate(data.date, data.timezone)}
              </p>
            </div>
            <form
              action="/pos/portable/ticket"
              className="flex items-end gap-2"
              method="get"
            >
              <label className="block">
                <span className="text-xs font-semibold uppercase text-zinc-500">
                  Date
                </span>
                <input
                  className="mt-1 h-10 rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                  defaultValue={data.date}
                  name="date"
                  type="date"
                />
              </label>
              <button
                className="h-10 rounded bg-zinc-950 px-4 text-sm font-semibold text-white"
                type="submit"
              >
                View
              </button>
            </form>
          </div>
        </header>

        {data.setupMessage ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.setupMessage}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Tickets
            </p>
            <p className="mt-2 text-2xl font-semibold">{data.tickets.length}</p>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Open
            </p>
            <p className="mt-2 text-2xl font-semibold">{totals.openCount}</p>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Paid
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {formatMoney(totals.paid)}
            </p>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Remaining
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {formatMoney(totals.remaining)}
            </p>
          </section>
        </div>

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {data.tickets.length === 0 ? (
            <div className="p-6">
              <h2 className="text-lg font-semibold text-zinc-950">
                No tickets for this date.
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Submitted POS tickets will appear here for the selected day.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {data.tickets.map((ticket) => (
                <li className="grid gap-3 px-4 py-4" key={ticket.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-zinc-950">
                          {ticket.ticketNumber}
                        </p>
                        <span
                          className={[
                            "inline-flex rounded-md border px-2 py-1 text-xs font-semibold capitalize",
                            statusClass(ticket.status),
                          ].join(" ")}
                        >
                          {statusLabel(ticket.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">
                        {ticket.customerName ?? "Walk-in customer"}
                        {ticket.customerPhone ? ` / ${ticket.customerPhone}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Opened {formatTime(ticket.openedAt, data.timezone)}
                        {ticket.closedAt
                          ? ` / Closed ${formatTime(ticket.closedAt, data.timezone)}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        {formatMoney(ticket.total)}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {ticket.serviceCount} services
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-4">
                    <div className="rounded-md bg-zinc-50 px-3 py-2">
                      <span className="block text-xs font-semibold uppercase text-zinc-500">
                        Subtotal
                      </span>
                      {formatMoney(ticket.subtotal)}
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2">
                      <span className="block text-xs font-semibold uppercase text-zinc-500">
                        Tip
                      </span>
                      {formatMoney(ticket.tipAmount)}
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2">
                      <span className="block text-xs font-semibold uppercase text-zinc-500">
                        Paid
                      </span>
                      {formatMoney(ticket.paid)}
                    </div>
                    <div className="rounded-md bg-zinc-50 px-3 py-2">
                      <span className="block text-xs font-semibold uppercase text-zinc-500">
                        Remaining
                      </span>
                      {formatMoney(Math.max(0, ticket.remaining))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
