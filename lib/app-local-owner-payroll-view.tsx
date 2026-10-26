"use client";
import {PayrollRecordedFactsPanel} from "@/app/payroll/payroll-recorded-facts";

import type { AppLocalOwnerPayrollData, AppLocalOwnerPayrollParams } from "./app-local-owner-page-types";

import { PayrollDashboard } from "@/app/payroll/payroll-dashboard";
import { adjacentPayrollPeriod } from "@/lib/payroll-period-navigation";
import { PayrollChangeHistory } from "@/app/payroll/payroll-change-history";
import { PayrollLiveRefresh } from "@/app/payroll/payroll-live-refresh";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import type { taxCompanySettings } from "@/lib/tax-company";
import { PayrollDisclosure } from "@/app/payroll/payroll-disclosure";
import { PayrollEditBoundary } from "@/app/payroll/payroll-edit-boundary";
import styles from "@/app/payroll/payroll-mobile.module.css";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { DataDownloadPanel } from "@/app/payroll/data-download-panel";
import { PluginActivationPrompt, PluginActivationButton } from "@/app/settings/plugin-settings-row";
import { PayrollFilterToolbar } from "@/app/payroll/payroll-filter-toolbar";
import { saveSalonPayrollScheduleAction } from "@/app/payroll/actions";
import { PayrollScheduleForm } from "@/app/payroll/payroll-schedule-form";
import { StaffIncomeAutosaveInputs } from "@/app/payroll/staff-income-autosave-inputs";
import { ShopIncomeDailyTable } from "@/app/payroll/shop-income-daily-table";
import { StaffPayrollSettingInlineEdit } from "@/app/payroll/staff-payroll-setting-inline-edit";
import type { getPayrollPageData } from "@/lib/payroll";
import type { PayrollPeriod, PayrollStaffDailyTotal, PayrollStaffLineWithDailyTotals, PayrollShopDailyRow, PayrollShopSummary, SalonPayrollSetting, StaffPayrollSetting, StaffPayrollSettingWithStaff } from "@/types/payroll";
import Link from "next/link";
import { type ReactNode } from "react";

type PayrollPageProps = {
  searchParams: Promise<{
    end?: string;
    month?: string;
    overviewRange?: string;
    overviewService?: string;
    overviewServiceRank?: string;
    overviewStaff?: string;
    overviewTrend?: string;
    payPeriodStart?: string;
    payroll_error?: string;
    editStaff?: string;
    preset?: string;
    segment?: string;
    start?: string;
    tab?: string;
  }>;
};

type PayrollTab = "analytics" | "differences" | "history" | "overview" | "staff" | "shop" | "tax" | "settings" | "tools" | "download";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatOptionalMoney(value: number | null, emptyLabel = "-") {
  return value === null ? emptyLabel : formatMoney(value);
}

function formatPercent(value: number) {
  return `${Number(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatOnOff(value: boolean) {
  return value ? "On" : "Off";
}

function formatYesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function formatPayoutMethod(value: string) {
  return value === "check" ? "Check" : "Cash";
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function getActiveTab(value: string | undefined, canViewAllPayroll: boolean): PayrollTab {
  if (value === "staff") {
    return "staff";
  }

  if (canViewAllPayroll && (value === "analytics" || value === "differences" || value === "history" || value === "shop" || value === "tax" || value === "settings" || value === "tools" || value === "download")) {
    return value;
  }

  return "overview";
}

function getPayrollHref(input: {
  period: PayrollPeriod;
  tab: PayrollTab;
}) {
  const params = new URLSearchParams({
    preset: input.period.preset,
    tab: input.tab,
  });

  if (input.period.preset === "custom") {
    params.set("start", input.period.startDate);
    params.set("end", input.period.endDate);
  } else if (input.period.cycleType === "biweekly") {
    params.set("payPeriodStart", input.period.startDate);
  } else {
    params.set("month", input.period.startDate.slice(0, 7));
    if (input.period.cycleType === "semi_monthly") {
      params.set(
        "segment",
        input.period.preset === "semi_monthly_second" ? "second" : "first",
      );
    }
  }

  return `/payroll?${params.toString()}`;
}

function getTaxCompanyHref(period: PayrollPeriod) {
  const params = new URLSearchParams({
    preset: period.preset,
    report: "1",
  });

  if (period.preset === "custom") {
    params.set("start", period.startDate);
    params.set("end", period.endDate);
  } else if (period.cycleType === "biweekly") {
    params.set("payPeriodStart", period.startDate);
  } else {
    params.set("month", period.startDate.slice(0, 7));
    if (period.cycleType === "semi_monthly") {
      params.set(
        "segment",
        period.preset === "semi_monthly_second" ? "second" : "first",
      );
    }
  }

  return `/payroll/tax-company?${params.toString()}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return `${dateLabel} at ${timeLabel}`;
}

function getReturnPath(period: PayrollPeriod, tab: PayrollTab) {
  return getPayrollHref({ period, tab });
}

function getSettingsEditHref(period: PayrollPeriod, staffId: string) {
  const href = new URLSearchParams(getPayrollHref({ period, tab: "settings" }).split("?")[1]);
  href.set("editStaff", staffId);
  return `/payroll?${href.toString()}`;
}

function taxLineRateLabel(line: PayrollStaffLineWithDailyTotals) {
  if (line.is_mixed_rate && line.tax_withheld !== 0) {
    return "Mixed rate";
  }

  return formatPercent(line.tax_rate_used);
}

function dailyCommissionGross(dailyTotal: PayrollStaffDailyTotal) {
  if (dailyTotal.pay_type_used === "fixed") {
    return Number(dailyTotal.fixed_pay_amount_used ?? 0);
  }

  if (dailyTotal.pay_type_used === "commission") {
    return (
      (Number(dailyTotal.gross_sales) *
        Number(dailyTotal.commission_rate_used ?? 0)) /
      100
    );
  }

  return 0;
}

function CompactPayoutLabel({
  method,
  taxed,
}: {
  method: string;
  taxed: boolean;
}) {
  return (
    <span className="whitespace-nowrap text-[11px] font-medium text-zinc-500">
      <WorkspaceText text={formatPayoutMethod(method)} />
      {taxed ? (
        <>
          {" \u00b7 "}
          <WorkspaceText text="Tax" />
        </>
      ) : null}
    </span>
  );
}

const INPUT_HISTORY_FIELD_LABELS: Record<string, string> = {
  bonus_amount: "Bonus",
  check_number: "Check #",
  note: "Note",
};

function inputHistoryLabel(changeType: string) {
  return changeType === "correction_request"
    ? "Correction request"
    : "Input update";
}

function inputHistoryFields(
  fieldChanges: Record<string, { current: unknown; previous: unknown }>,
) {
  const fields = Object.keys(fieldChanges);

  if (fields.length === 0) {
    return "No field changes";
  }

  return fields.map((field) => INPUT_HISTORY_FIELD_LABELS[field] ?? field).join(", ");
}

type SettingChange = {
  current: string;
  label: string;
  previous: string | null;
};

function settingCashToTaxCompany(setting: StaffPayrollSetting) {
  return Boolean(setting.cash_to_tax_company);
}

function describeSettingChanges(
  current: StaffPayrollSetting,
  previous: StaffPayrollSetting | null,
): SettingChange[] {
  if (!previous) {
    return [
      {
        current: "Saved",
        label: "Initial setting",
        previous: null,
      },
    ];
  }

  const changes: SettingChange[] = [];
  const addChange = (label: string, previousValue: string, currentValue: string) => {
    if (previousValue !== currentValue) {
      changes.push({
        current: currentValue,
        label,
        previous: previousValue,
      });
    }
  };

  addChange("Legal name", previous.legal_name ?? "-", current.legal_name ?? "-");
  addChange("Pay type", previous.pay_type, current.pay_type);
  addChange(
    "Commission rate",
    formatPercent(previous.commission_rate),
    formatPercent(current.commission_rate),
  );
  addChange(
    "Fixed pay",
    formatMoney(previous.fixed_pay_amount),
    formatMoney(current.fixed_pay_amount),
  );
  addChange(
    "Check split",
    formatPercent(previous.check_rate),
    formatPercent(current.check_rate),
  );
  addChange("Tax", formatPercent(previous.tax_rate), formatPercent(current.tax_rate));
  addChange(
    "Tax fixed",
    formatYesNo(previous.apply_tax_to_fixed_pay),
    formatYesNo(current.apply_tax_to_fixed_pay),
  );
  addChange(
    "Tax tip",
    formatYesNo(previous.tax_tips),
    formatYesNo(current.tax_tips),
  );
  addChange(
    "Tax bonus",
    formatYesNo(previous.tax_bonus),
    formatYesNo(current.tax_bonus),
  );

  const previousCashToTaxCompany = settingCashToTaxCompany(previous);
  const currentCashToTaxCompany = settingCashToTaxCompany(current);
  const showCashToTaxCompanyChange =
    previousCashToTaxCompany !== currentCashToTaxCompany;

  if (showCashToTaxCompanyChange) {
    addChange(
      "Tax cash",
      formatOnOff(previousCashToTaxCompany),
      formatOnOff(currentCashToTaxCompany),
    );
  }

  addChange(
    "Tip payout",
    formatPayoutMethod(previous.tip_payout_method),
    formatPayoutMethod(current.tip_payout_method),
  );
  addChange(
    "Bonus payout",
    formatPayoutMethod(previous.bonus_payout_method),
    formatPayoutMethod(current.bonus_payout_method),
  );

  return changes;
}

function ShopIncomeCard({ label, subLines, tone = "default", value }: {
  label: string; subLines: Array<{ label: string; value: string }>; tone?: "default" | "warning"; value: string;
}) {
  return <PayrollDisclosure className={styles.staffCard} summary={<div className={styles.staffSummary}><strong><WorkspaceText text={label} /></strong><strong className={tone === "warning" ? "text-rose-700" : ""}><WorkspaceText text={value} /></strong></div>}>
    <div className="p-4"><div className={styles.desktopOnly}><p className="text-xs font-medium uppercase tracking-wide text-zinc-500"><WorkspaceText text={label} /></p><p className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-rose-700" : "text-zinc-950"}`}><WorkspaceText text={value} /></p></div>
    <dl className="grid gap-2 text-sm text-zinc-600 lg:mt-3">{subLines.map(line=><div className="flex items-center justify-between gap-3" key={line.label}><dt><WorkspaceText text={line.label} /></dt><dd className="font-medium text-zinc-800">{line.value}</dd></div>)}</dl></div>
  </PayrollDisclosure>;
}

function monthInputFromPeriod(period: PayrollPeriod) {
  return period.startDate.slice(0, 7);
}

function NoPermissionState({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <WorkspaceText text={message} />
      </p>
      <Link className="text-sm font-medium text-zinc-700 underline" href="/">
        <WorkspaceText text="Back to dashboard" />
      </Link>
    </main>
  );
}

function PayrollPeriodNavigation(props: Parameters<typeof PeriodSelector>[0]) {
  const {period,activeTab}=props;
  return <section>
    <div className={styles.periodNav}>
      <Link aria-label="Previous period" href={getPayrollHref({period:adjacentPayrollPeriod(period,-1),tab:activeTab})}>‹</Link>
      <details className={styles.periodPicker}><summary>{formatDate(period.startDate)} – {formatDate(period.endDate)}</summary><div><PeriodSelector {...props}/></div></details>
      <Link aria-label="Next period" href={getPayrollHref({period:adjacentPayrollPeriod(period,1),tab:activeTab})}>›</Link>
    </div>
    <div className={styles.periodModes}>
      <Link href={`/payroll?tab=${activeTab}`} aria-current={period.preset!=="custom"?"page":undefined}><WorkspaceText text="Pay period"/></Link>
      <Link href={`/payroll?tab=${activeTab}&preset=custom&start=${period.startDate.slice(0,7)}-01&end=${new Date(Date.UTC(Number(period.startDate.slice(0,4)),Number(period.startDate.slice(5,7)),0,12)).toISOString().slice(0,10)}`}><WorkspaceText text="Month"/></Link>
      <details><summary><WorkspaceText text="Custom"/></summary><form action="/payroll"><input type="hidden" name="tab" value={activeTab}/><input type="hidden" name="preset" value="custom"/><label><WorkspaceText text="From"/><input type="date" name="start" required defaultValue={period.startDate}/></label><label><WorkspaceText text="To"/><input type="date" name="end" required defaultValue={period.endDate}/></label><button className={styles.action}><WorkspaceText text="Apply"/></button></form></details>
      <small><WorkspaceText text="Live"/></small>
    </div>
  </section>;
}

function PeriodSelector({
  activeTab,
  period,
  periodOptions,
  salonPayrollSetting,
  scheduleSetup,
}: {
  activeTab: PayrollTab;
  period: PayrollPeriod;
  periodOptions: Awaited<ReturnType<typeof getPayrollPageData>>["periodOptions"];
  salonPayrollSetting: SalonPayrollSetting;
  scheduleSetup: Awaited<ReturnType<typeof getPayrollPageData>>["scheduleSetup"];
}) {
  const scheduleCycle = salonPayrollSetting.cycle_type;
  const missingBiweeklyAnchor = scheduleSetup.needsBiweeklyAnchor;

  return (
    <div className="min-w-0 space-y-2">
    <PayrollFilterToolbar summary={<WorkspaceElement as="p" className="truncate" title={period.label}><WorkspaceText text={period.label} /></WorkspaceElement>} periodLabel={period.label} active={period.preset === "custom"}>
      <form
        action="/payroll"
        className="flex flex-wrap items-end gap-3"
      >
        <input name="tab" type="hidden" value={activeTab} />
        {scheduleCycle === "monthly" ? (
          <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Month" />
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={monthInputFromPeriod(period)}
              name="month"
              type="month"
            />
          </label>
        ) : null}
        {scheduleCycle === "semi_monthly" ? (
          <>
            <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-zinc-700">
              <WorkspaceText text="Month" />
              <input
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                defaultValue={monthInputFromPeriod(period)}
                name="month"
                type="month"
              />
            </label>
            <label className="flex min-w-64 flex-col gap-1 text-sm font-medium text-zinc-700">
              <WorkspaceText text="Period" />
              <select
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                defaultValue={
                  period.preset === "semi_monthly_second" ? "second" : "first"
                }
                name="segment"
              >
                <option value="first">First: 1 - 15</option>
                <option value="second">Second: 16 - end of month</option>
              </select>
            </label>
          </>
        ) : null}
        {scheduleCycle === "biweekly" ? (
          <label className="flex min-w-0 w-full sm:w-72 flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Pay period" />
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              disabled={missingBiweeklyAnchor}
              name="payPeriodStart"
              defaultValue={period.startDate}
            >
              {missingBiweeklyAnchor ? (
                <option value=""><WorkspaceText text="Set anchor in Settings" /></option>
              ) : (
                periodOptions.map((option) => (
                  <option key={option.value} value={option.startDate}>
                    <WorkspaceText text={option.label} />
                  </option>
                ))
              )}
            </select>
          </label>
        ) : null}
        <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          <WorkspaceText text="Apply" />
        </button>
      </form>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-600">
          <WorkspaceText text="Advanced custom range" />
        </summary>
        <form action="/payroll" className="mt-3 flex flex-wrap items-end gap-3">
          <input name="tab" type="hidden" value={activeTab} />
          <input name="preset" type="hidden" value="custom" />
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Start" />
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.startDate}
              name="start"
              type="date"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="End" />
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.endDate}
              name="end"
              type="date"
            />
          </label>
          <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800">
            <WorkspaceText text="Apply Custom" />
          </button>
        </form>
      </details>
    </PayrollFilterToolbar>
      {missingBiweeklyAnchor ? (
        <p className="text-sm text-amber-700">
          <WorkspaceText text="Every-2-weeks payroll needs an anchor date. Update it in Settings." />
        </p>
      ) : null}
    </div>
  );
}

function Tabs({activeTab,canViewAllPayroll,period}:{activeTab:PayrollTab;canViewAllPayroll:boolean;period:PayrollPeriod}) {
  const tabs: {id:PayrollTab;label:string}[]=canViewAllPayroll?[{id:"overview",label:"Overview"},{id:"analytics",label:"Analytics"},{id:"staff",label:"Staff"},{id:"shop",label:"Shop"},{id:"tools",label:"Tools"}]:[{id:"staff",label:"Staff"}];
  return <nav className={styles.mobileNav} aria-label="Payroll sections">{tabs.map(tab=><Link key={tab.id} href={getPayrollHref({period,tab:tab.id})} aria-current={activeTab===tab.id||tab.id==="overview"&&["differences","history"].includes(activeTab)||tab.id==="tools"&&["settings","tax","download"].includes(activeTab)?"page":undefined}><WorkspaceText text={tab.label}/></Link>)}</nav>;
}

function StaffIncomeTab({ canManage, lines, period, history }: {
  canManage: boolean; lines: PayrollStaffLineWithDailyTotals[]; period: PayrollPeriod; history: PayrollLiveChange[];
}) {
  if (!lines.length) return <p className={styles.panel}><WorkspaceText text="No staff income lines for this period." /></p>;
  return <section className="grid gap-3">
    <div className={styles.heading}><h2 className="text-base font-semibold"><WorkspaceText text="Staff Income" /></h2><p className={styles.context}>{lines.length} <WorkspaceText text="Staff" /> · <WorkspaceText text="Current calculation" /></p></div>
    {lines.map(line => <PayrollDisclosure key={`${period.startDate}:${period.endDate}:${line.staff_id}`} className={styles.staffCard} summary={<div className={styles.staffSummary}>
      <div><strong>{line.staff_display_name_snapshot}</strong>{!line.staff_legal_name_snapshot && <small className="!text-amber-700"><WorkspaceText text="Missing legal name" /></small>}{line.final_check_amount < 0 && <small className="!text-rose-700"><WorkspaceText text="Check amount negative" /></small>}</div>
      <div className={styles.staffMoney}><strong>{formatMoney(line.final_staff_income)}</strong><small><WorkspaceText text="Cash" /> {formatMoney(line.final_cash_amount)}</small><small><WorkspaceText text="Check" /> {formatMoney(line.final_check_amount)}</small></div>
    </div>}>
      {history.some(change=>change.staff_id===line.staff_id)&&<PayrollChangeHistory compact changes={history.filter(change=>change.staff_id===line.staff_id)} />}
      <div className={styles.staffBody}>
        <section className={styles.staffSection}><h3>{line.staff_display_name_snapshot} · <WorkspaceText text="Actual Payout" /></h3><dl className={styles.ledger}>
          <div><dt><WorkspaceText text="Cash" /></dt><dd>{formatMoney(line.final_cash_amount)}</dd></div>
          <div><dt><WorkspaceText text="Check" /></dt><dd className={line.final_check_amount < 0 ? "text-rose-700" : ""}>{formatMoney(line.final_check_amount)}</dd></div>
          <div><dt><WorkspaceText text="Total" /></dt><dd className="font-semibold">{formatMoney(line.final_staff_income)}</dd></div>
          <div><dt><WorkspaceText text="Tax" /></dt><dd>{taxLineRateLabel(line)} · {formatMoney(line.tax_withheld)}</dd></div>
          <div><dt><WorkspaceText text="Tip" /></dt><dd>{formatMoney(line.tip_amount)} <CompactPayoutLabel method={line.tip_payout_method_snapshot} taxed={line.tax_tips_snapshot} /></dd></div>
        </dl></section>
        <section className={styles.staffSection}><h3><WorkspaceText text="Wage / Net Details" /></h3><dl className={styles.ledger}>
          <div><dt><WorkspaceText text="Shop Gross" /></dt><dd>{formatMoney(line.gross_sales)}</dd></div>
          <div><dt><WorkspaceText text="Comm Gross" /></dt><dd>{formatMoney(line.staff_commission_gross)}</dd></div>
          <div><dt><WorkspaceText text="Cash Net" /></dt><dd>{formatMoney(line.base_cash_amount)}</dd></div>
          <div><dt><WorkspaceText text="Check Net" /></dt><dd>{formatMoney(line.check_net)}</dd></div>
        </dl></section>
        <section className={styles.staffSection}><h3><WorkspaceText text="Period adjustments" /></h3><StaffIncomeAutosaveInputs inputUpdatedAt={line.input?.updated_at ?? null} bonusAmount={line.bonus_amount} bonusPayoutMethod={line.bonus_payout_method_snapshot} canManage={canManage && period.cycleType !== "custom"} checkNumber={line.check_number} cycleType={period.cycleType} note={line.note} periodEnd={period.endDate} periodStart={period.startDate} staffId={line.staff_id} taxBonus={line.tax_bonus_snapshot} /></section>
      </div>
      <details className="border-t p-4"><summary className="text-sm font-medium"><WorkspaceText text="Breakdown" /></summary>
        {line.dailyTotals.length ? <div className="grid gap-3">{line.dailyTotals.map(day => <div key={day.id} className="rounded-lg bg-zinc-50 p-3"><p className="mb-2 text-sm font-medium"><WorkspaceText text={formatDate(day.business_date)} /></p><dl className={styles.ledger}><div><dt><WorkspaceText text="Shop Gross" /></dt><dd>{formatMoney(day.gross_sales)}</dd></div><div><dt><WorkspaceText text="Comm Gross" /></dt><dd>{formatMoney(dailyCommissionGross(day))}</dd></div><div><dt><WorkspaceText text="Tip" /></dt><dd>{formatMoney(day.tip_amount)}</dd></div></dl></div>)}</div> : <p className="text-sm text-zinc-500"><WorkspaceText text="No daily rows for this staff member." /></p>}
        {Boolean(line.inputHistory?.length) && <details className="mt-3 border-t pt-2"><summary className="text-sm font-medium"><WorkspaceText text="Input history" /></summary><ul className="grid gap-2 text-sm">{line.inputHistory?.map(history => <li key={history.id}><WorkspaceText text={inputHistoryLabel(history.change_type)} /> · {inputHistoryFields(history.field_changes)}<p className="text-xs text-zinc-500"><WorkspaceText text={formatDateTime(history.created_at)} /></p></li>)}</ul></details>}
      </details>
    </PayrollDisclosure>)}
  </section>;
}

function ShopIncomeTab({
  rows,
  summary,
}: {
  rows: PayrollShopDailyRow[];
  summary: PayrollShopSummary;
}) {
  const hasActual = summary.totalActualIncome !== null;
  const shopNetIsNegative =
    summary.shopNetIncome !== null && summary.shopNetIncome < 0;

  return (
    <section className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <ShopIncomeCard
          label="Total Actual"
          subLines={[
            { label: "Cash", value: formatOptionalMoney(summary.cashAmount) },
            { label: "Card", value: formatOptionalMoney(summary.creditCardAmount) },
            { label: "Other", value: formatOptionalMoney(summary.otherAmount) },
          ]}
          value={formatOptionalMoney(
            summary.totalActualIncome,
            "Missing actual input",
          )}
        />
        <ShopIncomeCard
          label="Total Staff Obligation"
          subLines={[
            { label: "Staff Pay", value: formatMoney(summary.staffNetPay) },
            { label: "Tips Paid", value: formatMoney(summary.tipsPaid) },
            { label: "Tax Withheld", value: formatMoney(summary.taxWithheld) },
          ]}
          value={formatMoney(summary.totalStaffObligation)}
        />
        <ShopIncomeCard
          label="Shop Net Income"
          subLines={[
            {
              label: "Actual",
              value: hasActual ? formatMoney(summary.totalActualIncome ?? 0) : "-",
            },
            {
              label: "Staff Obligation",
              value: formatMoney(summary.totalStaffObligation),
            },
          ]}
          tone={shopNetIsNegative ? "warning" : "default"}
          value={formatOptionalMoney(summary.shopNetIncome, "Missing actual input")}
        />
      </div>
      <p className="text-sm text-zinc-500"><WorkspaceText text="Shop Net is before other operating expenses." /></p>
      <ShopIncomeDailyTable rows={rows} />
      <PayrollDisclosure summary="How shop income is calculated" className={styles.compactNote}>
        <h2 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Notes" /></h2>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Total Actual" /></dt>
            <dd><WorkspaceText text="Total money actually collected from daily input: Cash + Card + Other." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="POS" /></dt>
            <dd><WorkspaceText text="Expected collected amount recorded by POS for comparison with Actual." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Total Staff Obligation" /></dt>
            <dd><WorkspaceText text="Money handled for staff: Staff Pay + Tips Paid + Tax Withheld." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Staff Pay" /></dt>
            <dd><WorkspaceText text="Net commission or fixed pay after tax withholding." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Tips Paid" /></dt>
            <dd><WorkspaceText text="Tips paid to staff after optional tip tax withholding." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Tax Withheld" /></dt>
            <dd><WorkspaceText text="Staff income withheld for IRS. It is not shop profit." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Shop Net Income" /></dt>
            <dd><WorkspaceText text="Total Actual minus Total Staff Obligation, before future expenses." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Corrections" /></dt>
            <dd><WorkspaceText text="Only after-close changes are counted here; same-day edits before closing are not." /></dd>
          </div>
        </dl>
      </PayrollDisclosure>
    </section>
  );
}

function TaxTab({period,taxCompany,plugin,canManageConnection}:{period:PayrollPeriod;taxCompany:Awaited<ReturnType<typeof getPayrollPageData>>["taxCompany"];plugin:Awaited<ReturnType<typeof taxCompanySettings>>|null;canManageConnection:boolean;hasChanges:boolean}) {
  if(canManageConnection&&plugin&&!plugin.active)return <PluginActivationPrompt pluginName="Tax Company" label="Connect your tax company"/>;
  return <section className={styles.panel}><h2><WorkspaceText text="Current payroll report"/></h2><p>{period.label}</p><p><WorkspaceText text="Current amounts update immediately after edits."/></p><p>{taxCompany.lines.length} <WorkspaceText text="Reportable lines"/></p><Link className={`${styles.action} ${styles.primary}`} href={getTaxCompanyHref(period)}><WorkspaceText text="View current report"/></Link>{canManageConnection&&<Link className={styles.action} href="/payroll/tax-company/settings"><WorkspaceText text="Connection and access"/></Link>}</section>;
}
function ToolsTab({ period, downloadEnabled, canActivate }: { period: PayrollPeriod; downloadEnabled: boolean | null; canActivate: boolean }) {
  const links: { tab: PayrollTab; title: string; subtitle: string }[] = [
    { tab: "history", title: "Change history", subtitle: "Current data and recorded changes" },
    { tab: "settings", title: "Payroll settings", subtitle: "Schedule, compensation and withholding" },
    { tab: "tax", title: "Tax Company", subtitle: "Connection, saved reports and paystubs" },
    ...(downloadEnabled ? [{ tab: "download" as const, title: "Download", subtitle: "Payroll Data Download" }] : []),
  ];
  return <section className={styles.tools}>{links.map(link => <Link className={styles.toolLink} key={link.tab} href={getPayrollHref({ period, tab: link.tab })}><span><strong><WorkspaceText text={link.title} /></strong><small><WorkspaceText text={link.subtitle} /></small></span><span aria-hidden="true">→</span></Link>)}{canActivate && downloadEnabled === false && <PluginActivationButton pluginName="Payroll Data Download" label="Download payroll data" buttonLabel="Download" />}</section>;
}

function SettingChip({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded bg-white px-2 py-1 text-zinc-700 ring-1 ring-zinc-200">
      {children}
    </span>
  );
}

function formatSettingDate(value: string | null | undefined) {
  return value ? formatDate(value) : "Default";
}

function settingPayTypeLabel(setting: StaffPayrollSetting | null) {
  return setting?.pay_type === "fixed" ? "Fixed" : "Commission";
}

function SettingsHistory({ history }: { history: StaffPayrollSetting[] }) {
  return (
    <details className="border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600">
        <WorkspaceText text="History" />
      </summary>
      {history.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {history.map((version, index) => {
            const changes = describeSettingChanges(
              version,
              history[index + 1] ?? null,
            );

            return (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
                key={version.id || version.effective_from}
              >
                <span className="font-medium text-zinc-900">
                  <WorkspaceText text={formatDate(version.effective_from)} />
                </span>
                <span className="text-zinc-500">
                  <WorkspaceText text="Changed" />{" "}
                  <WorkspaceText text={version.updated_at
                    ? formatDateTime(version.updated_at)
                    : "Unknown"} />
                </span>
                {changes.length > 0 ? (
                  <>
                    {changes.map((change) => (
                      <SettingChip key={change.label}>
                        <WorkspaceText text={change.previous
                          ? `${change.label}: ${change.previous} to ${change.current}`
                          : `${change.label}: ${change.current}`} />
                      </SettingChip>
                    ))}
                  </>
                ) : (
                  <span><WorkspaceText text="No manual field changes" /></span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          <WorkspaceText text="No effective setting history yet." />
        </p>
      )}
    </details>
  );
}

function SettingGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <WorkspaceText text={title} />
      </h4>
      <dl className="grid gap-2">{children}</dl>
    </section>
  );
}

function SettingField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
      <dt className="shrink-0 text-zinc-500"><WorkspaceText text={label} />:</dt>
      <dd className="min-w-0 font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

function SettingStatus({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-zinc-200 bg-zinc-50 text-zinc-600"
      }`}
    >
      {children}
    </span>
  );
}

function staffInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ST";
}

function StaffProfileAvatar({
  displayName,
  imageUrl,
}: {
  displayName: string;
  imageUrl: string | null;
}) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
      {imageUrl ? (
        <WorkspaceElement as="img"
          alt=""
          className="h-full w-full rounded-full object-cover"
          src={imageUrl}
        />
      ) : (
        staffInitials(displayName)
      )}
    </span>
  );
}

function SettingsReadContent({
  period,
  setting,
  staff,
  staffProfileAvatarUrl,
  staffProfileDisplayName,
  canManage,
}: {
  canManage: boolean;
  period: PayrollPeriod;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
  staffProfileAvatarUrl: string | null;
  staffProfileDisplayName: string;
}) {
  const payType = settingPayTypeLabel(setting);
  const isFixed = setting?.pay_type === "fixed";
  const taxCash = Boolean(setting?.cash_to_tax_company);
  const taxTip = Boolean(setting?.tax_tips);
  const taxBonus = Boolean(setting?.tax_bonus);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StaffProfileAvatar
            displayName={staffProfileDisplayName}
            imageUrl={staffProfileAvatarUrl}
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-zinc-950">
              {staffProfileDisplayName}
            </h3>
            {setting?.legal_name ? (
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                <WorkspaceText text="Legal name:" /> {setting.legal_name}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-zinc-600">
              <WorkspaceText text="Effective from" /> <WorkspaceText text={formatSettingDate(setting?.effective_from)} />
            </p>
          </div>
        </div>
        {canManage && <Link
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
          href={getSettingsEditHref(period, staff.id)}
        >
          <WorkspaceText text="Edit" />
        </Link>}
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <SettingGroup title="Compensation">
          <SettingField label="Pay type">{payType}</SettingField>
          {isFixed ? (
            <SettingField label="Fixed pay">
              {formatMoney(setting?.fixed_pay_amount ?? 0)}
            </SettingField>
          ) : (
            <SettingField label="Commission split rate">
              {formatPercent(setting?.commission_rate ?? 60)}
            </SettingField>
          )}
          <SettingField label="Check split">
            {formatPercent(setting?.check_rate ?? 60)}
          </SettingField>
        </SettingGroup>

        <SettingGroup title="Tax reporting">
          <SettingField label="Tax rate">
            {formatPercent(setting?.tax_rate ?? 0)}
          </SettingField>
          {isFixed ? (
            <SettingField label="Tax fixed">
              <WorkspaceText text={formatYesNo(Boolean(setting?.apply_tax_to_fixed_pay))} />
            </SettingField>
          ) : null}
          <SettingField label="Tax cash">
            <SettingStatus active={taxCash}><WorkspaceText text={formatOnOff(taxCash)} /></SettingStatus>
          </SettingField>
          <SettingField label="Tax tip">
            <SettingStatus active={taxTip}><WorkspaceText text={formatYesNo(taxTip)} /></SettingStatus>
          </SettingField>
          <SettingField label="Tax bonus">
            <SettingStatus active={taxBonus}><WorkspaceText text={formatYesNo(taxBonus)} /></SettingStatus>
          </SettingField>
        </SettingGroup>

        <SettingGroup title="Payout">
          <SettingField label="Tip payout">
            <WorkspaceText text={formatPayoutMethod(setting?.tip_payout_method ?? "cash")} />
          </SettingField>
          <SettingField label="Bonus payout">
            <WorkspaceText text={formatPayoutMethod(setting?.bonus_payout_method ?? "check")} />
          </SettingField>
        </SettingGroup>
      </div>
    </>
  );
}

function SettingsStaffCard({
  canManage,
  history,
  isEditing,
  period,
  returnPath,
  setting,
  staff,
  staffProfileAvatarUrl,
  staffProfileDisplayName,
}: {
  canManage: boolean;
  history: StaffPayrollSetting[];
  isEditing: boolean;
  period: PayrollPeriod;
  returnPath: string;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
  staffProfileAvatarUrl: string | null;
  staffProfileDisplayName: string;
}) {
  return (
    <PayrollDisclosure initiallyOpen={isEditing} className={styles.staffCard} summary={<div><strong>{staffProfileDisplayName}</strong><p className={styles.context}>{settingPayTypeLabel(setting)} · <WorkspaceText text="Effective from" /> <WorkspaceText text={formatSettingDate(setting?.effective_from)} /></p></div>}>
      <div className="grid gap-4 p-4">
      {isEditing ? (
        <StaffPayrollSettingInlineEdit
          period={period}
          returnPath={returnPath}
          setting={setting}
          staff={staff}
          staffProfileAvatarUrl={staffProfileAvatarUrl}
          staffProfileDisplayName={staffProfileDisplayName}
        />
      ) : (
        <SettingsReadContent canManage={canManage}
          period={period}
          setting={setting}
          staff={staff}
          staffProfileAvatarUrl={staffProfileAvatarUrl}
          staffProfileDisplayName={staffProfileDisplayName}
        />
      )}
      <SettingsHistory history={history} />
      </div>
    </PayrollDisclosure>
  );
}

function SettingsExplanationNote() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
      <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Setting notes" /></h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Compensation" /></p>
          <p className="mt-1">
            <WorkspaceText text="Pay type controls whether staff is paid by commission or fixed pay. Commission split rate is the staff share of production. Check split controls how much base pay goes to check versus cash." />
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Tax reporting" /></p>
          <p className="mt-1">
            <WorkspaceText text="Tax rate is the withholding/reporting rate. Tax cash controls whether cash wage is shown on Tax Company. Tax tip and Tax bonus control whether tips and bonuses are included in tax reporting." />
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Payout" /></p>
          <p className="mt-1">
            <WorkspaceText text="Tip payout and Bonus payout decide whether those amounts are paid by check or cash. They do not change the amount earned." />
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Effective date" /></p>
          <p className="mt-1">
            <WorkspaceText text="Settings apply from the effective date forward. Older payroll periods keep using the setting that was effective for that period." />
          </p>
        </div>
      </div>
      <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        <WorkspaceText text="Tax cash controls whether cash wage is reported to Tax Company. Tip and bonus payout methods do not decide whether those amounts are taxed." />
      </p>
    </section>
  );
}

function SettingsTab({
  canManage,
  editStaffId,
  period,
  returnPath,
  salonPayrollSetting,
  settings,
}: {
  canManage: boolean;
  editStaffId: string | undefined;
  period: PayrollPeriod;
  returnPath: string;
  salonPayrollSetting: SalonPayrollSetting;
  settings: StaffPayrollSettingWithStaff[];
}) {
  return (
    <section className="grid gap-6" id="payroll-settings">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-950"><WorkspaceText text="Shop Payroll Schedule" /></h2>
        <fieldset disabled={!canManage}><PayrollScheduleForm
          action={saveSalonPayrollScheduleAction}
          anchorDate={salonPayrollSetting.biweekly_anchor_date}
          cycleType={salonPayrollSetting.cycle_type}
          returnPath={returnPath}
        /></fieldset>
      </div>

      <div className="grid gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            <WorkspaceText text="Staff Payroll Settings" />
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            <WorkspaceText text="Staff-specific compensation, tax reporting, payout, and effective settings." />
          </p>
        </div>
        <div className="grid gap-3">
          {settings.map(
            ({
              history,
              setting,
              staff,
              staffProfileAvatarUrl,
              staffProfileDisplayName,
            }) => {
              const isEditing = canManage && editStaffId === staff.id;

              return (
                <SettingsStaffCard canManage={canManage}
                  history={history}
                  isEditing={isEditing}
                  key={staff.id}
                  period={period}
                  returnPath={returnPath}
                  setting={setting}
                  staff={staff}
                  staffProfileAvatarUrl={staffProfileAvatarUrl}
                  staffProfileDisplayName={staffProfileDisplayName}
                />
              );
            },
          )}
        </div>
        <PayrollDisclosure summary="Setting notes" className={styles.compactNote}><SettingsExplanationNote /></PayrollDisclosure>
      </div>
    </section>
  );
}

export function AppLocalOwnerPayrollView({ value, params }: { value: AppLocalOwnerPayrollData; params: AppLocalOwnerPayrollParams }) {
  const {payroll:data,salonId,canManageConnection,taxPlugin,downloadEnabled}=value;
  const activeTab = getActiveTab(params.tab, data.access.canViewAllPayroll);
  const returnPath = getReturnPath(data.period, activeTab);
  const visiblePayrollError =
    params.payroll_error?.includes("Biweekly payroll requires") &&
    data.salonPayrollSetting.cycle_type === "monthly"
      ? null
      : params.payroll_error;

  return (
    <PayrollEditBoundary><main className={`${styles.page} mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8`}>
      <h1 className="sr-only"><WorkspaceText text="Payroll" /></h1>
      <PayrollLiveRefresh salonId={salonId} />
      <PayrollRecordedFactsPanel facts={data.recordedFacts}/>
      <Tabs
        activeTab={activeTab}
        canViewAllPayroll={data.access.canViewAllPayroll}
        period={data.period}
      />
      {visiblePayrollError&&<p role="alert" className={styles.warning}><WorkspaceText text={visiblePayrollError}/></p>}
      {!["settings","tools","download"].includes(activeTab)&&<>
        <PayrollPeriodNavigation activeTab={activeTab} period={data.period} salonPayrollSetting={data.salonPayrollSetting} periodOptions={data.periodOptions} scheduleSetup={data.scheduleSetup}/>
      </>}
      {["overview","analytics","differences"].includes(activeTab)&&<PayrollDashboard tab={activeTab as "overview"|"analytics"|"differences"} lines={data.live.lines} rows={data.live.shopDailyRows} services={data.serviceAnalytics} today={data.today} historyCount={data.history.length} historyHref={getPayrollHref({period:data.period,tab:"history"})} differencesHref={getPayrollHref({period:data.period,tab:"differences"})}/>}
      {activeTab==="history"&&<PayrollChangeHistory changes={data.history} staffNames={Object.fromEntries(data.staffPayrollSettings.map(row=>[row.staff.id,row.staffProfileDisplayName??row.staff.display_name]))}/>}
      {activeTab === "staff" ? (
        <StaffIncomeTab
          canManage={data.access.canManagePayroll}
          lines={data.live.lines}
          history={data.history}
          period={data.period}
        />
      ) : null}
      {activeTab === "shop" && data.access.canViewAllPayroll ? (
        <ShopIncomeTab
          rows={data.live.shopDailyRows}
          summary={data.live.shopSummary}
        />
      ) : null}
      {["staff","shop"].includes(activeTab)&&<footer className={styles.output}><Link className={styles.action} href={getPayrollHref({period:data.period,tab:"download"})}><WorkspaceText text="Download current data"/></Link><Link className={styles.action} href={getPayrollHref({period:data.period,tab:"history"})}><WorkspaceText text="Change history"/></Link></footer>}
      {activeTab === "tax" && data.access.canViewAllPayroll ? (
        <TaxTab canManageConnection={canManageConnection} period={data.period} taxCompany={data.taxCompany} plugin={taxPlugin} hasChanges={data.difference.changed} />
      ) : null}
      {activeTab === "settings" && data.access.canViewAllPayroll ? (
        <SettingsTab canManage={data.access.canManagePayroll}
          editStaffId={params.editStaff}
          period={data.period}
          returnPath={returnPath}
          salonPayrollSetting={data.salonPayrollSetting}
          settings={data.staffPayrollSettings}
        />
      ) : null}
      {activeTab === "tools" && data.access.canViewAllPayroll && <ToolsTab period={data.period} downloadEnabled={downloadEnabled} canActivate={canManageConnection} />}
      {activeTab === "download" && downloadEnabled === false && canManageConnection && <PluginActivationButton pluginName="Payroll Data Download" label="Download payroll data" buttonLabel="Download" />}
      {activeTab === "download" && downloadEnabled && data.access.canViewAllPayroll ? <DataDownloadPanel salonId={salonId} key={`${salonId}-${data.period.startDate}-${data.period.endDate}`} startDate={data.period.startDate} endDate={data.period.endDate} /> : null}
      {canManageConnection && ["tools", "download"].includes(activeTab) && downloadEnabled === null && <p role="status" className="text-sm"><WorkspaceText text="Download status unavailable. Reload payroll." /></p>}
    </main></PayrollEditBoundary>
  );
}

