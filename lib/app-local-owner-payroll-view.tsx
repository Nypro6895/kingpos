"use client";
import {financialHistoryForObject} from "@/lib/inline-financial-history";
import {FinancialHistoryProvider,InlineFinancialHistory} from "@/app/payroll/inline-financial-history";
import {PayrollObjectHistory} from "@/app/payroll/payroll-object-history";
import inlineStyles from "@/app/payroll/payroll-object-history.module.css";

import type { AppLocalOwnerPayrollData, AppLocalOwnerPayrollParams } from "./app-local-owner-page-types";

import { PayrollDailyListing } from "@/app/payroll/payroll-daily-listing";
import { PayrollDashboard } from "@/app/payroll/payroll-dashboard";
import { PayrollPeriodRail } from "@/app/payroll/payroll-period-rail";
import { PayrollTabs } from "@/app/payroll/payroll-tabs";
import { StaffIncomeCard } from "@/app/payroll/staff-income-card";
import { payrollRailChoices } from "@/lib/payroll-period-rail";
import { PayrollPaymentComparison } from "@/app/payroll/payroll-payment-comparison";
import type {PayrollRecordedFacts} from "@/types/payroll-records";
import {FinancialHistoryWithFocus} from "@/app/payroll/financial-history-with-focus";
import { PayrollLiveRefresh } from "@/app/payroll/payroll-live-refresh";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import type { taxCompanySettings } from "@/lib/tax-company";
import { PayrollDisclosure } from "@/app/payroll/payroll-disclosure";
import { PayrollEditBoundary } from "@/app/payroll/payroll-edit-boundary";
import styles from "@/app/payroll/payroll-mobile.module.css";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { DataDownloadPanel } from "@/app/payroll/data-download-panel";
import { PluginActivationPrompt, PluginActivationButton } from "@/app/settings/plugin-settings-row";

import { saveSalonPayrollScheduleAction } from "@/app/payroll/actions";
import { PayrollScheduleForm } from "@/app/payroll/payroll-schedule-form";
import { StaffIncomeAutosaveInputs } from "@/app/payroll/staff-income-autosave-inputs";
import { ShopIncomeDailyTable } from "@/app/payroll/shop-income-daily-table";
import { StaffPayrollSettingInlineEdit } from "@/app/payroll/staff-payroll-setting-inline-edit";
import type { getPayrollPageData } from "@/lib/payroll";
import type { PayrollPeriod, PayrollStaffLineWithDailyTotals, PayrollShopDailyRow, PayrollShopSummary, SalonPayrollSetting, StaffPayrollSetting, StaffPayrollSettingWithStaff } from "@/types/payroll";
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







function StaffIncomeTab({ canPrintChecks, canManage, lines, period, history, salonId, today, recordedFacts, scope, historyQuery }: {
  canPrintChecks: boolean; canManage: boolean; lines: PayrollStaffLineWithDailyTotals[]; period: PayrollPeriod; history: PayrollLiveChange[]; salonId:string; today:string; recordedFacts:PayrollRecordedFacts; scope:string; historyQuery?:string;
}) {
  if (!lines.length) return <p className={styles.panel}><WorkspaceText text="No staff income lines for this period." /></p>;
  return <FinancialHistoryProvider salonId={salonId} surface="payroll" start={period.startDate} end={period.endDate} scope={scope} query={historyQuery} initialChanges={history}><section className="grid gap-3" aria-label="Staff payroll">
    {lines.map(line => <StaffIncomeCard key={`${period.startDate}:${period.endDate}:${line.staff_id}`} line={line}
      history={<PayrollObjectHistory changes={financialHistoryForObject(history,{staffId:line.staff_id,sourceKinds:["payroll_settings","staff_payroll_settings"]})} label="Pay settings edited"/>}
      adjustments={<>{canPrintChecks&&<Link className="inline-flex min-h-11 items-center px-3 text-sm text-teal-700" href={`/check-writer?start=${period.startDate}&end=${period.endDate}&staff=${line.staff_id}`}><WorkspaceText text="Print check"/></Link>}<StaffIncomeAutosaveInputs inputUpdatedAt={line.input?.updated_at ?? null} bonusAmount={line.bonus_amount} bonusPayoutMethod={line.bonus_payout_method_snapshot} canManage={canManage && period.cycleType !== "custom"} checkNumber={line.check_number} cycleType={period.cycleType} note={line.note} periodEnd={period.endDate} periodStart={period.startDate} staffId={line.staff_id} taxBonus={line.tax_bonus_snapshot} /><PayrollObjectHistory changes={financialHistoryForObject(history,{staffId:line.staff_id,sourceKinds:["payroll_period_staff_inputs"]})} label="Period inputs edited"/></>}
      breakdown={<><PayrollPaymentComparison facts={recordedFacts} line={line} period={period} canRecord={canManage} scope={scope} showPayments/><PayrollDailyListing rows={line.dailyTotals} salonId={salonId} canManage={canManage} today={today} history={history} /></>}
    />)}
  </section></FinancialHistoryProvider>;
}

function ShopIncomeTab({
  rows,
  summary,
  salonId, history, canReadChecks, historyQuery,
}: {
  rows: PayrollShopDailyRow[];
  summary: PayrollShopSummary;
  salonId: string; history: PayrollLiveChange[]; canReadChecks: boolean; historyQuery?:string;
}) {
  const hasActual = summary.totalActualIncome !== null;
  const shopNetIsNegative =
    summary.shopNetIncome !== null && summary.shopNetIncome < 0;

  return (
    <section className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <ShopIncomeCard
          label="Service collected"
          subLines={[
            { label: "Cash", value: formatOptionalMoney(summary.cashAmount) },
            { label: "Card", value: formatOptionalMoney(summary.creditCardAmount) },
            { label: "Other", value: formatOptionalMoney(summary.otherAmount) },
            { label: "Tip collected (separate)", value: formatOptionalMoney(summary.totalActualTip ?? null) },
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
            { label: "Tips after tax", value: formatMoney(summary.tipsPaid) },
            { label: "Tax Withheld", value: formatMoney(summary.taxWithheld) },
          ]}
          value={formatMoney(summary.totalStaffObligation)}
        />
        <ShopIncomeCard
          label="Shop Net Income"
          subLines={[
            {
              label: "Service collected",
              value: hasActual ? formatMoney(summary.totalActualIncome ?? 0) : "-",
            },
            { label: "Tip collected", value: formatOptionalMoney(summary.totalActualTip ?? null) },
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
      <FinancialHistoryProvider salonId={salonId} surface="payroll" initialChanges={history} query={historyQuery}><ShopIncomeDailyTable rows={rows} salonId={salonId} history={history} canReadChecks={canReadChecks}/></FinancialHistoryProvider>
      <PayrollDisclosure summary="How shop income is calculated" className={styles.compactNote}>
        <h2 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Notes" /></h2>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Service collected" /></dt>
            <dd><WorkspaceText text="Cash + Card + Other excludes tips. Tip collected is entered and reconciled separately." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Expected service" /></dt>
            <dd><WorkspaceText text="Staff gross service inputs minus customer discounts. Discounts do not reduce Staff gross service inputs." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Total Staff Obligation" /></dt>
            <dd><WorkspaceText text="Calculated Staff Pay + Tips after tax + Tax Withheld. This is the obligation, not a payment record." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Staff Pay" /></dt>
            <dd><WorkspaceText text="Net commission or fixed pay after tax withholding." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Tips after tax" /></dt>
            <dd><WorkspaceText text="Calculated tips after optional tax withholding; actual payments are recorded separately." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Tax Withheld" /></dt>
            <dd><WorkspaceText text="Staff income withheld for IRS. It is not shop profit." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Shop Net Income" /></dt>
            <dd><WorkspaceText text="Service collected plus tip collected minus total staff obligation, before other expenses." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Corrections" /></dt>
            <dd><WorkspaceText text="Saved input edits are shown on their original work day. Automatic checks are separate from edits." /></dd>
          </div>
        </dl>
      </PayrollDisclosure>
    </section>
  );
}

function TaxTab({period,taxCompany,plugin,canManageConnection}:{period:PayrollPeriod;taxCompany:Awaited<ReturnType<typeof getPayrollPageData>>["taxCompany"];plugin:Awaited<ReturnType<typeof taxCompanySettings>>|null;canManageConnection:boolean;hasChanges:boolean}) {
  if(canManageConnection&&plugin&&!plugin.active)return <PluginActivationPrompt pluginName="Tax Company" label="Connect your tax company"/>;
  return <section className={styles.panel}><p>{period.label}</p><p><WorkspaceText text="Current amounts update immediately after edits."/></p><p>{taxCompany.lines.length} <WorkspaceText text="Reportable lines"/></p><Link className={`${styles.action} ${styles.primary}`} href={getTaxCompanyHref(period)}><WorkspaceText text="View current report"/></Link>{canManageConnection&&<Link className={styles.action} href="/payroll/tax-company/settings"><WorkspaceText text="Connection and access"/></Link>}</section>;
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
  inputChanges = [],
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
  inputChanges?: PayrollLiveChange[];
  isEditing: boolean;
  period: PayrollPeriod;
  returnPath: string;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
  staffProfileAvatarUrl: string | null;
  staffProfileDisplayName: string;
}) {
  return (
    <PayrollDisclosure initiallyOpen={isEditing} className={`${styles.staffCard} ${inputChanges.length?inlineStyles.edited:""}`} summary={<div><strong>{staffProfileDisplayName}</strong>{inputChanges.length>0&&<span className={inlineStyles.badge}><WorkspaceText text="Edited"/> · {inputChanges.length}</span>}<p className={styles.context}>{settingPayTypeLabel(setting)} · <WorkspaceText text="Effective from" /> <WorkspaceText text={formatSettingDate(setting?.effective_from)} /></p></div>}>
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
      <InlineFinancialHistory changes={inputChanges}/>{!inputChanges.length&&history.length>1&&<SettingsHistory history={history}/>}
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
  changes = [],
  editStaffId,
  period,
  returnPath,
  salonPayrollSetting,
  settings,
}: {
  canManage: boolean;
  changes?: PayrollLiveChange[];
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
                  inputChanges={financialHistoryForObject(changes,{staffId:staff.id,sourceKinds:["payroll_settings","staff_payroll_settings"]})}
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
  const historyQuery=new URLSearchParams(Object.entries(params).filter((entry):entry is [string,string]=>typeof entry[1]==="string")).toString();
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
      <PayrollTabs
        activeTab={activeTab}
        canViewAllPayroll={data.access.canViewAllPayroll}
        period={data.period}
      />
      {visiblePayrollError&&<p role="alert" className={styles.warning}><WorkspaceText text={visiblePayrollError}/></p>}
      <PayrollPeriodRail activeTab={activeTab} period={data.period} {...payrollRailChoices(data.period, data.salonPayrollSetting)} needsAnchor={data.scheduleSetup.needsBiweeklyAnchor}/>
      {["overview","analytics","differences"].includes(activeTab)&&<PayrollDashboard tab={activeTab as "overview"|"analytics"|"differences"} lines={data.live.lines} rows={data.live.shopDailyRows} services={data.serviceAnalytics} today={data.today} historyCount={data.history.length} historyHref={getPayrollHref({period:data.period,tab:"history"})} differencesHref={getPayrollHref({period:data.period,tab:"differences"})}/>}
      {activeTab==="history"&&<FinancialHistoryWithFocus salonId={salonId} scope={value.payrollScope} historyQuery={historyQuery} changes={data.history} staffNames={Object.fromEntries(data.staffPayrollSettings.map(row=>[row.staff.id,row.staffProfileDisplayName??row.staff.display_name]))}/>}
      {activeTab === "staff" ? (
        <StaffIncomeTab
          salonId={salonId}
          today={data.today}
          canPrintChecks={canManageConnection}
          canManage={data.access.canManagePayroll}
          lines={data.live.lines}
          history={data.history}
          period={data.period}
          recordedFacts={data.recordedFacts}
          scope={value.payrollScope} historyQuery={historyQuery}
        />
      ) : null}
      {activeTab === "shop" && data.access.canViewAllPayroll ? (
        <ShopIncomeTab
          rows={data.live.shopDailyRows}
          summary={data.live.shopSummary}
          salonId={salonId} history={data.history} canReadChecks={canManageConnection} historyQuery={historyQuery}
        />
      ) : null}
      {["staff","shop"].includes(activeTab)&&<footer className={styles.output}><Link className={styles.action} href={getPayrollHref({period:data.period,tab:"download"})}><WorkspaceText text="Download current data"/></Link></footer>}
      {activeTab === "tax" && data.access.canViewAllPayroll ? (
        <TaxTab canManageConnection={canManageConnection} period={data.period} taxCompany={data.taxCompany} plugin={taxPlugin} hasChanges={data.difference.changed} />
      ) : null}
      {activeTab === "settings" && data.access.canViewAllPayroll ? (
        <SettingsTab canManage={data.access.canManagePayroll} changes={data.history}
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

