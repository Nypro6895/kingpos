export type DailyPosSalesComparison = {
  average: number;
  comparedDateCount: number;
  direction: "down" | "flat" | "up";
  label: string;
  percent: number;
  status:
    | "available"
    | "flat"
    | "insufficient_history"
    | "zero_baseline";
  weekdayLabel: string;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseLocalDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Invalid report date.");
  }

  const [, year, month, day] = match;

  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

export function addLocalDays(dateString: string, days: number) {
  const { day, month, year } = parseLocalDateParts(dateString);

  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function weekdayLabel(dateString: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(`${dateString}T12:00:00.000Z`));
}

export function buildSameWeekdayComparisonDates(input: {
  count?: number;
  reportDate: string;
}) {
  const count = input.count ?? 4;

  return Array.from({ length: count }, (_, index) =>
    addLocalDays(input.reportDate, -7 * (index + 1)),
  );
}

export function calculateDailyPosSalesComparison(input: {
  comparableTotals: number[];
  reportDate: string;
  selectedTotal: number;
}): DailyPosSalesComparison {
  const weekday = weekdayLabel(input.reportDate);
  const positiveTotals = input.comparableTotals.filter((total) => total > 0);

  if (positiveTotals.length < 2) {
    return {
      average: 0,
      comparedDateCount: positiveTotals.length,
      direction: "flat",
      label: "Not enough history for comparison",
      percent: 0,
      status: "insufficient_history",
      weekdayLabel: weekday,
    };
  }

  const average = roundMoney(
    positiveTotals.reduce((total, value) => total + value, 0) /
      positiveTotals.length,
  );

  if (average <= 0) {
    return {
      average: 0,
      comparedDateCount: positiveTotals.length,
      direction: "flat",
      label: "Not enough history for comparison",
      percent: 0,
      status: "zero_baseline",
      weekdayLabel: weekday,
    };
  }

  const rawPercent = ((input.selectedTotal - average) / average) * 100;
  const percent = Math.round(rawPercent);

  if (percent === 0) {
    return {
      average,
      comparedDateCount: positiveTotals.length,
      direction: "flat",
      label: `0% vs typical ${weekday}`,
      percent: 0,
      status: "flat",
      weekdayLabel: weekday,
    };
  }

  const direction = percent > 0 ? "up" : "down";
  const absolutePercent = Math.abs(percent);

  return {
    average,
    comparedDateCount: positiveTotals.length,
    direction,
    label: `${direction === "up" ? "+" : "-"}${absolutePercent}% vs typical ${weekday}`,
    percent: absolutePercent,
    status: "available",
    weekdayLabel: weekday,
  };
}
