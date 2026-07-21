"use client";

import { useState } from "react";

type PayrollScheduleFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  anchorDate: string | null;
  cycleType: "monthly" | "semi_monthly" | "biweekly";
  returnPath: string;
};

export function PayrollScheduleForm({
  action,
  anchorDate,
  cycleType,
  returnPath,
}: PayrollScheduleFormProps) {
  const [selectedCycle, setSelectedCycle] = useState(cycleType);
  const [selectedAnchor, setSelectedAnchor] = useState(anchorDate ?? "");
  const usesAnchor = selectedCycle === "biweekly";
  const isDirty = selectedCycle !== cycleType || selectedAnchor !== (anchorDate ?? "");

  return (
    <form
      action={action}
      className="mt-4 flex flex-wrap items-end gap-3"
    >
      <input name="return_to" type="hidden" value={returnPath} />
      <label className="flex min-w-56 flex-col gap-1 text-sm font-medium text-zinc-700">
        Payroll cycle
        <select
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          value={selectedCycle}
          name="cycle_type"
          onChange={(event) => {
            const value = event.currentTarget.value;
            setSelectedCycle(
              value === "biweekly"
                ? "biweekly"
                : value === "semi_monthly"
                  ? "semi_monthly"
                  : "monthly",
            );
          }}
        >
          <option value="monthly">Monthly</option>
          <option value="semi_monthly">Twice monthly</option>
          <option value="biweekly">Every 2 weeks</option>
        </select>
      </label>
      {usesAnchor ? (
        <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-zinc-700">
          Biweekly anchor date
          <input
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            onChange={(event) => setSelectedAnchor(event.currentTarget.value)}
            value={selectedAnchor}
            name="biweekly_anchor_date"
            required
            type="date"
          />
        </label>
      ) : selectedCycle === "semi_monthly" ? (
        <p className="pb-2 text-xs text-zinc-500">
          Pay periods: 1-15 and 16-end of month.
        </p>
      ) : (
        null
      )}
      <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
        Save
      </button>
      {isDirty ? (
        <button
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800"
          onClick={() => {
            setSelectedCycle(cycleType);
            setSelectedAnchor(anchorDate ?? "");
          }}
          type="button"
        >
          Cancel
        </button>
      ) : null}
    </form>
  );
}
