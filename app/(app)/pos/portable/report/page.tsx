import { getPortableReportData } from "@/app/pos/portable/actions";
import { PortableReportClosingForm } from "@/app/pos/portable/report/portable-report-closing-form";

type PortableReportPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function validDate(value: string | undefined) {
  return value?.match(/^\d{4}-\d{2}-\d{2}$/) ? value : undefined;
}

function PortableReportDenied() {
  return (
    <section
      className="h-full overflow-auto px-4 py-5 text-zinc-950 sm:px-6"
      data-portable-pos-page="report"
    >
      <div className="mx-auto grid max-w-3xl gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-2xl font-semibold tracking-normal">
            Report unavailable
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            This Portable POS device does not have report access. Enable the
            restricted Report capability from POS Settings before using this
            route.
          </p>
        </div>
      </div>
    </section>
  );
}

export default async function PortableReportPage({
  searchParams,
}: PortableReportPageProps) {
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof getPortableReportData>>;

  try {
    data = await getPortableReportData(validDate(params.date));
  } catch {
    return <PortableReportDenied />;
  }

  return (
    <section
      className="h-full overflow-auto px-4 py-5 text-zinc-950 sm:px-6"
      data-portable-pos-page="report"
    >
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm font-medium text-zinc-600">
            {data.salonName} / {formatDate(data.reportDate, data.timezone)}
          </p>
          <form className="flex items-end gap-2" method="get">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">
                Date
              </span>
              <input
                className="mt-1 h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                defaultValue={data.reportDate}
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
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.setupMessage}
          </p>
        ) : null}

        <PortableReportClosingForm data={data} />
      </div>
    </section>
  );
}
