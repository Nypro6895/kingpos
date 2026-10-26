"use client";

import { useState } from "react";
import Link from "next/link";
import { WorkspaceText as Text } from "@/components/workspace-language";
import { payrollLiveDashboard } from "@/lib/payroll-live-dashboard";
import { sumMoney } from "@/lib/payroll-live-money";
import type { PayrollServiceAnalytics, PayrollShopDailyRow, PayrollStaffLineWithDailyTotals } from "@/types/payroll";
import styles from "./payroll-dashboard.module.css";

const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
const day = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const colors = ["#234b38", "#2ba9ad", "#e4ae38", "#acc4b1", "#727f94"];

type Props = {
  tab: "overview" | "analytics" | "differences";
  lines: PayrollStaffLineWithDailyTotals[];
  rows: PayrollShopDailyRow[];
  services: PayrollServiceAnalytics;
  today: string;
  differencesHref: string;
  historyHref: string;
  historyCount: number;
};

function AmountRow({ label, value, total = false }: { label: string; value: number | null; total?: boolean }) {
  return <div className={total ? styles.totalRow : styles.row}><dt><Text text={label} /></dt><dd>{money(value)}</dd></div>;
}

export function PayrollDashboard({ tab, lines, rows, services, today, differencesHref, historyHref, historyCount }: Props) {
  const data = payrollLiveDashboard(lines, rows, today);
  if (tab === "differences") return <section className={styles.card}>
    <h2><Text text="Daily Report differences" /></h2>
    <p className={styles.note}><Text text="Daily Report collected minus POS expected. Missing reports are listed separately." /></p>
    <div className={styles.dayList}>{[...data.differences, ...data.missing].sort((a, b) => a.businessDate.localeCompare(b.businessDate)).map(row => <article key={row.businessDate} className={styles.day}>
      <header><strong>{day(row.businessDate)}</strong><span className={styles.warningLabel}><Text text={row.actualIncome === null ? "Report not entered" : row.difference! < 0 ? "Short" : "Over"} /></span></header>
      <dl><AmountRow label="POS expected" value={row.posIncome} /><AmountRow label="Daily Report collected" value={row.actualIncome} /><AmountRow label="Difference" value={row.difference} /></dl>
      <Link href={`/reports?date=${row.businessDate}`} className={styles.textLink}><Text text="Open Daily Report" /> ›</Link>
    </article>)}</div>
    {!data.differences.length && !data.missing.length && <p><Text text="All entered Daily Reports are balanced." /></p>}
  </section>;
  if (tab === "analytics") return <Analytics rows={rows} services={services} lines={lines} today={today} />;
  return <section className={styles.overview}>
    <div className={styles.summary}>
      <article className={styles.card}><p className={styles.metric}><Text text="Total collected" /></p><strong className={styles.amount}>{money(data.collected)}</strong><small><Text text="From Daily Report" /></small></article>
      <article className={styles.card}><p className={styles.metric}><Text text="Staff cost" /></p><strong className={styles.amount}>{money(data.staffCost)}</strong><small><Text text="Cash + check + tax" /></small></article>
      <article className={`${styles.hero} ${data.remaining !== null && data.remaining < 0 ? styles.loss : ""}`}>
        <p className={styles.metric}><Text text="Remaining after payroll" /></p><strong>{money(data.remaining)}</strong>
        <small><Text text="Daily Report total − staff cost" /></small>
      </article>
      <p className={styles.summaryNote}><Text text="Before supplies, utilities and rent." />{data.missing.length > 0 && <> <Text text="Partial total · some Daily Reports are not entered." /></>}</p>
    </div>
    <div className={styles.detailsGrid}>
      <section><div className={styles.card}><h2><Text text="Staff cost breakdown" /></h2><dl><AmountRow label="Cash payout" value={data.cash} /><AmountRow label="Check payout" value={data.check} /><AmountRow label="Tax withheld" value={data.tax} /><AmountRow label="Total staff cost" value={data.staffCost} total /></dl></div><p className={styles.note}><Text text="Tips and bonuses are included in payouts." /></p></section>
      <section className={styles.statusStack}>
        {data.differences.length > 0 && <Link className={styles.warning} href={differencesHref}><strong>⚠ <Text text={`${data.differences.length} days with differences`} /></strong><span><Text text={`${data.shortDays} short · ${data.overDays} over`} /> · <Text text="Net" /> {money(data.difference)}</span><span className={styles.review}><Text text="Review affected days" /> ›</span></Link>}
        <Link className={data.missing.length ? styles.pending : styles.good} href={differencesHref}><span><Text text={data.missing.length ? "Daily Reports to review" : "Daily Reports entered"} /></span><strong>{data.enteredDays}/{data.elapsedDays}</strong></Link>
        {historyCount > 0 && <Link className={styles.updated} href={historyHref}><span><Text text="Updated" /> · {historyCount}</span><span><Text text="View change history" /> ›</span></Link>}
        <section className={styles.card}><h2><Text text="Collection details" /></h2><dl><AmountRow label="Cash" value={data.collectionCash} /><AmountRow label="Card" value={data.collectionCard} /><AmountRow label="Other" value={data.collectionOther} /></dl></section>
      </section>
    </div>
  </section>;
}

function DailyLine({ rows, today }: { rows: PayrollShopDailyRow[]; today: string }) {
  const elapsed = rows.filter(row => row.businessDate <= today);
  const present = elapsed.filter(row => row.actualIncome !== null);
  const max = Math.max(1, ...present.map(row => row.actualIncome!));
  const ceiling = Math.ceil(max / 500) * 500;
  const x = (index: number) => 34 + index / Math.max(1, elapsed.length - 1) * 316;
  const y = (value: number) => 170 - value / ceiling * 150;
  let path = "", connected = false;
  elapsed.forEach((row, index) => {
    if (row.actualIncome === null) { connected = false; return; }
    path += `${connected ? "L" : "M"}${x(index)},${y(row.actualIncome)} `; connected = true;
  });
  const ranked = present.filter(row => row.actualIncome !== 0 || row.posIncome !== 0).sort((a, b) => a.actualIncome! - b.actualIncome!);
  return <section className={`${styles.card} ${styles.lineCard}`}><h2><Text text="Daily collections" /></h2><p className={styles.note}><Text text="From Daily Report" /></p>
    {present.length ? <>
      <svg className={styles.line} viewBox="0 0 360 205" role="img" aria-label="Daily collections in USD. Exact amounts in daily values below.">
        {[0, ceiling / 2, ceiling].map(value => <g key={value}><line x1="34" x2="350" y1={y(value)} y2={y(value)} stroke="#e5e9e6" strokeDasharray="3 4" /><text x="28" y={y(value) + 4} textAnchor="end">{value === 0 ? "$0" : `$${value / 1000}k`}</text></g>)}
        <path d={path} fill="none" stroke="#23503a" strokeWidth="2.5" strokeLinejoin="round" />
        {elapsed.map((row, index) => row.actualIncome === null ? null : <circle key={row.businessDate} cx={x(index)} cy={y(row.actualIncome)} r="3.5" fill="#23503a"><title>{day(row.businessDate)}: {money(row.actualIncome)}</title></circle>)}
        {[...new Set([0, Math.floor((elapsed.length - 1) / 2), elapsed.length - 1])].filter(index => index >= 0).map(index => <text key={index} x={x(index)} y="195" textAnchor={index === 0 ? "start" : index === elapsed.length - 1 ? "end" : "middle"}>{day(elapsed[index].businessDate)}</text>)}
      </svg>
      <div className={styles.extremes}><div><small><Text text="Highest" />{ranked.at(-1) ? ` · ${day(ranked.at(-1)!.businessDate)}` : ""}</small><strong>{money(ranked.at(-1)?.actualIncome ?? null)}</strong></div><div><small><Text text="Lowest active day" />{ranked[0] ? ` · ${day(ranked[0].businessDate)}` : ""}</small><strong>{money(ranked[0]?.actualIncome ?? null)}</strong></div></div>
      <details className={styles.dailyValues}><summary><Text text="Daily values" /></summary>{elapsed.map(row => <div className={styles.row} key={row.businessDate}><span>{day(row.businessDate)}</span><span>{row.actualIncome === null ? <Text text="Not entered" /> : money(row.actualIncome)}</span></div>)}</details>
    </> : <p className={styles.note}><Text text="Enter a Daily Report to see collections." /></p>}
    <p className={styles.note}><Text text="Missing reports appear as gaps, not zero." /></p>
  </section>;
}

function Analytics({ rows, services, lines, today }: Pick<Props, "rows" | "services" | "lines" | "today">) {
  const [serviceMetric, setServiceMetric] = useState<"revenue" | "count">("revenue");
  const [staffMetric, setStaffMetric] = useState<"sales" | "payout">("sales");
  const [serviceAscending, setServiceAscending] = useState(false), [staffAscending, setStaffAscending] = useState(false);
  const [allServices, setAllServices] = useState(false), [allStaff, setAllStaff] = useState(false);
  const sortedServices = [...services.rows].sort((a, b) => (serviceAscending ? 1 : -1) * (a[serviceMetric] - b[serviceMetric]) || a.serviceName.localeCompare(b.serviceName));
  const pieRows = [...services.rows].sort((a, b) => b[serviceMetric] - a[serviceMetric]);
  const slices = pieRows.slice(0, 4).map(row => ({ name: row.serviceName, value: row[serviceMetric] }));
  if (pieRows.length > 4) slices.push({ name: "Other services", value: sumMoney(pieRows.slice(4), row => row[serviceMetric]) });
  const total = sumMoney(services.rows, row => row[serviceMetric]);
  const drawableTotal = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  const segments = slices.map((slice, index) => { const start = drawableTotal > 0 ? slices.slice(0,index).reduce((sum,row)=>sum+Math.max(0,row.value),0)/drawableTotal*360 : 0; const end=start+(drawableTotal > 0 ? Math.max(0,slice.value)/drawableTotal*360 : 0); return `${colors[index]} ${start}deg ${end}deg`; });
  const sortedStaff = [...lines].sort((a, b) => (staffAscending ? 1 : -1) * ((staffMetric === "sales" ? a.gross_sales : a.final_staff_income) - (staffMetric === "sales" ? b.gross_sales : b.final_staff_income)) || a.staff_display_name_snapshot.localeCompare(b.staff_display_name_snapshot));
  return <section className={styles.analyticsGrid}>
    <DailyLine rows={rows} today={today} />
    <section className={styles.card}><header className={styles.cardHeader}><h2><Text text="Service revenue mix" /></h2><div className={styles.segment}><button aria-pressed={serviceMetric === "revenue"} onClick={() => setServiceMetric("revenue")}><Text text="Revenue" /></button><button aria-pressed={serviceMetric === "count"} onClick={() => setServiceMetric("count")}><Text text="Visits" /></button></div></header>
      {total > 0 && drawableTotal === total ? <div className={styles.mix}><div className={styles.donut} style={{ background: `conic-gradient(${segments.join(",")})` }} role="img" aria-label="Service percentage distribution. Values in legend."><div><strong>{serviceMetric === "revenue" ? money(total) : total}</strong><small><Text text={serviceMetric === "revenue" ? "Service sales" : "Service visits"} /></small></div></div><ul className={styles.legend}>{slices.map((slice, index) => <li key={slice.name}><i style={{ background: colors[index] }} /><span>{slice.name}</span><strong>{(slice.value / total * 100).toFixed(1)}%</strong></li>)}</ul></div> : <p className={styles.note}><Text text={services.rows.length ? "Percentage chart unavailable for negative or zero totals. See amounts below." : "No services in this period."} /></p>}
      <div className={styles.sort}><button onClick={() => {setServiceAscending(value => !value);setAllServices(true);}}><Text text={serviceAscending ? "Low → High" : "High → Low"} /> ⌄</button></div>
      {allServices?<div className={styles.rankList}>{sortedServices.map(row => <div className={styles.row} key={row.serviceId}><span>{row.serviceName}</span><strong>{serviceMetric === "revenue" ? money(row.revenue) : row.count}</strong></div>)}</div>:pieRows.length>0&&<div className={styles.extremes}><div><small><Text text="Highest"/> · {pieRows[0].serviceName}</small><strong>{serviceMetric==="revenue"?money(pieRows[0].revenue):pieRows[0].count}</strong></div><div><small><Text text="Lowest"/> · {pieRows.at(-1)!.serviceName}</small><strong>{serviceMetric==="revenue"?money(pieRows.at(-1)!.revenue):pieRows.at(-1)!.count}</strong></div></div>}
      {services.rows.length > 0 && <button className={styles.textLink} onClick={() => setAllServices(value => !value)}><Text text={allServices ? "Show less" : "View all services"} /> ›</button>}
    </section>
    <section className={styles.card}><header className={styles.cardHeader}><h2><Text text="Staff performance" /></h2><div className={styles.segment}><button aria-pressed={staffMetric === "sales"} onClick={() => setStaffMetric("sales")}><Text text="Sales" /></button><button aria-pressed={staffMetric === "payout"} onClick={() => setStaffMetric("payout")}><Text text="Payout" /></button></div></header><p className={styles.note}><Text text={staffMetric === "sales" ? "Service sales · Excludes tips" : "Cash + check · Includes tips and bonuses"} /></p>
      <div className={styles.sort}><button onClick={() => setStaffAscending(value => !value)}><Text text={staffAscending ? "Low → High" : "High → Low"} /> ⌄</button></div>
      <ol className={styles.rankList}>{(allStaff ? sortedStaff : sortedStaff.slice(0, 4)).map((line, index) => <li className={styles.staffRank} key={line.staff_id}><small>{index + 1}</small><span>{line.staff_display_name_snapshot}</span><i className={styles.rankBar} aria-hidden="true"><i style={{width:`${Math.max(0,staffMetric==="sales"?line.gross_sales:line.final_staff_income)/Math.max(1,...lines.map(row=>staffMetric==="sales"?row.gross_sales:row.final_staff_income))*100}%`}}/></i><strong>{money(staffMetric === "sales" ? line.gross_sales : line.final_staff_income)}</strong></li>)}</ol>
      {!lines.length && <p className={styles.note}><Text text="No staff payroll in this period." /></p>}
      {lines.length > 0 && <button className={styles.textLink} onClick={() => setAllStaff(value => !value)}><Text text={allStaff ? "Show less" : "View all staff"} /> ›</button>}
    </section>
  </section>;
}


