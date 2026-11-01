"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWorkspaceTranslation, WorkspaceText } from "@/components/workspace-language";
import type { TodayDashboard } from "@/lib/today-dashboard";
import { localHour, smoothLine, type DayStatistics } from "@/lib/today-statistics";
import styles from "./today-statistics.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
const colors = ["var(--amber)", "var(--teal)", "var(--blue)", "var(--peach)", "var(--purple)", "#8d9b9a"];
const fallback: DayStatistics = { checkIns: null, closedTickets: null, hours: [], services: null, giftCardsSold: null, giftCardsRedeemed: null, promotions: null, errors: [] };

function HourlyLines({ data, dashboard }: { data: DayStatistics; dashboard: TodayDashboard }) {
  const t = useWorkspaceTranslation();
  const hasData = data.checkIns !== null || data.closedTickets !== null;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, [hasData]);
  const activeHours = data.hours.filter(h => (h.checkIns ?? 0) > 0 || (h.sales ?? 0) > 0).map(h => h.hour);
  const businessStart = dashboard.businessHours.buckets[0]?.hour;
  const start = Math.min(businessStart ?? activeHours[0] ?? data.hours.at(-1)?.hour ?? 0, ...activeHours);
  const hours = data.hours.filter(h => h.hour >= start);
  const peak = hours.reduce<typeof hours[number] | undefined>((best, row) => !best || (row.checkIns ?? -1) > (best.checkIns ?? -1) ? row : best, undefined);
  const selected = hours.find(h => h.hour === selectedHour) ?? peak;
  const h = 210, top = 30, bottom = 190, left = 30, right = width - 43;
  const countMax = Math.max(12, Math.ceil(Math.max(0, ...hours.map(r => r.checkIns ?? 0)) / 12) * 12);
  const salesPeak = Math.max(1, ...hours.map(r => r.sales ?? 0));
  const power = 10 ** Math.floor(Math.log10(salesPeak / 4));
  const step = [1,1.5,2,2.5,5,10].find(value => value * power >= salesPeak * 1.1 / 4)! * power;
  const salesMax = step * 4;
  const x = (i: number) => hours.length <= 1 ? (left + right) / 2 : left + i / (hours.length-1) * (right-left);
  const cy = (v: number) => bottom - v / countMax * (bottom-top);
  const sy = (v: number) => bottom - v / salesMax * (bottom-top);
  const selectedIndex = hours.findIndex(row => row === selected);
  const current = localHour(dashboard.generatedAt, dashboard.timezone);
  const ticks = hours.filter((_, i) => i === 0 || i === hours.length-1 || i % Math.max(1, Math.ceil(hours.length / (width < 310 ? 4 : 7))) === 0);
  return <section className={styles.section}>
    <div className={styles.sectionHeader}><h3 className={styles.sectionTitle}><WorkspaceText text="Check-ins & service sales" /></h3>{dashboard.dayView.isCurrentDate && current ? <span className={styles.subtle}>{hourLabel(current.hour)} · <WorkspaceText text="Hour in progress" /></span> : null}</div>
    <div className={styles.legend}><span><i className={styles.swatch} style={{ background: "var(--amber)" }} /><WorkspaceText text="Check-ins" /></span><span><i className={styles.swatch} style={{ background: "var(--teal)" }} /><WorkspaceText text="Service sales" /></span></div>
    {data.checkIns === null && data.closedTickets === null ? <p className={styles.empty}><WorkspaceText text="Statistics are unavailable. Check access or try again." /></p> : <>
    <div ref={ref} className={styles.chart}>
      <svg className={styles.plot} viewBox={`0 0 ${width} ${h}`} role="img" aria-label={t("Hourly check-ins and service sales. Select an hour below for values.")} onPointerDown={event => { const box = event.currentTarget.getBoundingClientRect(); const position = (event.clientX-box.left)/box.width*width; const index = Math.max(0, Math.min(hours.length-1, Math.round((position-left)/(right-left)*Math.max(1,hours.length-1)))); if (hours[index]) setSelectedHour(hours[index].hour); }}>
        <text x={left} y="13">{t("Check-ins")}</text><text x={right} y="13" textAnchor="end">{t("Sales ($)")}</text>
        {[0,1,2,3,4].map(i => { const y = bottom - i/4*(bottom-top); return <g key={i}><line className={styles.grid} x1={left} x2={right} y1={y} y2={y}/><text x={left-7} y={y+4} textAnchor="end">{Math.round(i/4*countMax)}</text><text x={right+7} y={y+4}>{Math.round(i/4*salesMax).toLocaleString("en-US", { notation: salesMax > 999 ? "compact" : "standard" })}</text></g>; })}
        {selectedIndex >= 0 ? <line className={styles.guide} x1={x(selectedIndex)} x2={x(selectedIndex)} y1={top} y2={bottom}/> : null}
        {data.checkIns !== null ? <path className={styles.line} stroke="var(--amber)" d={smoothLine(hours.map((row,i) => ({ x:x(i), y:cy(row.checkIns ?? 0) })))}/> : null}
        {data.closedTickets !== null ? <path className={styles.line} stroke="var(--teal)" d={smoothLine(hours.map((row,i) => ({ x:x(i), y:sy(row.sales ?? 0) })))}/> : null}
        {hours.map((row,i) => <g key={row.hour}>{row.checkIns !== null ? <circle className={styles.dot} cx={x(i)} cy={cy(row.checkIns)} r={row === selected ? 5 : 3} fill="var(--amber)"/> : null}{row.sales !== null ? <circle className={styles.dot} cx={x(i)} cy={sy(row.sales)} r={row === selected ? 5 : 3} fill="var(--teal)"/> : null}</g>)}
      </svg>
      <div className={styles.hourButtons} aria-label={t("Select hour")}>{ticks.map(row => <button key={row.hour} className={styles.hourButton} style={{left:x(hours.indexOf(row))}} type="button" aria-pressed={row === selected} aria-label={`${hourLabel(row.hour)}: ${row.checkIns ?? "—"} ${t("Check-ins")}, ${row.sales === null ? "—" : money(row.sales)}`} onClick={() => setSelectedHour(row.hour)}>{hourLabel(row.hour)}</button>)}</div>
      <label className={styles.srOnly}>{t("Select hour")}<input type="range" min={start} max={hours.at(-1)?.hour ?? start} value={selected?.hour ?? start} onChange={event => setSelectedHour(Number(event.target.value))}/></label>
    </div>
    <p className={styles.detail} aria-live="polite">{selected ? <>{hourLabel(selected.hour)}–{hourLabel((selected.hour+1)%24)} · {selected.checkIns ?? "—"} <WorkspaceText text="Check-ins" /> · {selected.sales === null ? "—" : money(selected.sales)}</> : <WorkspaceText text="No activity recorded." />}</p>
    </>}
    <p className={styles.note}><WorkspaceText text="Service sales before discounts · Excludes tips, tax & gift card sales" /><br/><WorkspaceText text="By check-in time and ticket close time · Hours shown in salon time" /></p>
    {data.checkIns === null ? <p className={styles.note}><WorkspaceText text="Check-ins unavailable" /></p> : null}{data.closedTickets === null ? <p className={styles.note}><WorkspaceText text="Service sales unavailable" /></p> : null}
  </section>;
}

function ServiceMix({ data }: { data: DayStatistics }) {
  const [unit, setUnit] = useState<"count" | "sales">("count");
  const services = data.services ?? [];
  const ranked = [...services].sort((a,b) => b[unit] - a[unit] || a.label.localeCompare(b.label));
  const rows = ranked.length > 6 ? [...ranked.slice(0,5), { label: "Other services", count: ranked.slice(5).reduce((s,r)=>s+r.count,0), sales: ranked.slice(5).reduce((s,r)=>s+r.sales,0) }] : ranked;
  const total = rows.reduce((s,r)=>s+r[unit],0);
  const colorFor = (label: string) => { const key = label.toLowerCase(); const index = key.includes("ped") ? 0 : key.includes("gel") ? 1 : key.includes("mani") ? 2 : key.includes("dip") ? 3 : key.includes("add") ? 4 : [...key].reduce((sum,c)=>sum+c.charCodeAt(0),0)%colors.length; return colors[index]; };
  return <section className={styles.section}><div className={styles.sectionHeader}><h3 className={styles.sectionTitle}><WorkspaceText text="Service mix" /></h3><div className={styles.tabs} aria-label="Service mix unit">{(["count","sales"] as const).map(value=><button key={value} type="button" aria-pressed={unit===value} onClick={()=>setUnit(value)}><WorkspaceText text={value === "count" ? "Count" : "Sales"}/></button>)}</div></div>
    <p className={styles.subtle}>{unit === "count" ? `${total} ` : money(total)+" "}<WorkspaceText text={unit === "count" ? "service items · Closed tickets" : "before discounts · Closed tickets"}/></p>
    {data.services === null ? <p className={styles.empty}><WorkspaceText text="Service mix unavailable" /></p> : total <= 0 ? <p className={styles.empty}><WorkspaceText text="No completed services for this date." /></p> : <div className={styles.mix}>
      <svg className={styles.pie} viewBox="0 0 180 180" role="img" aria-label="Service mix"><title>{rows.map(r=>`${r.label}: ${r[unit]}`).join(", ")}</title>{rows.map((row,index)=>{
        const fraction = row[unit]/total, start = -Math.PI/2 + rows.slice(0,index).reduce((sum,r)=>sum+r[unit]/total,0)*Math.PI*2, angle = start + fraction*Math.PI*2;
        const color = colorFor(row.label);
        const point = (a: number) => `${90+88*Math.cos(a)},${90+88*Math.sin(a)}`;
        const middle = (start+angle)/2;
        return <g key={row.label}>{fraction>=.99999 ? <circle cx="90" cy="90" r="88" fill={color}/> : fraction>0 ? <path d={`M90,90 L${point(start)} A88,88 0 ${fraction>.5?1:0},1 ${point(angle)} Z`} fill={color} stroke="var(--pie-divider, #fff)" strokeWidth="1"/> : null}{fraction>=.09 ? <text x={90+55*Math.cos(middle)} y={94+55*Math.sin(middle)} textAnchor="middle">{Math.round(fraction*100)}%</text> : null}</g>;
      })}</svg>
      <ul className={styles.mixList} aria-live="polite">{rows.map(row=><li key={row.label}><i className={styles.swatch} style={{background:colorFor(row.label)}}/><span>{row.label}</span><span className={styles.mixValue}>{unit === "count" ? row.count : money(row.sales)}<span className={styles.mixPercent}>{Math.round(row[unit]/total*100)}%</span></span></li>)}</ul>
    </div>}
  </section>;
}

export function TodayStatistics({ dashboard }: { dashboard: TodayDashboard }) {
  const data = dashboard.performance.statistics ?? fallback;
  const turns = dashboard.pendingSections?.sections?.includes("staff") || dashboard.loadErrors.some(e=>e.area === "staff") ? null : dashboard.team.reduce((sum, member)=>sum+member.turns.total,0);
  const bookings = dashboard.performance.bookingStatus;
  const bookingsAvailable = !dashboard.pendingSections?.sections?.includes("bookings") && dashboard.permissions.canViewBookings && !dashboard.loadErrors.some(e=>e.area === "bookings");
  const totalBookings = bookingsAvailable ? bookings.total ?? null : null;
  const reportsHref = `/reports?${new URLSearchParams({date:dashboard.date})}`;
  const ticketsHref = `/pos-tickets?${new URLSearchParams({date:dashboard.date})}`;
  const metric = (label: string, value: number | null) => <div className={styles.metric} key={label}><span className={styles.metricValue}>{value ?? "—"}</span><span className={styles.metricLabel}><WorkspaceText text={label}/></span></div>;
  return <section className={styles.panel} aria-label="Day statistics" data-today-statistics>
    <header className={styles.header}><div><h2 className={styles.title}><WorkspaceText text={dashboard.dayView.isCurrentDate ? "Today Statistics" : "Day Statistics"}/></h2><p className={styles.subtle}><WorkspaceText text="Updated"/> {new Intl.DateTimeFormat("en-US",{timeZone:dashboard.timezone,hour:"numeric",minute:"2-digit"}).format(new Date(dashboard.generatedAt))}</p></div>{dashboard.permissions.canViewReports ? <Link href={reportsHref} className={styles.report}><WorkspaceText text="Reports"/> <span aria-hidden="true">→</span></Link> : null}</header>
    <div className={styles.totals}>{metric("Check-ins",data.checkIns)}{metric("Turns recorded",turns)}{metric("Closed tickets",data.closedTickets)}{metric("Bookings",totalBookings)}</div>
    {data.errors.length ? <div role="status" className={styles.error}>{data.errors.map(error=><p key={error}><WorkspaceText text={error}/></p>)}</div> : null}
    <HourlyLines data={data} dashboard={dashboard}/>
    <ServiceMix data={data}/>
    <section className={styles.section}><h3 className={styles.sectionTitle}><WorkspaceText text="Gift cards & promotions"/></h3><div className={styles.ledger}>
      <div className={styles.ledgerRow}><span><WorkspaceText text="Gift cards sold"/></span><span className={styles.ledgerValue}>{data.giftCardsSold ? `${data.giftCardsSold.count} · ${money(data.giftCardsSold.amount)}` : <WorkspaceText text="Not available"/>}</span></div>
      {([['Gift cards redeemed', data.giftCardsRedeemed],['Discounts applied',data.promotions]] as const).map(([label,value])=>{const content=<><span><WorkspaceText text={label}/></span><span className={styles.ledgerValue}>{value ? `${value.count} · ${label === 'Discounts applied' && value.amount > 0 ? '−' : ''}${money(value.amount)}` : '—'}{dashboard.permissions.canViewTickets ? ' ›' : ''}</span></>;return dashboard.permissions.canViewTickets ? <Link key={label} href={ticketsHref} className={styles.ledgerRow}>{content}</Link> : <div key={label} className={styles.ledgerRow}>{content}</div>;})}
    </div><p className={styles.note}><WorkspaceText text={data.giftCardsSold ? "Redemptions are ticket payments, not additional revenue. Gift cards follow the daily report business date." : "Redemptions are ticket payments, not additional revenue. Gift card sales data is unavailable."}/></p></section>
    {dashboard.permissions.canViewBookings ? <section className={styles.section}><h3 className={styles.sectionTitle}><WorkspaceText text={dashboard.dayView.isCurrentDate ? "Today's bookings" : "Day bookings"}/></h3><div className={styles.bookings}>{metric("Completed",bookingsAvailable?bookings.completed:null)}{metric("In service",bookingsAvailable?bookings.inService??null:null)}{metric("Upcoming",bookingsAvailable?bookings.statisticsUpcoming??bookings.upcoming:null)}{metric("Cancelled / No-show",bookingsAvailable?bookings.cancelled??null:null)}</div>{bookingsAvailable && (bookings.other??0)>0 ? <p className={styles.note}>{bookings.other} <WorkspaceText text="other bookings · Arrived or earlier appointments"/></p> : null}</section> : null}
  </section>;
}
