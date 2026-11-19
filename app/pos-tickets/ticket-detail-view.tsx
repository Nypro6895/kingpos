import type { ReactNode } from "react";
import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";
import { POS_PAYMENT_METHOD_LABELS } from "@/lib/pos-payments";
import { ticketBusinessDate } from "@/lib/pos-ticket-navigation";
import type { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { PosTicketReceipt } from "@/types/pos-ticket-receipt";
import type { PosTicketTimelineItem } from "@/types/pos-ticket-timeline";
import styles from "./ticket-detail-view.module.css";

export type TicketDetailViewProps = {
  actions?: ReactNode;
  backHref: string;
  backLabel?: string;
  editHref?: string;
  editLabel?: string;
  error?: string;
  financialEditor?: ReactNode;
  giftItems?: ReactNode[];
  itemEditors?: Record<string, ReactNode>;
  paymentEditor?: ReactNode;
  paymentEditors?: Record<string, ReactNode>;
  paymentStatus: string;
  paymentSummary?: ReactNode;
  receipt: PosTicketReceipt;
  receiptActions?: ReactNode;
  recordedHistory?: ReactNode;
  salonName: string;
  serviceActions?: ReactNode;
  serviceEditor?: ReactNode;
  support?: ReactNode;
  ticket: PosTicketWithRelations;
  ticketStatusLabel?: string;
  timeline: PosTicketTimelineItem[];
  timeZone?: string;
  totalLabel?: string;
  totals: ReturnType<typeof calculateTicketTotals>;
};

const STATUS_LABELS = { open: "Open", closed: "Closed", cancelled: "Cancelled", voided: "Voided" };

function Icon({ kind, className = "" }: { kind: "back" | "chevron" | "edit" | "wallet" | "arrow"; className?: string }) {
  const paths = { back: "m15 18-6-6 6-6", chevron: "m6 9 6 6 6-6", edit: "m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5", wallet: "M20 8V5H4a2 2 0 0 0 0 4h16v11H4a2 2 0 0 1-2-2V7m18 5h-5v4h5", arrow: "M7 17 17 7M7 7h10v10" };
  return <svg aria-hidden="true" className={`${styles.icon} ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d={paths[kind]} /></svg>;
}

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
function quantity(value: number) { return Number.isInteger(value) ? String(value) : value.toFixed(2); }
function dateTime(value: string | null, timeZone?: string) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value)) : "-";
}
function SummaryEnd({ children }: { children?: ReactNode }) { return <span className={styles.summaryEnd}>{children}<Icon kind="chevron" className={styles.chevron} /></span>; }
function Fact({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return <div className={strong ? styles.factTotal : undefined}><dt><WorkspaceText text={label} /></dt><dd>{children}</dd></div>;
}

/** The detail layout is also rendered by local QA fixtures with canonical data. */
export function TicketDetailView({ actions, backHref, backLabel = "POS tickets", editHref, editLabel = "Edit", error, financialEditor, giftItems = [], itemEditors, paymentEditor, paymentEditors, paymentStatus, paymentSummary, receipt, receiptActions, recordedHistory, salonName, serviceActions, serviceEditor, support, ticket, ticketStatusLabel, timeline, timeZone, totalLabel = "Total", totals }: TicketDetailViewProps) {
  const items = ticket.ticket_items ?? [];
  const payments = ticket.payments ?? [];
  const duration = items.reduce((sum, item) => sum + (item.service?.duration_minutes ?? 0) * item.quantity, 0);
  const customerName = ticket.customer?.name ?? "Unknown customer";
  const bookingHref = ticket.source_booking ? `/bookings?date=${ticketBusinessDate(ticket.source_booking.start_at, timeZone ?? "America/Chicago")}&bookingId=${ticket.source_booking.id}` : `/bookings?bookingId=${ticket.source_booking_id}`;

  return <main className={styles.page} data-ticket-detail>
    <div className={styles.toolbar}>
      <Link className={styles.back} href={backHref}><Icon kind="back" /><WorkspaceText text={backLabel} /></Link>
      <div className={styles.toolbarEnd}>{editHref ? <Link className={styles.edit} href={editHref}>{editLabel === "Edit" ? <Icon kind="edit" /> : null}<WorkspaceText text={editLabel} /></Link> : null}{support}</div>
    </div>
    {error ? <p className={styles.error} role="alert"><WorkspaceText text={error} /></p> : null}
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}><WorkspaceText text="Ticket" /></p><h1 className={styles.number}>{ticket.ticket_number}</h1><div className={styles.badges}><span className={styles.badge}>{ticketStatusLabel ?? STATUS_LABELS[ticket.status]}</span><span className={`${styles.badge} ${paymentStatus === "Paid" ? styles.paid : ""}`}><WorkspaceText text={paymentStatus} /></span></div></div>
      <div className={styles.money}><div className={styles.eyebrow}><WorkspaceText text={totalLabel} /></div><div className={styles.total}>{money(totals.total)}</div><div className={styles.balance}><WorkspaceText text="Remaining" /> {money(totals.remaining)}</div></div>
    </header>
    <section className={styles.customer} aria-label="Customer">
      <div className={styles.avatar} aria-hidden="true">{customerName.slice(0, 1).toUpperCase()}</div>
      <div><div className={styles.customerName}>{customerName}</div>{ticket.customer?.phone ? <div className={styles.small}>{ticket.customer.phone}</div> : null}</div>
      {ticket.customer?.email ? <details className={`${styles.customerContact} ${styles.contactDetails}`}><summary><WorkspaceText text="Contact" /></summary><p>{ticket.customer.email}</p></details> : null}
    </section>

    <section aria-labelledby="ticket-services-heading">
      <h2 className={styles.sectionHeading} id="ticket-services-heading"><WorkspaceText text="Services" /><span className={styles.count}>{items.length} <WorkspaceText text="services" />{duration > 0 ? <> · {duration} <WorkspaceText text="min" /></> : null}</span></h2>
      {serviceEditor ? <div className={styles.editor}>{serviceEditor}</div> : items.length || giftItems.length ? <ul className={styles.services}>{items.map(item => <li className={styles.service} key={item.id}>
        <div className={styles.row}><span className={styles.serviceName}>{item.service_name_snapshot ?? item.service?.name ?? "Unknown service"}</span><span className={styles.amount}>{money(item.line_total)}</span></div>
        <div className={styles.meta}><span>{item.assigned_staff?.display_name ?? "-"}</span>{item.service?.duration_minutes ? <><span>·</span><span>{item.service.duration_minutes} <WorkspaceText text="min" /></span></> : null}{item.quantity !== 1 ? <><span>·</span><span><WorkspaceText text="Qty" /> {quantity(item.quantity)} × {money(item.unit_price)}</span></> : null}{item.performed_staff && item.performed_staff.id !== item.assigned_staff?.id ? <><span>·</span><span><WorkspaceText text="Performed by" /> {item.performed_staff.display_name}</span></> : null}</div>
        {itemEditors?.[item.id] ? <div className={styles.itemEditor}>{itemEditors[item.id]}</div> : null}
      </li>)}{giftItems}</ul> : <p className={styles.empty}><WorkspaceText text="No services added yet." /></p>}
      {serviceActions ? <div className={styles.editor}>{serviceActions}</div> : null}
    </section>

    <section className={styles.payment} aria-labelledby="ticket-payments-heading">
      <h2 className={styles.sectionHeading} id="ticket-payments-heading"><WorkspaceText text="Payments" /><span className={styles.count}>{payments.length} <WorkspaceText text="recorded" /></span></h2>
      {paymentSummary ?? (payments.length ? <ul className={styles.payments}>{payments.map(payment => <li className={styles.paymentRow} key={payment.id}>
        <div className={styles.paymentInfo}><Icon kind="wallet" className={styles.paymentIcon} /><div><p><WorkspaceText text={POS_PAYMENT_METHOD_LABELS[payment.payment_method]} /></p><p className={styles.small}><WorkspaceText text={dateTime(payment.created_at, timeZone)} /></p></div></div>
        <div className={styles.paymentEnd}><span className={styles.amount}>{money(payment.amount)}</span>{paymentEditors?.[payment.id]}</div>
      </li>)}</ul> : <p className={styles.empty}><WorkspaceText text="No payments recorded yet." /></p>)}
      {paymentEditor ? <div className={styles.editor}>{paymentEditor}</div> : null}
    </section>

    <div className={styles.disclosures}>
      <details className={styles.disclosure} open={financialEditor ? true : undefined}><summary><WorkspaceText text="Price breakdown" /><SummaryEnd /></summary><div className={styles.disclosureBody}>
        <dl className={styles.facts}><Fact label="Subtotal">{money(totals.subtotal)}</Fact><Fact label="Discount">{money(totals.discount_amount)}{ticket.discount_type === "percentage" ? ` (${ticket.discount_value}%)` : ""}</Fact><Fact label="Tax">{money(totals.tax_amount)} · {ticket.tax_rate}%</Fact><Fact label="Tip">{money(totals.tip_amount)}{ticket.tip_type === "percentage" ? ` (${ticket.tip_value}%)` : ""}</Fact><Fact label="Total" strong>{money(totals.total)}</Fact><Fact label="Paid">{money(totals.paid)}</Fact><Fact label="Remaining">{money(totals.remaining)}</Fact></dl>
        {financialEditor ? <div className={styles.editor}>{financialEditor}</div> : null}
      </div></details>
      {ticket.source_booking_id ? <details className={styles.disclosure}><summary><WorkspaceText text="From appointment" /><SummaryEnd>{ticket.source_booking ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(ticket.source_booking.start_at)) : null}</SummaryEnd></summary><div className={styles.disclosureBody}><p className={styles.small}><WorkspaceText text={ticket.source_booking ? dateTime(ticket.source_booking.start_at, timeZone) : "Linked appointment"} /></p><Link className={styles.bookingLink} href={bookingHref}><WorkspaceText text="View appointment" /><Icon kind="arrow" /></Link></div></details> : null}
      <details className={styles.disclosure} data-ticket-receipt><summary><WorkspaceText text="View receipt" /><SummaryEnd><WorkspaceText text={receipt.header.receipt_status} /></SummaryEnd></summary><div className={styles.disclosureBody}>{receiptActions}<TicketReceipt receipt={receipt} ticket={ticket} ticketStatusLabel={ticketStatusLabel} timeZone={timeZone} /></div></details>
      <details className={styles.disclosure}><summary><WorkspaceText text="Ticket details" /><SummaryEnd /></summary><div className={styles.disclosureBody}>
        {recordedHistory}
        <dl className={styles.facts}><Fact label="Created Time"><WorkspaceText text={dateTime(ticket.created_at, timeZone)} /></Fact><Fact label="Closed Time"><WorkspaceText text={dateTime(ticket.closed_at, timeZone)} /></Fact><Fact label="Assigned Salon">{salonName}</Fact>{ticket.source_booking_id ? <Fact label="Booking reference:">{ticket.source_booking_id}</Fact> : null}{ticket.notes ? <Fact label="Note">{ticket.notes}</Fact> : null}</dl>
        {items.some(item => item.source_kind === "booking" || item.booked_unit_price_snapshot !== null) ? <details className={styles.disclosure}><summary><WorkspaceText text="Booked service details" /><SummaryEnd /></summary><dl className={styles.facts}>{items.filter(item => item.source_kind === "booking" || item.booked_unit_price_snapshot !== null).map(item => <div key={item.id}><dt>{item.service_name_snapshot ?? item.service?.name ?? "Unknown service"}{item.source_booking_line_id ? <p className={styles.small}>{item.source_booking_line_id}</p> : null}</dt><dd>{item.booked_unit_price_snapshot !== null ? money(item.booked_unit_price_snapshot) : "-"}</dd></div>)}</dl></details> : null}
        {payments.some(payment => payment.note) ? <ul className={styles.history}>{payments.filter(payment => payment.note).map(payment => <li key={payment.id}><p className={styles.historyTitle}><WorkspaceText text={POS_PAYMENT_METHOD_LABELS[payment.payment_method]} /> · {money(payment.amount)}</p><p className={styles.historyNote}>{payment.note}</p></li>)}</ul> : null}
        <h3 className={`${styles.historyTitle} mt-4`}><WorkspaceText text="Activity Timeline" /></h3>{timeline.length ? <ol className={styles.history}>{timeline.map(item => <li key={item.id}><div className={styles.row}><p className={styles.historyTitle}><WorkspaceText text={item.label} /></p><p className={styles.small}><WorkspaceText text={dateTime(item.timestamp, timeZone)} /></p></div><p className={styles.small}><WorkspaceText text="User:" /> {item.user}</p>{item.note ? <p className={styles.historyNote}>{item.note}</p> : null}</li>)}</ol> : <p className={styles.empty}><WorkspaceText text="No activity yet." /></p>}
      </div></details>
    </div>
    {actions ? <details className={`${styles.disclosure} ${styles.actions}`}><summary><WorkspaceText text="Actions" /><SummaryEnd /></summary><div className={styles.disclosureBody}>{actions}</div></details> : null}
  </main>;
}

function TicketReceipt({ receipt, ticket, ticketStatusLabel, timeZone }: { receipt: PosTicketReceipt; ticket: PosTicketWithRelations; ticketStatusLabel?: string; timeZone?: string }) {
  return <div className={styles.receipt}>
    <div className={styles.receiptHeader}><h3 className={styles.receiptName}>{receipt.header.salon_name}</h3>{receipt.header.salon_phone ? <p className={styles.small}>{receipt.header.salon_phone}</p> : null}<p className={styles.small}>{receipt.header.ticket_number} · {ticketStatusLabel ?? receipt.header.ticket_status}</p><p className={styles.small}>{receipt.header.customer_name}</p><p className={styles.small}><WorkspaceText text="Created:" /> <WorkspaceText text={dateTime(receipt.header.created_time, timeZone)} /></p>{receipt.header.closed_time ? <p className={styles.small}><WorkspaceText text="Closed:" /> <WorkspaceText text={dateTime(receipt.header.closed_time, timeZone)} /></p> : null}</div>
    <ul className={styles.receiptItems}>{receipt.items.map((item, index) => <li key={`${item.service_name}-${index}`}><div className={styles.row}><span>{ticket.ticket_items[index]?.service_name_snapshot ?? item.service_name}</span><span className={styles.amount}>{money(item.line_total)}</span></div><div className={styles.small}>{item.assigned_staff} · <WorkspaceText text="Qty" /> {quantity(item.quantity)} × {money(item.unit_price)}</div></li>)}</ul>
    <dl className={styles.facts}><Fact label="Subtotal">{money(receipt.totals.subtotal)}</Fact><Fact label="Discount">{money(receipt.totals.discount)}</Fact>{(receipt.totals.reward ?? 0) > 0 ? <Fact label="Reward">{money(receipt.totals.reward ?? 0)}</Fact> : null}<Fact label="Tax">{money(receipt.totals.tax)}</Fact><Fact label="Tip">{money(receipt.totals.tip)}</Fact><Fact label="Grand Total" strong>{money(receipt.totals.grand_total)}</Fact><Fact label="Paid">{money(receipt.totals.paid)}</Fact><Fact label="Remaining">{money(receipt.totals.remaining)}</Fact></dl>
    {receipt.payments.length ? <ul className={styles.history}>{receipt.payments.map((payment, index) => <li key={`${payment.method}-${index}`}><div className={styles.row}><WorkspaceText text={payment.method} /><span className={styles.amount}>{money(payment.amount)}</span></div><p className={styles.small}><WorkspaceText text={dateTime(payment.created_time, timeZone)} /></p></li>)}</ul> : null}
    <p className={styles.receiptThanks}><WorkspaceText text={receipt.footer.message} /></p>
  </div>;
}
