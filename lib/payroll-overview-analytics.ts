import type {
  PayrollPeriod,
  PayrollServiceAnalytics,
  PayrollServiceAnalyticsRow,
  PayrollShopDailyRow,
  PayrollShopSummary,
  PayrollStaffLineWithDailyTotals,
} from "@/types/payroll";

const DAY_MS = 24 * 60 * 60 * 1000;

export type OverviewTrendMode = "daily" | "weekly" | "monthly";
export type OverviewServiceRankMode = "revenue" | "count";

export type PayrollOverviewFilters = {
  serviceId: string | null;
  serviceRankMode: OverviewServiceRankMode;
  staffId: string | null;
  trendMode: OverviewTrendMode;
};

export type OverviewSnapshot = {
  actualReceived: number | null;
  cashReceived: number | null;
  checkReceived: number | null;
  overShort: number | null;
  payrollTax: number | null;
  posRevenue: number;
  shopNet: number | null;
  staffPayout: number | null;
  totalTip: number;
};

export type OverviewTrendPoint = {
  key: string;
  label: string;
  revenue: number;
  shopNet: number | null;
  staffPayout: number;
};

export type OverviewStaffPerformanceRow = {
  bonus: number;
  commission: number;
  growthPercent: number | null;
  serviceSales: number;
  staffId: string;
  staffName: string;
  tags: string[];
  tips: number;
  totalIncome: number;
};

export type OverviewServicePerformanceRow = PayrollServiceAnalyticsRow & {
  percentOfRevenue: number | null;
};

export type OverviewHealthMetric = {
  label: string;
  tone: "default" | "good" | "warning";
  value: string;
};

export type OverviewSummaryRow = {
  actualReceived: number | null;
  label: string;
  overShort: number | null;
  payrollRatio: number | null;
  revenue: number;
  shopNet: number | null;
  staffPayout: number;
};

export type PayrollOverviewAnalytics = {
  accounting: {
    actualCheckPaid: number | null;
    cashPayout: number | null;
    cashReceived: number | null;
    cardReceived: number | null;
    checkReceived: number | null;
    netAfterPayoutAndTax: number | null;
    payrollTax: number | null;
    totalActualReceived: number | null;
  };
  filterNotice: string | null;
  hasPayrollData: boolean;
  health: OverviewHealthMetric[];
  insights: string[];
  monthlySummary: OverviewSummaryRow[];
  servicePerformance: OverviewServicePerformanceRow[];
  snapshot: OverviewSnapshot;
  staffPerformance: OverviewStaffPerformanceRow[];
  trend: OverviewTrendPoint[];
  weeklySummary: OverviewSummaryRow[];
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumMoney<T>(items: T[], selector: (item: T) => number) {
  return roundMoney(items.reduce((total, item) => total + selector(item), 0));
}

function nullableSum<T>(items: T[], selector: (item: T) => number | null) {
  const values = items.map(selector).filter((value): value is number => value !== null);

  if (values.length === 0) {
    return null;
  }

  return roundMoney(values.reduce((total, value) => total + value, 0));
}

function safeRatio(numerator: number | null, denominator: number | null) {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function dateFromDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnlyFromUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  return dateOnlyFromUtcDate(new Date(dateFromDateOnly(value).getTime() + days * DAY_MS));
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function getWeekStart(value: string) {
  const date = dateFromDateOnly(value);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return dateOnlyFromUtcDate(new Date(date.getTime() + mondayOffset * DAY_MS));
}

function getWeekLabel(value: string) {
  const start = getWeekStart(value);
  const end = addDays(start, 6);

  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

function getMonthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function trendKeyForDate(value: string, mode: OverviewTrendMode) {
  if (mode === "weekly") {
    return getWeekStart(value);
  }

  if (mode === "monthly") {
    return value.slice(0, 7);
  }

  return value;
}

function trendLabelForKey(key: string, mode: OverviewTrendMode) {
  if (mode === "weekly") {
    return getWeekLabel(key);
  }

  if (mode === "monthly") {
    return getMonthLabel(key);
  }

  return formatShortDate(key);
}

function buildTrendPoints(
  rows: PayrollShopDailyRow[],
  mode: OverviewTrendMode,
): OverviewTrendPoint[] {
  const grouped = new Map<
    string,
    {
      actualReceived: number | null;
      actualReceivedCount: number;
      revenue: number;
      staffPayout: number;
      tax: number;
    }
  >();

  for (const row of rows) {
    const key = trendKeyForDate(row.businessDate, mode);
    const entry =
      grouped.get(key) ??
      {
        actualReceived: 0,
        actualReceivedCount: 0,
        revenue: 0,
        staffPayout: 0,
        tax: 0,
      };

    entry.revenue += numberValue(row.posIncome);
    entry.staffPayout += numberValue(row.staffNetPay) + numberValue(row.tipsPaid);
    entry.tax += numberValue(row.taxWithheld);

    if (row.actualIncome !== null) {
      entry.actualReceived = numberValue(entry.actualReceived) + row.actualIncome;
      entry.actualReceivedCount += 1;
    }

    grouped.set(key, entry);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => {
      const actualReceived =
        entry.actualReceivedCount === 0 ? null : numberValue(entry.actualReceived);

      return {
        key,
        label: trendLabelForKey(key, mode),
        revenue: roundMoney(entry.revenue),
        shopNet:
          actualReceived === null
            ? null
            : roundMoney(actualReceived - entry.staffPayout - entry.tax),
        staffPayout: roundMoney(entry.staffPayout),
      };
    });
}

function buildSummaryRows(
  rows: PayrollShopDailyRow[],
  mode: Exclude<OverviewTrendMode, "daily">,
) {
  return buildTrendPoints(rows, mode).map((point) => {
    const groupedRows = rows.filter(
      (row) => trendKeyForDate(row.businessDate, mode) === point.key,
    );
    const actualReceived = nullableSum(groupedRows, (row) => row.actualIncome);
    const overShort =
      actualReceived === null ? null : roundMoney(actualReceived - point.revenue);

    return {
      actualReceived,
      label: point.label,
      overShort,
      payrollRatio: safeRatio(point.staffPayout, actualReceived),
      revenue: point.revenue,
      shopNet: point.shopNet,
      staffPayout: point.staffPayout,
    } satisfies OverviewSummaryRow;
  });
}

function linePosRevenue(line: PayrollStaffLineWithDailyTotals) {
  return numberValue(line.gross_sales) + numberValue(line.tip_amount);
}

function bestDayLabel(rows: PayrollShopDailyRow[]) {
  const best = rows
    .filter((row) => numberValue(row.posIncome) > 0)
    .sort((left, right) => numberValue(right.posIncome) - numberValue(left.posIncome))[0];

  return best ? formatShortDate(best.businessDate) : "N/A";
}

function bestWeekLabel(rows: OverviewSummaryRow[]) {
  const best = rows
    .filter((row) => row.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue)[0];

  return best ? best.label : "N/A";
}

function formatPercentValue(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function selectedServiceRevenue(
  serviceAnalytics: PayrollServiceAnalytics,
  serviceId: string | null,
) {
  if (!serviceId) {
    return null;
  }

  return serviceAnalytics.rows.find((row) => row.serviceId === serviceId)?.revenue ?? 0;
}

function buildStaffPerformance(
  lines: PayrollStaffLineWithDailyTotals[],
): OverviewStaffPerformanceRow[] {
  const topIncome = Math.max(0, ...lines.map((line) => numberValue(line.final_staff_income)));
  const topTips = Math.max(0, ...lines.map((line) => numberValue(line.tip_amount)));

  return lines
    .map((line) => {
      const totalIncome = numberValue(line.final_staff_income);
      const tips = numberValue(line.tip_amount);
      const tags: string[] = [];

      if (topIncome > 0 && totalIncome === topIncome) {
        tags.push("Top Staff");
      }

      if (topTips > 0 && tips === topTips) {
        tags.push("Highest Tip");
      }

      return {
        bonus: numberValue(line.bonus_amount),
        commission: numberValue(line.staff_commission_gross),
        growthPercent: null,
        serviceSales: numberValue(line.gross_sales),
        staffId: line.staff_id,
        staffName: line.staff_display_name_snapshot,
        tags,
        tips,
        totalIncome,
      } satisfies OverviewStaffPerformanceRow;
    })
    .sort((left, right) => right.totalIncome - left.totalIncome)
    .slice(0, 10);
}

function buildServicePerformance(
  serviceAnalytics: PayrollServiceAnalytics,
  selectedServiceId: string | null,
  rankMode: OverviewServiceRankMode,
) {
  const rows = selectedServiceId
    ? serviceAnalytics.rows.filter((row) => row.serviceId === selectedServiceId)
    : serviceAnalytics.rows;
  const totalRevenue = sumMoney(serviceAnalytics.rows, (row) => numberValue(row.revenue));

  return rows
    .map((row) => ({
      ...row,
      percentOfRevenue:
        totalRevenue === 0 ? null : numberValue(row.revenue) / totalRevenue,
    }))
    .sort((left, right) =>
      rankMode === "count"
        ? numberValue(right.count) - numberValue(left.count) ||
          numberValue(right.revenue) - numberValue(left.revenue)
        : numberValue(right.revenue) - numberValue(left.revenue) ||
          numberValue(right.count) - numberValue(left.count),
    )
    .slice(0, 10);
}

function buildInsights(input: {
  bestDay: string;
  overShort: number | null;
  payrollRatio: number | null;
  servicePerformance: OverviewServicePerformanceRow[];
  staffPerformance: OverviewStaffPerformanceRow[];
  weeklySummary: OverviewSummaryRow[];
}) {
  const insights: string[] = [];
  const topStaff = input.staffPerformance[0];
  const topService = input.servicePerformance[0];

  if (topStaff && topStaff.totalIncome > 0) {
    insights.push(
      `${topStaff.staffName} is the top performer with ${formatCurrency(
        topStaff.totalIncome,
      )} total income.`,
    );
  }

  if (topService && topService.revenue > 0) {
    insights.push(
      `${topService.serviceName} generated the highest service revenue in this period.`,
    );
  }

  if (input.payrollRatio !== null) {
    insights.push(`Payroll ratio is ${formatPercentValue(input.payrollRatio)}.`);
  }

  if (input.bestDay !== "N/A") {
    insights.push(`${input.bestDay} is the strongest business day in this period.`);
  }

  if (input.overShort !== null && Math.abs(input.overShort) >= 0.01) {
    insights.push(`Over / Short is ${formatCurrency(input.overShort)} and needs review.`);
  }

  return insights.slice(0, 5);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

export function buildPayrollOverviewAnalytics(input: {
  filters: PayrollOverviewFilters;
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
  serviceAnalytics: PayrollServiceAnalytics;
  shopDailyRows: PayrollShopDailyRow[];
  shopSummary: PayrollShopSummary;
}): PayrollOverviewAnalytics {
  const filteredLines = input.filters.staffId
    ? input.lines.filter((line) => line.staff_id === input.filters.staffId)
    : input.lines;
  const serviceRevenue = selectedServiceRevenue(
    input.serviceAnalytics,
    input.filters.serviceId,
  );
  const scopedToShop = !input.filters.staffId && !input.filters.serviceId;
  const hasStaffScope = !input.filters.serviceId;
  const posRevenue =
    serviceRevenue !== null
      ? serviceRevenue
      : sumMoney(filteredLines, (line) => linePosRevenue(line));
  const staffPayout = hasStaffScope
    ? sumMoney(filteredLines, (line) => numberValue(line.final_staff_income))
    : null;
  const payrollTax = hasStaffScope
    ? sumMoney(filteredLines, (line) => numberValue(line.tax_withheld))
    : null;
  const cashPayout = hasStaffScope
    ? sumMoney(filteredLines, (line) => numberValue(line.final_cash_amount))
    : null;
  const actualCheckPaid = hasStaffScope
    ? sumMoney(filteredLines, (line) => numberValue(line.final_check_amount))
    : null;
  const actualReceived = scopedToShop ? input.shopSummary.totalActualIncome : null;
  const cashReceived = scopedToShop ? input.shopSummary.cashAmount : null;
  const checkReceived = scopedToShop ? input.shopSummary.otherAmount : null;
  const cardReceived = scopedToShop ? input.shopSummary.creditCardAmount : null;
  const shopNet =
    actualReceived !== null && staffPayout !== null && payrollTax !== null
      ? roundMoney(actualReceived - staffPayout - payrollTax)
      : null;
  const overShort =
    actualReceived !== null ? roundMoney(actualReceived - posRevenue) : null;
  const weeklySummary = scopedToShop ? buildSummaryRows(input.shopDailyRows, "weekly") : [];
  const monthlySummary = scopedToShop
    ? buildSummaryRows(input.shopDailyRows, "monthly")
    : [];
  const trend = scopedToShop ? buildTrendPoints(input.shopDailyRows, input.filters.trendMode) : [];
  const servicePerformance = buildServicePerformance(
    input.serviceAnalytics,
    input.filters.serviceId,
    input.filters.serviceRankMode,
  );
  const staffPerformance = buildStaffPerformance(filteredLines);
  const payrollRatio = safeRatio(staffPayout, actualReceived);
  const tipRatio = safeRatio(
    sumMoney(filteredLines, (line) => numberValue(line.tip_amount)),
    posRevenue,
  );
  const averageTicket = safeRatio(posRevenue, input.serviceAnalytics.ticketCount);
  const bestDay = scopedToShop ? bestDayLabel(input.shopDailyRows) : "N/A";
  const bestWeek = scopedToShop ? bestWeekLabel(weeklySummary) : "N/A";
  const filterNotice =
    scopedToShop
      ? null
      : "Filtered staff or service views use payroll-attributed data. Shop cash received, over / short, and shop net require the all-shop view.";

  const snapshot = {
    actualReceived,
    cashReceived,
    checkReceived,
    overShort,
    payrollTax,
    posRevenue,
    shopNet,
    staffPayout,
    totalTip: sumMoney(filteredLines, (line) => numberValue(line.tip_amount)),
  } satisfies OverviewSnapshot;

  return {
    accounting: {
      actualCheckPaid,
      cashPayout,
      cashReceived,
      cardReceived,
      checkReceived,
      netAfterPayoutAndTax: shopNet,
      payrollTax,
      totalActualReceived: actualReceived,
    },
    filterNotice,
    hasPayrollData:
      filteredLines.length > 0 ||
      input.shopDailyRows.some((row) => numberValue(row.posIncome) !== 0),
    health: [
      {
        label: "Average Ticket",
        tone: "default",
        value: averageTicket === null ? "N/A" : formatCurrency(averageTicket),
      },
      {
        label: "Clients Served",
        tone: "default",
        value:
          input.serviceAnalytics.ticketCount === 0
            ? "N/A"
            : `${input.serviceAnalytics.ticketCount}`,
      },
      {
        label: "Payroll Ratio",
        tone: payrollRatio !== null && payrollRatio > 0.55 ? "warning" : "default",
        value: formatPercentValue(payrollRatio),
      },
      {
        label: "Tip Ratio",
        tone: "default",
        value: formatPercentValue(tipRatio),
      },
      {
        label: "Best Day",
        tone: "good",
        value: bestDay,
      },
      {
        label: "Best Week",
        tone: "good",
        value: bestWeek,
      },
    ],
    insights: buildInsights({
      bestDay,
      overShort,
      payrollRatio,
      servicePerformance,
      staffPerformance,
      weeklySummary,
    }),
    monthlySummary,
    servicePerformance,
    snapshot,
    staffPerformance,
    trend,
    weeklySummary,
  };
}
