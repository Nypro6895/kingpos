import {
  addLocalDays,
  type DailyPosSalesComparison,
} from "./daily-pos-sales-comparison";

export type MetricTone = "default" | "good" | "warning" | "danger";
export function backlogTone(count: number): MetricTone {
  return count >= 5 ? "danger" : count > 0 ? "warning" : "good";
}
export function waitingAssessment(timestamps: string[], nowIso: string) {
  const longestMinutes = Math.max(
    0,
    ...timestamps.map((value) => {
      const elapsed = (Date.parse(nowIso) - Date.parse(value)) / 60000;
      return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed)) : 0;
    }),
  );
  return {
    tone:
      longestMinutes >= 30
        ? ("danger" as const)
        : backlogTone(timestamps.length),
    label: timestamps.length
      ? `Longest wait: ${longestMinutes} min`
      : "Queue clear",
  };
}
export function recentComparisonDates(date: string) {
  return Array.from({ length: 7 }, (_, index) =>
    addLocalDays(date, -index - 1),
  );
}
export function sameTimeSalesComparison(input: {
  totals: number[];
  selectedTotal: number;
  historyDays: number;
  sameTime: boolean;
}): DailyPosSalesComparison {
  const base = {
    average: 0,
    comparedDateCount: input.totals.length,
    direction: "flat" as const,
    percent: 0,
    weekdayLabel: "previous 7 days",
  };
  if (
    input.historyDays < 2 ||
    input.totals.length !== 7 ||
    input.totals.some((value) => !Number.isFinite(value))
  ) {
    return {
      ...base,
      status: "insufficient_history",
      label: "Not enough history to compare",
    };
  }
  const average =
    Math.round(
      (input.totals.reduce((sum, total) => sum + total, 0) / 7) * 100,
    ) / 100;
  const delta = Math.round((input.selectedTotal - average) * 100) / 100;
  const period = input.sameTime
    ? "7-day average at this time"
    : "previous 7-day average";
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  if (average <= 0)
    return {
      ...base,
      average,
      status: "zero_baseline",
      label: "No sales baseline at this time",
    };
  const flat = Math.abs(delta) <= 100;
  return {
    ...base,
    average,
    status: flat ? "flat" : "available",
    direction: flat ? "flat" : delta > 0 ? "up" : "down",
    percent: Math.round(Math.abs((delta / average) * 100)),
    label: flat
      ? `Near ${period} (${money.format(average)}, within $100)`
      : `${money.format(Math.abs(delta))} ${delta > 0 ? "above" : "below"} ${period} (${money.format(average)})`,
  };
}
