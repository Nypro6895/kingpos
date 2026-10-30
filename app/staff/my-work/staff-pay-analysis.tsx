import { PayrollChangeHistory } from "@/app/payroll/payroll-change-history";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { StaffPayPeriodPicker } from "./staff-pay-period-picker";
import type { StaffPayrollPortalData } from "@/lib/payroll";
import type { StaffPayrollView, StaffAnalysisView } from "@/lib/staff-my-work-experience";
import { staffPayRules } from "@/lib/staff-payroll-display";
import { shiftStaffDate } from "@/lib/staff-payroll-period";
import styles from "./staff-pay-analysis.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));

function Period({ data, tab }: { data: Pick<StaffPayrollPortalData, "period" | "periodOptions">; tab: "payroll" | "analysis" }) {
  if (!data.period) return null;
  return <div className={styles.payPeriod}><StaffPayPeriodPicker tab={tab} options={data.periodOptions} selected={`${data.period.startDate}:${data.period.endDate}`} /></div>;
}

function PayRules({ data }: { data: StaffPayrollView }) {
  const rules = staffPayRules(data.line, data.settings);
  return <details className={styles.disclosure}><summary><WorkspaceText text="How my pay is calculated" /></summary>
    {rules.length === 0 ? <p className={styles.note}><WorkspaceText text="Your payroll settings are not available yet." /></p> : rules.map((rule, index) => <div className={styles.rules} key={index}>
      {rules.length > 1 && <small className={styles.ruleDate}><WorkspaceText text={rule.from ? `From ${date(rule.from)}` : "Period settings"} /><WorkspaceText text={rule.to ? ` to ${date(rule.to)}` : ""} /></small>}
      <p><WorkspaceText text={rule.commission !== null ? `Commission ${number(rule.commission)}%` : rule.fixed !== null ? `Fixed pay ${money(rule.fixed)}/period` : "Multiple pay rates"} /></p>
      <p><WorkspaceText text="Tax" /> {number(rule.tax)}%{rule.fixed !== null && !rule.fixedTax ? <small><WorkspaceText text="Fixed pay · No tax" /></small> : null}</p>
      <p><WorkspaceText text="Tip ·" /> {rule.tipsTax ? <WorkspaceText text="Tax" /> : "No tax"}</p>
      <p><WorkspaceText text="Bonus ·" /> {rule.bonusTax ? <WorkspaceText text="Tax" /> : "No tax"}</p>
    </div>)}
  </details>;
}

export function StaffMyPay({ data }: { data: StaffPayrollView }) {
  if (!data.period) return <p data-continuous-surface className={styles.empty}><WorkspaceText text="No active staff payroll profile is linked to this salon." /></p>;
  const line = data.line;
  const rows = [...data.dailyRows].sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  const tipTotal = rows.reduce((sum, row) => sum + row.tipAmount, 0);
  const dailyTotal = rows.reduce((sum, row) => sum + row.commissionGross + row.tipAmount, 0);

  const markedPaid = data.paymentEvidence?.markedPaidStatements ?? [];
  const paymentNote = markedPaid.length
    ? "An earlier statement for this period was marked paid. This historical flag does not confirm that the current live amount was paid."
    : "Current income is a live calculation. Review recorded payment evidence separately; no payment status is inferred.";
  return <section className={styles.portal}><Period data={data} tab="payroll" />
    {line ? <div data-continuous-surface className={`${styles.hero} ${styles.payHero}`}><div className={styles.total}><div><p><WorkspaceText text={"Current take-home pay"} /></p><small><WorkspaceText text="Calculated" /> · <WorkspaceText text={data.status.label} /></small></div><strong>{money(line.final_staff_income)}</strong></div>
      <dl className={styles.split}><div><dt><WorkspaceText text="Cash payout" /></dt><dd>{money(line.final_cash_amount)}</dd></div><div><dt><WorkspaceText text="Check payout" /></dt><dd>{money(line.final_check_amount)}</dd></div></dl></div> : <p data-continuous-surface className={styles.empty}><WorkspaceText text="No payroll has been calculated for you in this period." /></p>}
    <div id="input-history"><PayrollChangeHistory compact changes={data.history??[]} title="Daily inputs & pay settings history" /></div>
    <div className={styles.columns}>{line && <section><h2><WorkspaceText text="Pay breakdown" /></h2><dl>
      <div className={styles.row}><dt><WorkspaceText text="Service pay" /><small>{money(line.gross_sales)} <WorkspaceText text="in services" /></small></dt><dd>{money(line.staff_commission_gross)}</dd></div>
      <div className={styles.row}><dt><WorkspaceText text="Tips" /></dt><dd>{money(line.tip_amount)}</dd></div>
      {line.bonus_amount !== 0 && <div className={styles.row}><dt><WorkspaceText text="Bonus" /></dt><dd>{money(line.bonus_amount)}</dd></div>}
      <div className={styles.row}><dt><WorkspaceText text="Tax withheld" /></dt><dd>{line.tax_withheld > 0 ? "−" : ""}{money(Math.abs(line.tax_withheld))}</dd></div>
      <div className={`${styles.row} ${styles.sum}`}><dt><WorkspaceText text="Take-home pay" /></dt><dd>{money(line.final_staff_income)}</dd></div>
    </dl></section>}
    <section><h2><WorkspaceText text="Details" /></h2><PayRules data={data} />
      <details className={styles.disclosure}><summary><WorkspaceText text="Daily breakdown ·" /> {rows.length} <WorkspaceText text="days" /></summary>
        <p className={styles.note}><WorkspaceText text="Total = service pay + tip, before tax and period bonus." /></p>
        {rows.length ? <table className={styles.table}><thead><tr><th scope="col"><WorkspaceText text="Date" /></th><th scope="col"><WorkspaceText text="Tip" /></th><th scope="col"><WorkspaceText text="Total" /></th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><WorkspaceText text={date(row.businessDate)} /></td><td>{money(row.tipAmount)}</td><td><strong>{money(row.commissionGross + row.tipAmount)}</strong></td></tr>)}</tbody><tfoot><tr><td><strong><WorkspaceText text="Total" /></strong></td><td><strong>{money(tipTotal)}</strong></td><td><strong>{money(dailyTotal)}</strong></td></tr></tfoot></table> : <p className={styles.note}><WorkspaceText text="No daily payroll entries yet." /></p>}
      </details>
      <details className={styles.disclosure}><summary><WorkspaceText text="Payment details" /></summary><p className={styles.note}><WorkspaceText text={paymentNote} /><WorkspaceText text={line?.check_number ? ` Check #${line.check_number}.` : ""} /></p>{line?.note && <p className={styles.note}>{line.note}</p>}</details>
    </section></div>
  </section>;
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
      <WorkspaceElement as="div" className={styles.bars} role="img" aria-label={`Daily service sales in USD from ${date(data.period.startDate)} to ${date(end)}. Full amounts in daily activity below.`}>{days.map(day => <div key={day} className={styles.bar} style={{ height: `${Math.max(0, (byDay.get(day)?.serviceTotal ?? 0) / max * 100)}%` }} />)}</WorkspaceElement>
      <div className={styles.axis}><span><WorkspaceText text={date(data.period.startDate)} /></span><span><WorkspaceText text={date(end)} /></span></div><figcaption className={styles.note}>USD</figcaption>
    </figure> : <p data-continuous-surface className={styles.empty}><WorkspaceText text="No completed services in this period yet." /></p>}
      <details className={styles.disclosure}><summary><WorkspaceText text="Daily activity ·" /> {rows.length} <WorkspaceText text="active days" /></summary>{rows.length > 0 && <table className={styles.table}><thead><tr><th scope="col"><WorkspaceText text="Date" /></th><th scope="col"><WorkspaceText text="Turns" /></th><th scope="col"><WorkspaceText text="Tip" /></th><th scope="col"><WorkspaceText text="Sales" /></th></tr></thead><tbody>{[...rows].reverse().map(row => <tr key={row.businessDate}><td><WorkspaceText text={date(row.businessDate)} /></td><td>{number(row.turns)}</td><td>{money(row.tipAmount)}</td><td>{money(row.serviceTotal)}</td></tr>)}</tbody></table>}</details>
    </section><section><details className={styles.disclosure}><summary><WorkspaceText text="Top services" /></summary>{performance.topServices.length ? <dl>{performance.topServices.map((service, index) => <div className={styles.row} key={`${service.serviceId}-${index}`}><dt>{service.serviceName}<small>{number(service.count)} <WorkspaceText text="services" /></small></dt><dd>{money(service.revenue)}</dd></div>)}</dl> : <p className={styles.note}><WorkspaceText text="No completed services yet." /></p>}<small><WorkspaceText text="Service counts can exceed ticket counts." /></small></details></section></div>
  </section>;
}
