import Link from "next/link";
import { WorkspaceText as T } from "@/components/workspace-language";
import type { OwnerAttentionData, OwnerAttentionItem } from "@/types/owner-financial-attention";
import { asObject, asRows, attentionMoney as money, attentionTicketAmounts, attentionPresentation, attentionTime } from "@/lib/owner-attention-presentation";
import { AttentionActions, AttentionNotification, ClosingNotification } from "./owner-attention-panel";
import s from "./owner-attention.module.css";

function TicketFacts({ value }: { value: unknown }) {
  const facts = asObject(value), totals = attentionTicketAmounts(facts);
  return <><dl className={s.amounts}>{([['Services',totals.service],['Discount',totals.discount],['Tips',totals.tip],['Total',totals.total],['Recorded paid',totals.paid],['Remaining',totals.remaining]] as const).map(([label,value])=><div key={label}><dt><T text={label}/></dt><dd>{money(value)}</dd></div>)}</dl>
    <p className={s.meta}><T text="Ticket status" />: {String(facts.status ?? "Unknown")}</p>
    {asRows(facts.lines).map((line, index) => <p className={s.detail} key={index}>{String(line.service_name ?? "Service")} · {String(line.staff_name ?? "Staff")} · {money(line.service_total)}</p>)}
  </>;
}

export function AttentionDetail({ data, item, onSaved }: { data: OwnerAttentionData; item: OwnerAttentionItem; onSaved?: () => void }) {
  if (item.kind === "closing") return <ClosingNotification data={data} item={item} onSaved={onSaved} />;
  const facts = item.facts ?? {}, view = attentionPresentation(item);
  const ticketRows = asRows(facts.tickets);
  const collection = asObject(facts.collection), report = asObject(facts.report);
  return <article className={s.panel}>
    <h1>{view.title}</h1><p className={s.meta}>{attentionTime(item, data.timezone, data.today)}</p>
    {view.ticket ? <>
      <p className={s.detail}>@{view.customer}</p>
      <p className={s.meta}>{view.edited ? "Edited by" : view.created ? "Created by" : "Discount recorded by"} {view.actor} · {view.source}</p>
      {view.edited ? <section className={s.section}><h2><T text="Changes" /></h2>
        {view.changes.map((change,index) => <p className={s.change} key={index}><span>{change.label}: </span>{change.comparison === "recorded" ? <strong>{change.recordedSide === "before" ? change.before : change.after}</strong> : <><span>{change.before} → </span><strong>{change.after}</strong></>}</p>)}
        {!view.changes.length && <p className={s.notice}><T text="The earlier values were not fully recorded." /></p>}
      </section> : <p className={s.discount}>Discount <strong>−{money(view.after.discount_amount)}</strong></p>}
      <section className={s.section}><h2><T text="Services" /></h2>
        {asRows(view.after.lines).map((line,index)=><div className={s.service} key={index}><div className={s.row}><strong>{String(line.service_name ?? "Service")}</strong><strong>{money(line.service_total)}</strong></div><p className={s.meta}>Staff: {String(line.staff_name ?? "Unassigned")}</p>{!!line.notes && <p className={s.detail}>{String(line.notes)}</p>}</div>)}
        {!asRows(view.after.lines).length && <p className={s.meta}><T text="Services not recorded" /></p>}
      </section>
      <dl className={s.summary}>{([['Services total',view.after.service_total],['Discount',view.after.discount_amount],...(Number(view.after.tax_rate) ? [['Tax',String(view.after.tax_rate)+'%']] : []),...(Number(view.after.tip_amount) ? [['Tip',view.after.tip_amount]] : []),['Total',attentionTicketAmounts(view.after).total]]).map(([label,value])=><div className={s.row} key={String(label)}><dt>{String(label)}</dt><dd>{label === 'Tax' ? String(value) : label === 'Discount' ? '−'+money(value) : money(value)}</dd></div>)}</dl>
      {!view.created && <p className={s.meta}>Ticket created by: {String(facts.createdBy || "Not recorded")}</p>}
      {((!!view.after.notes && !view.changes.some(c=>c.label === "Ticket note")) || !!facts.note && facts.note !== "Ticket created" || asRows(view.after.payments).some(p=>/gift/i.test(String(p.method)))) && <section className={s.section}><h2><T text="Additional details" /></h2>
        {!!facts.note && facts.note !== "Ticket created" && <p className={s.detail}>Reason: {String(facts.note)}</p>}
        {!!view.after.notes && !view.changes.some(c=>c.label === "Ticket note") && <p className={s.detail}>Note: {String(view.after.notes)}</p>}
        {asRows(view.after.payments).filter(p=>/gift/i.test(String(p.method))).map((p,i)=><p className={s.detail} key={i}>Gift: {money(p.amount)}{p.note ? ' · '+p.note : ""}</p>)}
      </section>}
    </> : <p className={s.detail}>{item.detail}</p>}
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
    {data.items.map(item => <AttentionNotification data={data} item={item} key={item.item_key} onSaved={onSaved} />)}
    {!data.items.length && <p><T text="No financial items awaiting review." /></p>}
    <nav className={s.actions}>{page > 0 && <Link href={`/staff/today/attention?page=${page - 1}`}><T text="Previous" /></Link>}{(page + 1) * 50 < data.total && <Link href={`/staff/today/attention?page=${page + 1}`}><T text="Next" /></Link>}</nav>
  </>;
}
