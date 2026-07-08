import { PaystubUploadControl } from "@/app/payroll/paystub-upload-control";
import type { PayrollPeriod, PayrollStaffLineWithDailyTotals } from "@/types/payroll";
import { Fragment } from "react";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatPercent(value: number) {
  return `${Number(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatPayoutMethod(value: string) {
  return value === "check" ? "Check" : "Cash";
}

function formatYesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function formatOnOff(value: boolean) {
  return value ? "On" : "Off";
}

function formatCashReported(line: PayrollStaffLineWithDailyTotals) {
  if (line.tax_company_cash_amount === 0 && !line.cash_to_tax_company_snapshot) {
    return "N/A";
  }

  return formatMoney(line.tax_company_cash_amount);
}

function firstSettingSnapshot(snapshot: unknown) {
  if (Array.isArray(snapshot)) {
    return snapshot[0];
  }

  if (snapshot && typeof snapshot === "object") {
    return snapshot;
  }

  return null;
}

function taxFixedLabel(line: PayrollStaffLineWithDailyTotals) {
  if (line.pay_type_used !== "fixed") {
    return null;
  }

  const snapshot = firstSettingSnapshot(line.settings_used_snapshot);
  const value =
    snapshot && typeof snapshot === "object"
      ? (snapshot as Record<string, unknown>).applyTaxToFixedPay
      : null;

  if (typeof value !== "boolean") {
    return "-";
  }

  return formatYesNo(value);
}

function reportedTip(line: PayrollStaffLineWithDailyTotals) {
  return line.tax_tips_snapshot ? line.tip_amount : 0;
}

function reportedBonus(line: PayrollStaffLineWithDailyTotals) {
  return line.tax_bonus_snapshot ? line.bonus_amount : 0;
}

function cashReportedParts(line: PayrollStaffLineWithDailyTotals) {
  return {
    bonus: line.tax_bonus_snapshot && line.bonus_payout_method_snapshot === "cash"
      ? line.bonus_amount
      : 0,
    tip: line.tax_tips_snapshot && line.tip_payout_method_snapshot === "cash"
      ? line.tip_amount
      : 0,
    wage: line.cash_to_tax_company_snapshot ? line.base_cash_amount : 0,
  };
}

function AmountTaxCell({
  amount,
  payoutMethod,
  taxed,
}: {
  amount: number;
  payoutMethod: string;
  taxed: boolean;
}) {
  return (
    <div className="grid gap-1 text-right">
      <p className="font-medium text-zinc-950">{formatMoney(amount)}</p>
      <p className="text-xs text-zinc-500">
        {formatPayoutMethod(payoutMethod)} · {taxed ? "Tax" : "No tax"}
      </p>
    </div>
  );
}

function PaystubCell({
  line,
  payrollRunId,
  returnPath,
}: {
  line: PayrollStaffLineWithDailyTotals;
  payrollRunId: string | null;
  returnPath: string;
}) {
  return (
    <div className="grid gap-1">
      <PaystubUploadControl
        hasPaystub={Boolean(line.paystub)}
        payrollRunId={payrollRunId}
        returnPath={returnPath}
        staffId={line.staff_id}
      />
      {!payrollRunId ? (
        <p className="text-xs text-zinc-500">Print statement first</p>
      ) : null}
    </div>
  );
}

function BreakdownSection({
  rows,
  title,
}: {
  rows: Array<{ label: string; value: string }>;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-xs font-semibold uppercase text-zinc-500">{title}</h4>
      <dl className="grid gap-2">
        {rows.map((row) => (
          <div className="flex items-baseline justify-between gap-3" key={row.label}>
            <dt className="text-xs text-zinc-500">{row.label}</dt>
            <dd className="text-right text-sm font-medium text-zinc-900">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function StaffBreakdown({
  line,
  period,
}: {
  line: PayrollStaffLineWithDailyTotals;
  period: PayrollPeriod;
}) {
  const taxFixed = taxFixedLabel(line);
  const cashParts = cashReportedParts(line);
  const wageRows = [
    { label: "Shop gross", value: formatMoney(line.gross_sales) },
    {
      label: "Commission rate",
      value: line.is_mixed_rate ? "Mixed" : formatPercent(line.commission_rate_used),
    },
    {
      label: "Staff commission gross",
      value: formatMoney(line.staff_commission_gross),
    },
    {
      label: "Check split",
      value: line.is_mixed_rate ? "Mixed" : formatPercent(line.check_rate_used),
    },
    { label: "Wage check gross", value: formatMoney(line.check_gross) },
    { label: "Wage cash gross", value: formatMoney(line.base_cash_amount) },
    { label: "Tax cash", value: formatOnOff(line.cash_to_tax_company_snapshot) },
    {
      label: "Reported wage gross",
      value: formatMoney(line.tax_company_reported_wage_gross),
    },
    taxFixed ? { label: "Tax fixed", value: taxFixed } : null,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
  const tipRows = [
    { label: "Tip amount", value: formatMoney(line.tip_amount) },
    { label: "Tip payout", value: formatPayoutMethod(line.tip_payout_method_snapshot) },
    { label: "Tax tip", value: formatYesNo(line.tax_tips_snapshot) },
    { label: "Reported tip", value: formatMoney(reportedTip(line)) },
  ];
  const bonusRows = [
    { label: "Bonus amount", value: formatMoney(line.bonus_amount) },
    {
      label: "Bonus payout",
      value: formatPayoutMethod(line.bonus_payout_method_snapshot),
    },
    { label: "Tax bonus", value: formatYesNo(line.tax_bonus_snapshot) },
    { label: "Reported bonus", value: formatMoney(reportedBonus(line)) },
  ];
  const taxRows = [
    { label: "Reported Gross", value: formatMoney(line.tax_company_taxable_gross) },
    {
      label: "Reported Gross calculation",
      value: `${formatMoney(line.tax_company_reported_wage_gross)} + ${formatMoney(
        reportedTip(line),
      )} + ${formatMoney(reportedBonus(line))}`,
    },
    { label: "Tax rate", value: formatPercent(line.tax_rate_used) },
    { label: "Tax amount", value: formatMoney(line.tax_withheld) },
    { label: "Wage Check Net", value: formatMoney(line.base_check_amount) },
    { label: "Actual Check Paid", value: formatMoney(line.final_check_amount) },
    { label: "Cash Reported", value: formatCashReported(line) },
    {
      label: "Cash reported calculation",
      value: `${formatMoney(cashParts.wage)} + ${formatMoney(
        cashParts.tip,
      )} + ${formatMoney(cashParts.bonus)}`,
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BreakdownSection rows={wageRows} title="Wage calculation" />
        <BreakdownSection rows={tipRows} title="Tip" />
        <BreakdownSection rows={bonusRows} title="Bonus" />
        <BreakdownSection rows={taxRows} title="Tax / check" />
      </div>
      {line.dailyTotals.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left uppercase text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4 text-right">Shop gross</th>
                <th className="py-2 pr-4 text-right">Tip</th>
                <th className="py-2 pr-4">Rate used</th>
              </tr>
            </thead>
            <tbody>
              {line.dailyTotals.map((dailyTotal) => (
                <tr key={dailyTotal.id}>
                  <td className="py-1 pr-4">{dailyTotal.business_date}</td>
                  <td className="py-1 pr-4 text-right">
                    {formatMoney(dailyTotal.gross_sales)}
                  </td>
                  <td className="py-1 pr-4 text-right">
                    {formatMoney(dailyTotal.tip_amount)}
                  </td>
                  <td className="py-1 pr-4">
                    {dailyTotal.pay_type_used === "fixed"
                      ? "Fixed"
                      : formatPercent(dailyTotal.commission_rate_used ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          No daily payroll rows for {period.label}.
        </p>
      )}
    </div>
  );
}

export function TaxCompanyLinesTable({
  lines,
  payrollRunId,
  period,
  returnPath,
  showBreakdown = false,
}: {
  lines: PayrollStaffLineWithDailyTotals[];
  payrollRunId: string | null;
  period: PayrollPeriod;
  returnPath: string;
  showBreakdown?: boolean;
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No reportable staff lines for this period.
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Staff / Legal name</th>
              <th className="px-4 py-3 text-right">Reported Gross</th>
              <th className="px-4 py-3 text-right">Cash Reported</th>
              <th className="px-4 py-3 text-right">Tip</th>
              <th className="px-4 py-3 text-right">Bonus</th>
              <th className="px-4 py-3 text-right">Tax</th>
              <th className="px-4 py-3 text-right">Wage Check Net</th>
              <th className="px-4 py-3 text-right">Actual Check Paid</th>
              <th className="px-4 py-3">Paystub</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {lines.map((line) => (
              <Fragment key={line.staff_id}>
                <tr className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-950">
                      {line.staff_display_name_snapshot}
                    </p>
                    {line.staff_legal_name_snapshot ? (
                      <p className="text-xs text-zinc-500">
                        {line.staff_legal_name_snapshot}
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-amber-700">
                        Missing legal name
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-950">
                    {formatMoney(line.tax_company_taxable_gross)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatCashReported(line)}
                  </td>
                  <td className="px-4 py-3">
                    <AmountTaxCell
                      amount={line.tip_amount}
                      payoutMethod={line.tip_payout_method_snapshot}
                      taxed={line.tax_tips_snapshot}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <AmountTaxCell
                      amount={line.bonus_amount}
                      payoutMethod={line.bonus_payout_method_snapshot}
                      taxed={line.tax_bonus_snapshot}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.tax_withheld)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.base_check_amount)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      line.final_check_amount < 0
                        ? "text-rose-700"
                        : "text-zinc-950"
                    }`}
                  >
                    <p>{formatMoney(line.final_check_amount)}</p>
                    {line.final_check_amount < 0 ? (
                      <p className="mt-1 text-xs font-medium text-rose-700">
                        Check amount negative
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <PaystubCell
                      line={line}
                      payrollRunId={payrollRunId}
                      returnPath={returnPath}
                    />
                  </td>
                </tr>
                {showBreakdown ? (
                  <tr>
                    <td className="bg-zinc-50 px-4 py-3" colSpan={9}>
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                          Breakdown
                        </summary>
                        <div className="mt-3">
                          <StaffBreakdown line={line} period={period} />
                        </div>
                      </details>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TaxCompanyCalculationGuide() {
  return (
    <details className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer text-sm font-semibold text-zinc-950">
        How these numbers are calculated
      </summary>
      <dl className="mt-4 grid gap-3 text-sm text-zinc-600 md:grid-cols-2">
        <div>
          <dt className="font-medium text-zinc-900">Reported Gross</dt>
          <dd>
            Reported Gross is the total gross amount reported to the tax
            company. It includes reported wage gross, reported tips, and
            reported bonus.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Reported wage gross</dt>
          <dd>
            If Tax cash is On, reported wage gross uses the full staff
            commission gross. If Tax cash is Off, reported wage gross uses only
            the check portion after check split.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Tax</dt>
          <dd>
            Tax is calculated from Reported Gross using the staff tax setting.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Cash Reported</dt>
          <dd>
            Cash Reported shows only cash amounts reported to the tax company.
            If cash is not reported, it shows N/A.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Tip</dt>
          <dd>
            Tip shows the tip amount, how it was paid, and whether it is
            included in tax reporting.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Bonus</dt>
          <dd>
            Bonus shows the bonus amount, how it was paid, and whether it is
            included in tax reporting.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Wage Check Net</dt>
          <dd>
            Wage Check Net is the wage check amount after tax. It does not
            include tips or bonus paid by check.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Actual Check Paid</dt>
          <dd>
            Actual Check Paid is the real check amount paid to the staff. It
            includes wage check plus any tip or bonus paid by check, minus tax.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Paystub</dt>
          <dd>The uploaded paystub should match Actual Check Paid.</dd>
        </div>
      </dl>
      <p className="mt-4 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
        Actual Check Paid can be different from Wage Check Net when tip or bonus
        is paid by check.
      </p>
    </details>
  );
}
