import Link from "next/link";
import { WorkspaceText as T } from "@/components/workspace-language";
import type { OwnerAttentionData, OwnerAttentionItem } from "@/types/owner-financial-attention";
import { asObject, asRows, attentionChangeDetails, attentionMoney as money, attentionTicketAmounts } from "@/lib/owner-attention-presentation";
import { AttentionActions } from "./owner-attention-panel";
import s from "./owner-attention.module.css";

function TicketFacts({ value }: { value: unknown }) {
  const facts = asObject(value), totals = attentionTicketAmounts(facts);
  return <><dl className={s.amounts}>{([['Services',totals.service],['Discount',totals.discount],['Tips',totals.tip],['Total',totals.total],['Recorded paid',totals.paid],['Remaining',totals.remaining]] as const).map(([label,value])=><div key={label}><dt><T text={label}/></dt><dd>{money(value)}</dd></div>)}</dl>
    <p className={s.meta}><T text="Ticket status" />: {String(facts.status ?? "Unknown")}</p>
    {asRows(facts.lines).map((line, index) => <p className={s.detail} key={index}>{String(line.service_name ?? "Service")} · {String(line.staff_name ?? "Staff")} · {money(line.service_total)}</p>)}
  </>;
}

export function AttentionDetail({ data, item, onSaved }: { data: OwnerAttentionData; item: OwnerAttentionItem; onSaved?: () => void }) {
  const facts = item.facts ?? {}, changes = attentionChangeDetails(item);
  const ticketRows = asRows(facts.tickets);
  const collection = asObject(facts.collection), report = asObject(facts.report);
  return <article className={s.panel}>
    <h1>{item.label}</h1><p className={s.meta}>{item.business_date} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.timezone }).format(new Date(item.occurred_at))}</p>
    <p className={s.detail}>{item.detail}</p>
    {(item.kind === "ticket_change" || item.kind === "discount") && <>
      <p className={s.meta}><T text="Recorded by" />: {String(facts.actor || "Unknown operator")}</p>
      {!!facts.note && <p className={s.notice}>{String(facts.note)}</p>}
      <div style={{ overflowX: "auto" }}><table className={s.facts}><thead><tr><th><T text="Changed field" /></th><th><T text="Before" /></th><th><T text="After" /></th></tr></thead><tbody>
        {changes.map((change, index) => <tr key={index}><th>{change.label}</th><td>{change.comparison === "recorded" ? "—" : change.before}</td><td>{change.after}</td></tr>)}
      </tbody></table></div>
      {!changes.length && <p className={s.notice}><T text="The earlier values were not fully recorded. Review the saved receipt below." /></p>}
      <div style={{ overflowX: "auto" }}><TicketFacts value={facts.after} /></div>
    </>}
    {item.kind === "closing" && <>
      <p className={s.notice}><T text="Review the receipts and entered collections below. Confirming records your review of these figures; it does not add payments or change payroll. New financial changes will require a new review." /></p>
      <div style={{ overflowX: "auto" }}><table className={s.facts}><thead><tr><th><T text="Entered collections" /></th><th><T text="Cash" /></th><th><T text="Card" /></th><th><T text="Other" /></th></tr></thead><tbody>
        {!!Object.keys(collection).length && <tr><th><T text="Shop Money" /></th><td>{money(collection.cash)}</td><td>{money(collection.card)}</td><td>{money(collection.other)}</td></tr>}
        {!!Object.keys(report).length && <tr><th><T text={report.entered ? "Daily Report · entered" : "Daily Report · not entered"} /></th><td>{money(report.cash)}</td><td>{money(report.card)}</td><td>{money(report.other)}</td></tr>}
      </tbody></table></div>
      {!Object.keys(collection).length && !report.entered && <p className={s.notice}><T text="No confirmed collection entry for this day. Enter and verify actual collections in Reports before confirming your review." /></p>}
      <p className={s.meta}><T text="These are separate input sources. Do not add them together." /></p>
      {ticketRows.map(row => <section className={s.item} key={String(row.id)}><div className={s.actions}><Link href={`/pos-tickets/${row.id}`}>{String(row.number)}</Link></div><div style={{ overflowX: "auto" }}><TicketFacts value={row.facts} /></div></section>)}
      <p className={s.detail}><T text="Check-in records" />: {asRows(facts.visits).length} · <T text="Open tickets" />: {ticketRows.filter(row => asObject(row.facts).status === "open").length}</p>
    </>}
    {item.kind === "checkin" && <>
      <p className={s.notice}><T text="A missing link is not proof of non-payment. Match this visit to the correct receipt before collecting money again." /></p>
      <p className={s.detail}>{String(facts.customerName)} · {String(facts.visitStatus)} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.timezone }).format(new Date(String(facts.checkedInAt)))}</p>
      {!!facts.ticket && <div style={{ overflowX: "auto" }}><TicketFacts value={facts.ticket} /></div>}
      <h2><T text="Receipts for this customer on this business day" /></h2>
      {asRows(facts.possibleTickets).map(row => <section className={s.item} key={String(row.id)}><div className={s.actions}><Link href={`/pos-tickets/${row.id}`}>{String(row.number)}</Link></div><div style={{ overflowX: "auto" }}><TicketFacts value={row.facts} /></div></section>)}
      {!asRows(facts.possibleTickets).length && <p className={s.detail}><T text="No receipt found for this customer on this day. Check other receipts if a different customer was used." /></p>}
    </>}
    <div className={s.actions}><Link href={item.target_href}><T text={item.kind === "closing" ? "Open report" : item.kind === "checkin" && !facts.ticketId ? "Find receipt" : "Open ticket"} /></Link></div>
    <div className={s.item}><AttentionActions salonId={data.salonId} viewerId={data.viewerId} item={item} closing onSaved={onSaved} /></div>
  </article>;
}

export function AttentionList({ data, page = 0, onSaved }: { data: OwnerAttentionData; page?: number; onSaved?: () => void }) {
  return <><h1><T text="Financial attention" /> · {data.total}</h1>
    {data.items.map(row => <article className={`${s.item} ${s.notification}`} key={row.item_key}><div className={s.message}><h2>{row.label}</h2><p className={s.meta}>{row.business_date}</p><p className={s.detail}>{row.detail}</p></div><div className={s.notificationActions}><AttentionActions salonId={data.salonId} viewerId={data.viewerId} item={row} onSaved={onSaved} compact /></div></article>)}
    {!data.items.length && <p><T text="No financial items awaiting review." /></p>}
    <nav className={s.actions}>{page > 0 && <Link href={`/staff/today/attention?page=${page - 1}`}><T text="Previous" /></Link>}{(page + 1) * 50 < data.total && <Link href={`/staff/today/attention?page=${page + 1}`}><T text="Next" /></Link>}</nav>
  </>;
}
