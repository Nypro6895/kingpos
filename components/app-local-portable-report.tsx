"use client";
import {NavigationForm,NavigationSubmitButton} from "@/components/navigation-form";
import {WorkspaceText} from "@/components/workspace-language";
import {PortableReportClosingForm} from "@/app/pos/portable/report/portable-report-closing-form";
import type {AppLocalPortableReportData} from "@/lib/app-local-portable-metadata";
function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export function AppLocalPortableReport({data}:{data:AppLocalPortableReportData}){
  return (
    <section
      className="h-full overflow-auto px-4 py-5 text-zinc-950 sm:px-6"
      data-portable-pos-page="report"
    >
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm font-medium text-zinc-600">
            {data.salonName} / <WorkspaceText text={formatDate(data.reportDate, data.timezone)} />
          </p>
          <NavigationForm className="flex items-end gap-2" method="get">
            <label className="block">
              <span className="text-xs font-semibold uppercase text-zinc-500">
                <WorkspaceText text="Date" />
              </span>
              <input
                className="mt-1 h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                defaultValue={data.reportDate}
                name="date"
                type="date"
              />
            </label>
            <NavigationSubmitButton pendingLabel="Loading…"
              className="h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white"
              type="submit"
            >
              <WorkspaceText text="Load" />
            </NavigationSubmitButton>
          </NavigationForm>
        </header>

        {data.setupMessage ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <WorkspaceText text={data.setupMessage} />
          </p>
        ) : null}

        <PortableReportClosingForm data={data} />
      </div>
    </section>
  );
}
