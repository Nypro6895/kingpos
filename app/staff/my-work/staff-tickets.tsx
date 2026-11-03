"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkspaceText } from "@/components/workspace-language";
import { CustomerName } from "@/components/customer-name";
import { shiftStaffDate } from "@/lib/staff-payroll-period";
import { staffTicketChanges, validStaffTicketDate, type StaffTicketsData } from "@/lib/staff-tickets";
import styles from "./staff-tickets.module.css";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
function stamp(value: string, timezone: string, full = false) {
  return new Intl.DateTimeFormat("en-US", { ...(full ? { month: "short", day: "numeric", year: "numeric" } as const : {}), hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}
function value(key: string, input: unknown) {
  if (input === null || input === undefined) return "—";
  if (["assigned_staff_id", "customer_id"].includes(key)) return "Changed";
  if (["unit_price", "line_total", "service_total", "tip_amount", "total_earning"].includes(key)) return money(Number(input));
  return typeof input === "boolean" ? input ? "Yes" : "No" : String(input);
}
export function StaffTickets({ data, timezone, payPeriodStart }: { data: StaffTicketsData; timezone: string; payPeriodStart?: string }) {
  const router = useRouter();
  const href = (date: string) => {
    const query = new URLSearchParams({ tab: "tickets", ticketDate: date });
    if (payPeriodStart) query.set("payPeriodStart", payPeriodStart);
    return `/staff/my-work?${query}`;
  };
  const previous = shiftStaffDate(data.date, -1), next = shiftStaffDate(data.date, 1);
  const completed = data.tickets.filter(ticket => ticket.status === "closed" && ticket.tip !== null);
  return <section className={styles.portal} aria-label="My tickets">
    <div className={styles.datePicker}>
      {validStaffTicketDate(previous) ? <Link href={href(previous)} aria-label="Previous day">‹</Link> : <span />}
      <label><span><WorkspaceText text="Ticket date" /></span><input aria-label="Ticket date" type="date" min="0001-01-01" max="9999-12-31" value={data.date} onChange={event => { if (validStaffTicketDate(event.target.value)) router.push(href(event.target.value)); }} /></label>
      {validStaffTicketDate(next) ? <Link href={href(next)} aria-label="Next day">›</Link> : <span />}
    </div>
    <p className={styles.note}><WorkspaceText text="Choose any date · Salon local time" /></p>
    <div className={styles.totals}><span><WorkspaceText text="Services" /> <strong>{money(completed.reduce((sum, ticket) => sum + ticket.serviceTotal, 0))}</strong></span><span><WorkspaceText text="Tip" /> <strong>{money(completed.reduce((sum, ticket) => sum + (ticket.tip ?? 0), 0))}</strong></span></div>
    <p className={styles.note}>{data.tickets.length} <WorkspaceText text={data.tickets.length === 1 ? "ticket · Totals include completed tickets with earnings only" : "tickets · Totals include completed tickets with earnings only"} /></p>
    {!data.tickets.length && <p className={styles.empty}><WorkspaceText text="No tickets assigned to you on this date." /></p>}
    {data.tickets.map(ticket => <details key={ticket.id} className={styles.ticket}>
      <summary><div className={styles.heading}><strong>{ticket.ticketNumber} · {stamp(ticket.openedAt, timezone)}</strong>{(ticket.history.length > 0 || ticket.activity.some(event => /updated|removed|deleted|voided|cancelled|adjust/.test(event.action))) && <span className={styles.badge}><WorkspaceText text="Edited" /></span>}</div>
        <div><CustomerName name={ticket.customerName} fallback="Walk-in" /></div>
        <p className={styles.preview}>{ticket.services.filter(service => !service.removed).map(service => service.name).join(", ") || <WorkspaceText text="No current assigned services" />}</p>
        <div className={styles.preview}><WorkspaceText text={ticket.status} /> · <WorkspaceText text="Services" /> {money(ticket.serviceTotal)} · <WorkspaceText text="Tip" /> {ticket.tip === null ? <WorkspaceText text="Pending" /> : money(ticket.tip)}</div>
      </summary>
      <div className={styles.detail}>
        <table className={styles.services}><thead><tr><th><WorkspaceText text="Services" /></th><th><WorkspaceText text="Price" /></th></tr></thead><tbody>{ticket.services.map(service => <tr key={service.id} className={service.removed ? styles.removed : undefined}><td>{service.name} ×{service.quantity}{service.removed && <small><WorkspaceText text="Removed" /></small>}<small>{money(service.unitPrice)} <WorkspaceText text="each" /></small></td><td>{money(service.price)}</td></tr>)}</tbody></table>
        <dl className={styles.facts}><div><dt><WorkspaceText text="Services" /></dt><dd>{money(ticket.serviceTotal)}</dd></div><div><dt><WorkspaceText text="Tip" /></dt><dd>{ticket.tip === null ? <WorkspaceText text="Pending" /> : money(ticket.tip)}</dd></div><div><dt><WorkspaceText text="Total" /></dt><dd>{ticket.tip === null ? "—" : money(ticket.serviceTotal + ticket.tip)}</dd></div></dl>
        <p className={styles.note}><WorkspaceText text="Your assigned services and allocated tip only." />{ticket.closedAt && <> <WorkspaceText text="Closed" /> {stamp(ticket.closedAt, timezone, true)}</>}</p>
        <details className={styles.history}><summary><WorkspaceText text="Edit history" /> · {ticket.history.length}</summary>
          {!ticket.history.length && <p className={styles.note}><WorkspaceText text="No detailed edits recorded. Older changes may appear in ticket activity below." /></p>}
          {ticket.history.map(event => <article key={event.id}><strong>{event.actor}</strong><small>{stamp(event.at, timezone, true)}</small><ul>{staffTicketChanges(event).map(change => <li key={change.key}><WorkspaceText text={change.label} />: {["assigned_staff_id", "customer_id"].includes(change.key) ? <WorkspaceText text="Changed" /> : <>{value(change.key, change.before)} → {value(change.key, change.after)}</>}</li>)}</ul></article>)}
        </details>
        <details className={styles.history}><summary><WorkspaceText text="Ticket activity" /> · {ticket.activity.length}</summary>
          {!ticket.activity.length && <p className={styles.note}><WorkspaceText text="No ticket activity recorded." /></p>}
          {ticket.activity.map(event => <article key={event.id}><strong>{event.actor}</strong><small>{stamp(event.at, timezone, true)}</small><p><WorkspaceText text={event.action.replaceAll("_", " ")} /></p></article>)}
        </details>
      </div>
    </details>)}
  </section>;
}
