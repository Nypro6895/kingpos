import { getPortableBookData } from "@/app/pos/portable/actions";

type PortableBookPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function validDate(value: string | undefined) {
  return value?.match(/^\d{4}-\d{2}-\d{2}$/) ? value : undefined;
}

export default async function PortableBookPage({
  searchParams,
}: PortableBookPageProps) {
  const params = await searchParams;
  const data = await getPortableBookData(validDate(params.date));

  return (
    <section
      className="h-full overflow-auto px-4 py-5 text-zinc-950 sm:px-6"
      data-portable-pos-page="book"
    >
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm font-medium text-zinc-600">
            {data.salonName} / {formatDate(data.date)}
          </p>
          <form className="flex items-end gap-2" method="get">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">
                Date
              </span>
              <input
                className="mt-1 h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                defaultValue={data.date}
                name="date"
                type="date"
              />
            </label>
            <button
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white"
              type="submit"
            >
              Load
            </button>
          </form>
        </header>

        {data.setupMessage ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {data.setupMessage}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Appointments
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {data.appointments.length}
            </p>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Services
            </p>
            <p className="mt-2 text-2xl font-semibold">{data.services.length}</p>
          </section>
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase text-zinc-500">
              Staff
            </p>
            <p className="mt-2 text-2xl font-semibold">{data.staff.length}</p>
          </section>
        </div>

        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase text-zinc-500">
            <div className="col-span-3">Time</div>
            <div className="col-span-4">Customer</div>
            <div className="col-span-3">Service</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          {data.appointments.length === 0 ? (
            <p className="px-4 py-8 text-sm text-zinc-600">
              No portable appointments are available for this date.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200">
              {data.appointments.map((appointment) => (
                <li
                  className="grid grid-cols-12 gap-2 px-4 py-3 text-sm"
                  key={appointment.id}
                >
                  <div className="col-span-3 font-semibold">
                    {formatTime(appointment.startAt, data.timezone)}-
                    {formatTime(appointment.endAt, data.timezone)}
                  </div>
                  <div className="col-span-4 min-w-0">
                    <p className="truncate font-semibold">
                      {appointment.customerName ?? "Walk-in"}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {appointment.customerPhone ?? appointment.staffName ?? "-"}
                    </p>
                  </div>
                  <div className="col-span-3 truncate">
                    {appointment.serviceNames.join(", ") || "-"}
                  </div>
                  <div className="col-span-2 text-right capitalize">
                    {appointment.status.replace(/_/g, " ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs leading-5 text-zinc-500">
          Portable Book is restricted to appointment operations for this salon.
          Creation and cancellation controls appear only when the device session
          exposes the corresponding portable capabilities.
        </p>
      </div>
    </section>
  );
}
