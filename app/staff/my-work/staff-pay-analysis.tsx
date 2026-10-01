import Link from "next/link";
import type { StaffPayrollPortalData, StaffAnalysisPortalData } from "@/lib/payroll";
import { staffPayRules } from "@/lib/staff-payroll-display";
import { shiftStaffDate } from "@/lib/staff-payroll-period";
import styles from "./staff-pay-analysis.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));

function Period({ data, tab }: { data: Pick<StaffPayrollPortalData, "period" | "periodOptions">; tab: "payroll" | "analysis" }) {
  if (!data.period) return null;
  return <div className={styles.period}><p>Pay period · <strong>{date(data.period.startDate)}–{date(data.period.endDate)}, {data.period.endDate.slice(0, 4)}</strong></p>
    <details className={styles.history}><summary>History</summary><nav aria-label="Pay periods">{data.periodOptions.map((period, index) => <Link prefetch={false} key={period.value} href={`/staff/my-work?tab=${tab}&payPeriodStart=${encodeURIComponent(period.value)}`} aria-current={period.startDate === data.period?.startDate && period.endDate === data.period?.endDate ? "page" : undefined}>{index === 0 ? "Current · " : ""}{period.label}</Link>)}</nav></details>
  </div>;
}

function PayRules({ data }: { data: StaffPayrollPortalData }) {
  const rules = staffPayRules(data.line, data.settings);
  return <details className={styles.disclosure}><summary>How my pay is calculated</summary>
    {rules.length === 0 ? <p className={styles.note}>Your payroll settings are not available yet.</p> : rules.map((rule, index) => <div className={styles.rules} key={index}>
      {rules.length > 1 && <small className={styles.ruleDate}>{rule.from ? `From ${date(rule.from)}` : "Period settings"}{rule.to ? ` to ${date(rule.to)}` : ""}</small>}
      <p>{rule.commission !== null ? `Commission ${number(rule.commission)}%` : rule.fixed !== null ? `Fixed pay ${money(rule.fixed)}/day` : "Multiple pay rates"}</p>
      <p>Tax {number(rule.tax)}%{rule.fixed !== null && !rule.fixedTax ? <small>Fixed pay · No tax</small> : null}</p>
      <p>Tip · {rule.tipsTax ? "Tax" : "No tax"}</p>
      <p>Bonus · {rule.bonusTax ? "Tax" : "No tax"}</p>
    </div>)}
  </details>;
}

export function StaffMyPay({ data }: { data: StaffPayrollPortalData }) {
  if (!data.period) return <p className={styles.empty}>No active staff payroll profile is linked to this salon.</p>;
  const line = data.line;
  const rows = [...data.dailyRows].sort((a, b) => b.businessDate.localeCompare(a.businessDate));
  const tipTotal = rows.reduce((sum, row) => sum + row.tipAmount, 0);
  const dailyTotal = rows.reduce((sum, row) => sum + row.commissionGross + row.tipAmount, 0);
  const estimated = data.status.kind === "live";
  const paidAt = data.latestStatement?.run.paid_at;
  return <section className={styles.portal}><Period data={data} tab="payroll" />
    {line ? <div className={styles.hero}><div className={styles.total}><div><p>{estimated ? "Estimated take-home" : "Take-home pay"}</p><small>{data.status.label}{paidAt ? ` · ${date(paidAt)}` : ""}</small></div><strong>{money(line.final_staff_income)}</strong></div>
      <dl className={styles.split}><div><dt>Cash payout</dt><dd>{money(line.final_cash_amount)}</dd></div><div><dt>Check payout</dt><dd>{money(line.final_check_amount)}</dd></div></dl></div> : <p className={styles.empty}>No payroll has been calculated for you in this period.</p>}
    <div className={styles.columns}>{line && <section><h2>Pay breakdown</h2><dl>
      <div className={styles.row}><dt>Service pay<small>{money(line.gross_sales)} in services</small></dt><dd>{money(line.staff_commission_gross)}</dd></div>
      <div className={styles.row}><dt>Tips</dt><dd>{money(line.tip_amount)}</dd></div>
      {line.bonus_amount !== 0 && <div className={styles.row}><dt>Bonus</dt><dd>{money(line.bonus_amount)}</dd></div>}
      <div className={styles.row}><dt>Tax withheld</dt><dd>{line.tax_withheld > 0 ? "−" : ""}{money(Math.abs(line.tax_withheld))}</dd></div>
      <div className={`${styles.row} ${styles.sum}`}><dt>Take-home pay</dt><dd>{money(line.final_staff_income)}</dd></div>
    </dl></section>}
    <section><h2>Details</h2><PayRules data={data} />
      <details className={styles.disclosure}><summary>Daily breakdown · {rows.length} days</summary>
        <p className={styles.note}>Total = service pay + tip, before tax and period bonus.</p>
        {rows.length ? <table className={styles.table}><thead><tr><th scope="col">Date</th><th scope="col">Tip</th><th scope="col">Total</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{date(row.businessDate)}</td><td>{money(row.tipAmount)}</td><td><strong>{money(row.commissionGross + row.tipAmount)}</strong></td></tr>)}</tbody><tfoot><tr><td><strong>Total</strong></td><td><strong>{money(tipTotal)}</strong></td><td><strong>{money(dailyTotal)}</strong></td></tr></tfoot></table> : <p className={styles.note}>No daily payroll entries yet.</p>}
      </details>
      <details className={styles.disclosure}><summary>Payment details</summary><p className={styles.note}>{paidAt ? `Marked paid ${date(paidAt)}.` : "Payment has not been marked paid."}{line?.check_number ? ` Check #${line.check_number}.` : ""}{data.paystub ? "" : " Paystub not posted for this statement."}</p>{line?.note && <p className={styles.note}>{line.note}</p>}</details>
      {data.paystub?.view_url ? <a className={styles.action} href={data.paystub.view_url} target="_blank" rel="noreferrer">View / download paystub →</a> : data.paystub ? <p className={styles.note}>Paystub is posted, but its download is temporarily unavailable.</p> : null}
    </section></div>
  </section>;
}

export function StaffMyAnalysis({ data, today }: { data: StaffAnalysisPortalData; today: string }) {
  if (!data.period) return <p className={styles.empty}>No active staff profile is linked to this salon.</p>;
  const performance = data.workPerformance;
  const rows = performance.dailyActivity;
  const end = data.period.endDate < today ? data.period.endDate : today;
  const days: string[] = [];
  for (let day = data.period.startDate; day <= end && days.length < 32; day = shiftStaffDate(day, 1)) days.push(day);
  const byDay = new Map(rows.map(row => [row.businessDate, row]));
  const max = Math.max(1, ...rows.map(row => row.serviceTotal));
  const comparison = data.comparison;
  return <section className={styles.portal}><Period data={data} tab="analysis" />
    <div className={styles.hero}><div className={styles.total}><div><p>Service sales</p><small>Through {date(end)} · completed tickets</small></div><strong>{money(performance.serviceTotal)}</strong></div>
      <dl className={styles.stats}><div><dt>Turns</dt><dd>{number(performance.totalTurns)}</dd><small>Big {number(performance.bigTurns)} · Small {number(performance.smallTurns)}</small></div><div><dt>Tips</dt><dd>{money(performance.tipAmount)}</dd><small>Your tickets</small></div><div><dt>Avg / ticket</dt><dd>{money(performance.averageTicket)}</dd><small>{performance.ticketCount} tickets</small></div></dl>
    </div>
    {comparison && <div className={styles.comparison}><span className={comparison.deltaAmount >= 0 ? styles.positive : styles.negative}>{comparison.deltaPercent === null ? "No percentage comparison yet" : `${comparison.deltaAmount >= 0 ? "↑" : "↓"} ${number(Math.abs(comparison.deltaPercent))}% services vs previous period`}</span><details><summary>Comparison dates</summary><small>{comparison.currentLabel} vs {comparison.previousLabel}. Equal calendar-day windows.{comparison.deltaPercent === null ? " Previous window has no completed sales." : ""}</small></details></div>}
    <div className={styles.columns}><section><h2>Services by day</h2>{rows.length ? <figure className={styles.chart}>
      <div className={styles.bars} role="img" aria-label={`Daily service sales in USD from ${date(data.period.startDate)} to ${date(end)}. Full amounts in daily activity below.`}>{days.map(day => <div key={day} className={styles.bar} style={{ height: `${Math.max(0, (byDay.get(day)?.serviceTotal ?? 0) / max * 100)}%` }} />)}</div>
      <div className={styles.axis}><span>{date(data.period.startDate)}</span><span>{date(end)}</span></div><figcaption className={styles.note}>USD · peak {money(max)} · zero = no completed sales</figcaption>
    </figure> : <p className={styles.empty}>No completed services in this period yet.</p>}
      <details className={styles.disclosure}><summary>Daily activity · {rows.length} active days</summary>{rows.length > 0 && <table className={styles.table}><thead><tr><th scope="col">Date</th><th scope="col">Turns</th><th scope="col">Tip</th><th scope="col">Sales</th></tr></thead><tbody>{[...rows].reverse().map(row => <tr key={row.businessDate}><td>{date(row.businessDate)}</td><td>{number(row.turns)}</td><td>{money(row.tipAmount)}</td><td>{money(row.serviceTotal)}</td></tr>)}</tbody></table>}</details>
    </section><section><h2>Top services</h2>{performance.topServices.length ? <dl>{performance.topServices.map((service, index) => <div className={styles.row} key={`${service.serviceId}-${index}`}><dt>{service.serviceName}<small>{number(service.count)} services</small></dt><dd>{money(service.revenue)}</dd></div>)}</dl> : <p className={styles.note}>No completed services yet.</p>}<small>Service counts can exceed ticket counts.</small></section></div>
  </section>;
}
