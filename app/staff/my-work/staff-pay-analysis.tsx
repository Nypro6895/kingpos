import {FinancialHistoryProvider,InlineFinancialHistory} from "@/app/payroll/inline-financial-history";
import {PayrollObjectHistory} from "@/app/payroll/payroll-object-history";
import {financialHistoryForObject} from "@/lib/inline-financial-history";
import {StaffPayrollDailyRows} from "./staff-payroll-daily-rows";
import {PayrollPaymentComparison} from "@/app/payroll/payroll-payment-comparison";
import inlineStyles from "@/app/payroll/payroll-object-history.module.css";
import Link from "next/link";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { StaffPayPeriodPicker } from "./staff-pay-period-picker";
import type { StaffPayrollPortalData } from "@/lib/payroll";
import type { StaffPayrollView, StaffAnalysisView } from "@/lib/staff-my-work-experience";
import { staffPayRules, staffPayrollRowDisplay } from "@/lib/staff-payroll-display";
import { StaffPaymentTable } from "@/app/payroll/staff-payment-table";
import { shiftStaffDate } from "@/lib/staff-payroll-period";
import styles from "./staff-pay-analysis.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));

function Period({ data, tab }: { data: Pick<StaffPayrollPortalData, "period" | "periodOptions">; tab: "payroll" | "analysis" }) {
  if (!data.period) return null;
  return <div className={styles.payPeriod}><StaffPayPeriodPicker tab={tab} options={data.periodOptions} selected={`${data.period.startDate}:${data.period.endDate}`} />{tab !== "payroll" && <Link href="/account/tax-documents"><WorkspaceText text="My documents · Current & Archive" /></Link>}</div>;
}

function PayRules({ data }: { data: StaffPayrollView }) {
  const rules = staffPayRules(data.line, data.settings);
  const changes=financialHistoryForObject(data.history??[],{sourceKinds:["payroll_settings","staff_payroll_settings"]});
  return <details className={`${styles.disclosure} ${changes.length?inlineStyles.edited:""}`}><summary><WorkspaceText text="Applied settings & changes" />{changes.length>0&&<span className={inlineStyles.badge}><WorkspaceText text="Pay settings edited"/> · {changes.length}</span>}</summary>
    {rules.length === 0 ? <p className={styles.note}><WorkspaceText text="Your payroll settings are not available yet." /></p> : rules.map((rule, index) => <div className={styles.rules} key={index}>
      {rules.length > 1 && <small className={styles.ruleDate}><WorkspaceText text={rule.from ? `From ${date(rule.from)}` : "Period settings"} /><WorkspaceText text={rule.to ? ` to ${date(rule.to)}` : ""} /></small>}
      <p><WorkspaceText text={rule.commission !== null ? `Commission ${number(rule.commission)}%` : rule.fixed !== null ? `Fixed pay ${money(rule.fixed)}/period` : "Multiple pay rates"} /></p>
      <p><WorkspaceText text="Tax" /> {number(rule.tax)}%{rule.fixed !== null && !rule.fixedTax ? <small><WorkspaceText text="Fixed pay · No tax" /></small> : null}</p>
    </div>)}<InlineFinancialHistory changes={changes}/>
  </details>;
}

export function StaffMyPay({ data, salonId="", scope="", historyQuery }: { data: StaffPayrollView;salonId?:string;scope?:string;historyQuery?:string }) {
  if (!data.period) return <p data-continuous-surface className={styles.empty}><WorkspaceText text="No active staff payroll profile is linked to this salon." /></p>;
  const line = data.line;
  const bonusChanges=financialHistoryForObject(data.history??[],{sourceKinds:["payroll_period_staff_inputs"]});
  const display = line ? staffPayrollRowDisplay(line) : null;

  const markedPaid = data.paymentEvidence?.markedPaidStatements ?? [];
  const paymentNote = markedPaid.length
    ? "An earlier statement for this period was marked paid. This historical flag does not confirm that the current live amount was paid."
    : "Current income is a live calculation. Review recorded payment evidence separately; no payment status is inferred.";
  return <FinancialHistoryProvider salonId={salonId} surface="payroll" start={data.period.startDate} end={data.period.endDate} scope={scope} query={historyQuery} initialChanges={data.history??[]}><section className={styles.portal}><Period data={data} tab="payroll" />
    {line ? <div data-continuous-surface className={styles.hero + " " + styles.payHero} data-staff-pay-summary>
      <div className={styles.total}><div><p><WorkspaceText text="Take-home" /></p><small><WorkspaceText text="Check + Cash · after tax" /></small></div><strong>{money(line.final_staff_income)}</strong></div>
      <dl className={styles.split}><div><dt><WorkspaceText text="Check" /></dt><dd>{money(line.final_check_amount)}</dd></div><div><dt><WorkspaceText text="Cash" /></dt><dd>{money(line.final_cash_amount)}</dd></div></dl>
      <p className={styles.calculationStatus}><WorkspaceText text="Current calculation" /> · <WorkspaceText text={data.status.label} /></p>
    </div> : <p data-continuous-surface className={styles.empty}><WorkspaceText text="No payroll has been calculated for you in this period." /></p>}
    <div className={styles.paySections}>
      {line && display && <section>
        <details className={styles.payBreakdown} data-staff-pay-breakdown>
          <summary><h2><WorkspaceText text="Pay breakdown" /></h2><span><WorkspaceText text="Details" /></span></summary>
          <div className={styles.payContext}>
            <p><WorkspaceText text="Services" /> <strong>{money(line.gross_sales)}</strong></p>
            <p>{display.settings.filter(parts => parts[0] === "Commission" || parts[0] === "Fixed pay").map((parts, i) => <span key={i}>{i > 0 && " / "}{parts.map((part, j) => <span key={j}>{j > 0 && " "}<WorkspaceText text={part} /></span>)}</span>)}{display.settings.every(parts => parts[0] !== "Commission" && parts[0] !== "Fixed pay") && <WorkspaceText text="Service pay · Multiple rates" />} → <strong>{money(line.staff_commission_gross)}</strong></p>
            <p className={styles.appliedRates}>{display.settings.filter(parts => parts[0] !== "Commission" && parts[0] !== "Fixed pay").map((parts, i) => <span key={i}>{parts.map((part, j) => <span key={j}>{j > 0 && " "}<WorkspaceText text={part} /></span>)}</span>)}</p>
          </div>
          <StaffPaymentTable line={line} showTotal />
          <p className={styles.includedNote}><WorkspaceText text="Check and Cash include the net amounts assigned to each payment method. Tip and Bonus are already included." /></p>
          {bonusChanges.length > 0 && <PayrollObjectHistory changes={bonusChanges} label="Bonus edited" />}
        </details>
      </section>}
      <section className={styles.payDaily}><h2><WorkspaceText text="Daily breakdown" /></h2><p className={styles.note}><WorkspaceText text="Entered service amounts and tips, before commission and tax." /></p><StaffPayrollDailyRows data={data} /></section>
      <PayRules data={data} />
      <details className={styles.disclosure}><summary><WorkspaceText text="Payment records" /></summary>{line && data.paymentEvidence?.recordedFacts && <PayrollPaymentComparison facts={data.paymentEvidence.recordedFacts} line={line} period={data.period} showPayments />}<p className={styles.note}><WorkspaceText text={paymentNote} /><WorkspaceText text={line?.check_number ? " Check #" + line.check_number + "." : ""} /></p>{line?.note && <p className={styles.note}>{line.note}</p>}</details>
      <p className={styles.note}><WorkspaceText text="Live calculation does not confirm payment received." /></p>
      <Link href="/account/tax-documents"><WorkspaceText text="My documents · Current & Archive" /></Link>
    </div>
  </section></FinancialHistoryProvider>;
}

export function StaffMyAnalysis({ data, today }: { data: StaffAnalysisView; today: string }) {
  if (!data.period) return <p data-continuous-surface className={styles.empty}><WorkspaceText text="No active staff profile is linked to this salon." /></p>;
  const performance = data.workPerformance;
  const rows = performance.dailyActivity;
  const end = data.period.endDate < today ? data.period.endDate : today;
  const days: string[] = [];
  for (let day = data.period.startDate; day <= end && days.length < 32; day = shiftStaffDate(day, 1)) days.push(day);
  const byDay = new Map(rows.map(row => [row.businessDate, row]));
  const max = Math.max(1, ...rows.map(row => row.serviceTotal));
  const comparison = data.comparison;
  return <section className={styles.portal}><Period data={data} tab="analysis" />
    <div data-continuous-surface className={`${styles.hero} ${styles.payHero}`}><div className={styles.total}><div><p><WorkspaceText text="Service sales" /></p><small><WorkspaceText text="Through" /> <WorkspaceText text={date(end)} /> <WorkspaceText text="· completed tickets" /></small></div><strong>{money(performance.serviceTotal)}</strong></div>
      <dl className={styles.stats}><div><dt><WorkspaceText text="Turns" /></dt><dd>{number(performance.totalTurns)}</dd><small><WorkspaceText text="Big" /> {number(performance.bigTurns)} <WorkspaceText text="· Small" /> {number(performance.smallTurns)}</small></div><div><dt><WorkspaceText text="Tips" /></dt><dd>{money(performance.tipAmount)}</dd><small><WorkspaceText text="Your tickets" /></small></div><div><dt><WorkspaceText text="Avg / ticket" /></dt><dd>{money(performance.averageTicket)}</dd><small>{performance.ticketCount} <WorkspaceText text="tickets" /></small></div></dl>
    </div>
    {comparison && <div className={styles.comparison}><span className={comparison.deltaAmount >= 0 ? styles.positive : styles.negative}><WorkspaceText text={comparison.deltaPercent === null ? "No percentage comparison yet" : `${comparison.deltaAmount >= 0 ? "↑" : "↓"} ${number(Math.abs(comparison.deltaPercent))}% services vs previous period`} /></span><details><summary><span aria-hidden="true">ⓘ</span><span className={styles.srOnly}><WorkspaceText text="Comparison dates" /></span></summary><small>{comparison.currentLabel} <WorkspaceText text="vs" /> <WorkspaceText text={comparison.previousLabel} /><WorkspaceText text=". Equal calendar-day windows." /><WorkspaceText text={comparison.deltaPercent === null ? " Previous window has no completed sales." : ""} /></small></details></div>}
    <div className={styles.columns}><section><h2><WorkspaceText text="Services by day" /></h2>{rows.length ? <figure className={styles.chart}>
      <WorkspaceElement as="div" className={styles.bars} role="img" aria-label={`Daily service sales in USD from ${date(data.period.startDate)} to ${date(end)}. Full amounts in daily activity below.`}>{days.map(day => <div key={day} className={styles.bar} style={{ height: `${Math.max(0, (byDay.get(day)?.serviceTotal ?? 0) / max * 100)}%` }}><span>{money(byDay.get(day)?.serviceTotal ?? 0)}</span></div>)}</WorkspaceElement>
      <div className={styles.axis}><span><WorkspaceText text={date(data.period.startDate)} /></span><span><WorkspaceText text={date(end)} /></span></div><figcaption className={styles.note}>USD</figcaption>
    </figure> : <p data-continuous-surface className={styles.empty}><WorkspaceText text="No completed services in this period yet." /></p>}
      <details className={styles.disclosure}><summary><WorkspaceText text="Daily activity ·" /> {rows.length} <WorkspaceText text="active days" /></summary>{rows.length > 0 && <table className={styles.table}><thead><tr><th scope="col"><WorkspaceText text="Date" /></th><th scope="col"><WorkspaceText text="Turns" /></th><th scope="col"><WorkspaceText text="Tip" /></th><th scope="col"><WorkspaceText text="Sales" /></th></tr></thead><tbody>{[...rows].reverse().map(row => <tr key={row.businessDate}><td><WorkspaceText text={date(row.businessDate)} /></td><td>{number(row.turns)}</td><td>{money(row.tipAmount)}</td><td>{money(row.serviceTotal)}</td></tr>)}</tbody></table>}</details>
    </section><section><details className={styles.disclosure}><summary><WorkspaceText text="Top services" /></summary>{performance.topServices.length ? <dl>{performance.topServices.map((service, index) => <div className={styles.row} key={`${service.serviceId}-${index}`}><dt>{service.serviceName}<small>{number(service.count)} <WorkspaceText text="services" /></small></dt><dd>{money(service.revenue)}</dd></div>)}</dl> : <p className={styles.note}><WorkspaceText text="No completed services yet." /></p>}<small><WorkspaceText text="Service counts can exceed ticket counts." /></small></details></section></div>
  </section>;
}
