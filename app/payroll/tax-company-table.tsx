import { PaystubUploadControl } from "@/app/payroll/paystub-upload-control";
import type { PayrollStaffLineWithDailyTotals } from "@/types/payroll";

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

function isFixedTaxLine(line: PayrollStaffLineWithDailyTotals) {
  if (line.pay_type_used !== "fixed") {
    return false;
  }

  const snapshot = firstSettingSnapshot(line.settings_used_snapshot);
  const value =
    snapshot && typeof snapshot === "object"
      ? (snapshot as Record<string, unknown>).applyTaxToFixedPay
      : null;

  return typeof value === "boolean" ? value : false;
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

function TaxAmountCell({ line }: { line: PayrollStaffLineWithDailyTotals }) {
  const status =
    line.tax_withheld !== 0 && line.tax_rate_used === 0 && isFixedTaxLine(line)
      ? "Fixed tax"
      : line.is_mixed_rate && line.tax_withheld !== 0 && line.tax_rate_used === 0
      ? "Mixed rate"
      : `${formatPercent(line.tax_rate_used)} rate`;

  return (
    <div className="grid gap-1 text-right">
      <p className="font-medium text-zinc-950">{formatMoney(line.tax_withheld)}</p>
      <p className="text-xs text-zinc-500">{status}</p>
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

export function TaxCompanyLinesTable({
  lines,
  payrollRunId,
  returnPath,
}: {
  lines: PayrollStaffLineWithDailyTotals[];
  payrollRunId: string | null;
  returnPath: string;
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
              <tr className="align-top" key={line.staff_id}>
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
                <td className="px-4 py-3">
                  <TaxAmountCell line={line} />
                </td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(line.base_check_amount)}
                </td>
                <td
                  className={`px-4 py-3 text-right font-semibold ${
                    line.final_check_amount < 0 ? "text-rose-700" : "text-zinc-950"
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
            The total gross amount reported to the tax company. It includes
            reportable wage amount plus any tip or bonus marked as taxable.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-zinc-900">Cash Reported</dt>
          <dd>
            Cash amount reported to the tax company. If cash is not reported,
            this shows N/A.
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
          <dt className="font-medium text-zinc-900">Tax</dt>
          <dd>
            Calculated from Reported Gross using the staff tax setting. The rate
            or fixed-tax status is shown under the tax amount.
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
