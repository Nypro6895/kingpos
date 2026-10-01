import type { StaffAssignedWorkTicket } from "@/lib/staff-workdays";
import { CustomerName } from "@/components/customer-name";
import styles from "./staff-daily-overview.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
function time(value: string | null, timezone: string) {
  return value ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value)) : "—";
}

export function StaffDailyMetrics({ activity, completedTickets }: {
  activity: { totalEarning: number; assignedServiceAmount: number; tipAmount: number; bigTurns: number; smallTurns: number };
  completedTickets: number;
}) {
  return <section className={styles.metrics} aria-label="Today's personal results">
    <div className={`${styles.metric} ${styles.featured}`}>
      <details className={styles.help}>
        <summary className={styles.label}>Ticket earnings <span aria-hidden="true">i</span></summary>
        <p className={styles.popover}>Your completed services, allocated tips and ticket earning adjustments. This is not your take-home pay. Open tickets and tickets without earnings are excluded.</p>
      </details>
      <p className={styles.value}>{money(activity.totalEarning)}</p>
      <p className={styles.hint}>{completedTickets} completed {completedTickets === 1 ? "ticket" : "tickets"}</p>
    </div>
    <div className={styles.metric}><p className={styles.label}>Services</p><p className={styles.value}>{money(activity.assignedServiceAmount)}</p><p className={`${styles.hint} ${styles.optional}`}>Your assigned services</p></div>
    <div className={styles.metric}><p className={styles.label}>Tips</p><p className={styles.value}>{money(activity.tipAmount)}</p><p className={`${styles.hint} ${styles.optional}`}>Your allocated tips</p></div>
    <div className={styles.metric}><p className={styles.label}>Turns</p><p className={styles.value}>{number(activity.bigTurns + activity.smallTurns)}</p><p className={styles.hint}>{number(activity.bigTurns)} big · {number(activity.smallTurns)} small</p></div>
  </section>;
}

export function StaffDailyTickets({ tickets, timezone }: { tickets: StaffAssignedWorkTicket[]; timezone: string }) {
  const ordered = [...tickets].sort((a, b) => (b.openedAt ?? b.firstActivityAt ?? "").localeCompare(a.openedAt ?? a.firstActivityAt ?? ""));
  return <>
    <section className={styles.list} aria-label="Your tickets today">
      <div className={styles.columns} aria-hidden="true"><span>Ticket / time</span><span>Service / customer</span><span>Status</span><span className={styles.amount}>Tip</span><span className={styles.amount}>Earnings</span><span /></div>
      {ordered.map(ticket => <details className={styles.ticket} key={ticket.id}>
        <summary className={styles.row}>
          <span className={styles.code}><strong>{ticket.ticketNumber || "Ticket"}</strong><small>{time(ticket.openedAt ?? ticket.firstActivityAt, timezone)}</small></span>
          <span className={styles.service}><strong>{ticket.services.length ? ticket.services.map(s => `${s.serviceName}${s.quantity !== 1 ? ` ×${number(s.quantity)}` : ""}`).join(", ") : "No assigned services"}</strong><small><CustomerName name={ticket.customerName} fallback="Walk-in" /> · {money(ticket.serviceTotal)} service{ticket.hasEarning ? ` · ${number(ticket.totalTurns)} ${ticket.totalTurns === 1 ? "turn" : "turns"}` : ""}</small>{!ticket.hasEarning && <span className={styles.pending}>Earnings pending</span>}</span>
          <span className={`${styles.state} ${ticket.status === "closed" ? styles.closed : styles.open}`}>{ticket.status === "closed" ? "Closed" : "Open"}</span>
          <span className={`${styles.tip} ${styles.amount}`}>{ticket.hasEarning ? money(ticket.tipAmount) : "—"}</span>
          <strong className={`${styles.total} ${styles.amount}`}>{ticket.hasEarning ? money(ticket.totalEarning) : "—"}</strong>
          <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className={styles.detail}>
          <div className={styles.facts}><span>Services <strong>{money(ticket.serviceTotal)}</strong></span><span>Tip <strong>{ticket.hasEarning ? money(ticket.tipAmount) : "Pending"}</strong></span><span>Turns <strong>{ticket.hasEarning ? `${number(ticket.bigTurns)} big · ${number(ticket.smallTurns)} small` : "Pending"}</strong></span>{ticket.customerPhone && <span>Customer phone <strong>{ticket.customerPhone}</strong></span>}</div>
          <ul className={styles.services}>{ticket.services.map(service => <li className={styles.line} key={service.id}><span>{service.serviceName} ×{number(service.quantity)} <small>· {time(service.createdAt, timezone)}</small></span><strong>{money(service.lineTotal)}</strong></li>)}</ul>
          {!ticket.hasEarning && <p className={styles.pending}>Earnings are pending. These services are shown for reference and excluded from the totals above.</p>}
        </div>
      </details>)}
    </section>
    <p className={styles.footnote}>Only your assigned work · Salon local time</p>
  </>;
}
