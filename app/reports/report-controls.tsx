"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { OperationalReportData } from "@/lib/operational-report";
import { Sheet, inputClass, primaryButton } from "@/app/my-place/place-ui";

export function ClosingDateForm({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <form
      className="border-b border-zinc-200 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        new FormData(event.currentTarget).forEach((value, key) =>
          params.set(key, String(value)),
        );
        start(() =>
          router.push(`/reports?${params}#daily-closing`, { scroll: false }),
        );
      }}
    >
      <fieldset
        disabled={busy}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        {children}
      </fieldset>
      {busy ? (
        <p role="status" className="mt-2 text-xs text-zinc-500">
          Updating closing date…
        </p>
      ) : null}
    </form>
  );
}

export function ReportRangeFilter({
  report,
  selectedClosingDate,
}: {
  report: OperationalReportData;
  selectedClosingDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [preset, setPreset] = useState(report.range.preset);
  const router = useRouter();
  return (
    <div className="min-w-0 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-zinc-600">{report.range.label}</span>
        <button
          className="min-h-11 font-semibold text-teal-700 hover:underline disabled:opacity-50"
          disabled={busy}
          onClick={() => {
            setPreset(report.range.preset);
            setOpen(true);
          }}
        >
          Filter <span aria-hidden>☷</span>
        </button>
      </div>
      {busy ? (
        <p role="status" className="text-xs text-zinc-500">
          Updating report…
        </p>
      ) : null}
      {open ? (
        <Sheet
          title="Report filters"
          subtitle={`Dates use ${report.range.timeZone}`}
          busy={busy}
          dirty={false}
          onClose={() => setOpen(false)}
        >
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const params = new URLSearchParams({
                preset,
                date: selectedClosingDate,
              });
              if (preset === "custom") {
                params.set("start", String(form.get("start")));
                params.set("end", String(form.get("end")));
              }
              start(() => {
                router.push(`/reports?${params}`, { scroll: false });
              });
              setOpen(false);
            }}
          >
            <fieldset className="grid gap-1">
              <legend className="mb-3 text-sm font-semibold">Date range</legend>
              {(
                [
                  { value: "today", label: "Today" },
                  { value: "this_week", label: "This week" },
                  { value: "this_month", label: "This month" },
                  { value: "custom", label: "Custom dates" },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-12 cursor-pointer items-center justify-between border-b border-zinc-100 text-sm ${preset === option.value ? "font-semibold text-teal-700" : "text-zinc-600"}`}
                >
                  {option.label}
                  <input
                    className="h-4 w-4 accent-teal-700"
                    name="preset"
                    type="radio"
                    value={option.value}
                    checked={preset === option.value}
                    onChange={() => setPreset(option.value)}
                  />
                </label>
              ))}
            </fieldset>
            {preset === "custom" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  Start
                  <input
                    className={inputClass}
                    name="start"
                    type="date"
                    required
                    defaultValue={report.range.startDate}
                    max={report.range.businessDate}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  End
                  <input
                    className={inputClass}
                    name="end"
                    type="date"
                    required
                    defaultValue={report.range.endDate}
                    max={report.range.businessDate}
                  />
                </label>
              </div>
            ) : null}
            <button className={primaryButton} type="submit" disabled={busy}>
              Apply filters
            </button>
          </form>
        </Sheet>
      ) : null}
    </div>
  );
}

export function ReportTabs({
  overview,
  children,
}: {
  overview: ReactNode;
  children: ReactNode;
}) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const sync = () => setClosing(window.location.hash === "#daily-closing");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  return (
    <>
      <nav
        aria-label="Report views"
        className="flex gap-6 border-b border-zinc-200 text-sm"
      >
        {[false, true].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={closing === value}
            className={`min-h-11 border-b-2 px-1 ${closing === value ? "border-teal-700 font-semibold text-teal-700" : "border-transparent text-zinc-500 hover:text-zinc-900"}`}
            onClick={() => {
              setClosing(value);
              window.history.replaceState(
                null,
                "",
                `${window.location.pathname}${window.location.search}${value ? "#daily-closing" : "#overview"}`,
              );
            }}
          >
            {value ? "Daily Closing" : "Overview"}
          </button>
        ))}
      </nav>
      <div className="min-w-0" hidden={closing}>
        {overview}
      </div>
      <div className="min-w-0" hidden={!closing}>
        {children}
      </div>
    </>
  );
}
