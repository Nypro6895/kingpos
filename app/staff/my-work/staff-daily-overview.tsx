"use client";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import {InlineFinancialHistory,InlineFinancialRecord,useInlineFinancialHistory,useFinancialHistoryContext} from "@/app/payroll/inline-financial-history";
import {staffTicketHistoryContexts,type StaffTicketHistoryContext} from "@/lib/staff-ticket-history-context";
import {financialHistoryText} from "@/lib/financial-change-presentation";
import type {ReactNode} from "react";
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
  return <WorkspaceElement as="section" className={styles.metrics} aria-label="Today's personal results">
    <div className={`${styles.metric} ${styles.featured}`}>
      <details className={styles.help}>
        <summary className={styles.label}><WorkspaceText text="Ticket earnings" /> <span aria-hidden="true">i</span></summary>
        <p className={styles.popover}><WorkspaceText text="Your completed services, allocated tips and ticket earning adjustments. This is not your take-home pay. Open tickets and tickets without earnings are excluded." /></p>
      </details>
      <p className={styles.value}>{money(activity.totalEarning)}</p>
      <p className={styles.hint}>{completedTickets} <WorkspaceText text="completed" /> <WorkspaceText text={completedTickets === 1 ? "ticket" : "tickets"} /></p>
    </div>
    <div className={styles.metric}><p className={styles.label}><WorkspaceText text="Services" /></p><p className={styles.value}>{money(activity.assignedServiceAmount)}</p><p className={`${styles.hint} ${styles.optional}`}><WorkspaceText text="Your assigned services" /></p></div>
    <div className={styles.metric}><p className={styles.label}><WorkspaceText text="Tips" /></p><p className={styles.value}>{money(activity.tipAmount)}</p><p className={`${styles.hint} ${styles.optional}`}><WorkspaceText text="Your allocated tips" /></p></div>
    <div className={styles.metric}><p className={styles.label}><WorkspaceText text="Turns" /></p><p className={styles.value}>{number(activity.bigTurns + activity.smallTurns)}</p><p className={styles.hint}>{number(activity.bigTurns)} <WorkspaceText text="big ·" /> {number(activity.smallTurns)} <WorkspaceText text="small" /></p></div>
  </WorkspaceElement>;
}

export function StaffDailyTickets({ tickets, timezone,staffId,businessDate,emptyState }: { tickets: StaffAssignedWorkTicket[]; timezone: string;staffId:string;businessDate:string;emptyState?:ReactNode }) {
  const ordered = [...tickets].sort((a, b) => (b.openedAt ?? b.firstActivityAt ?? "").localeCompare(a.openedAt ?? a.firstActivityAt ?? ""));
  const history=useFinancialHistoryContext(),contexts=staffTicketHistoryContexts(tickets.map(ticket=>ticket.id),businessDate,staffId,history.changes,history.record);
  if(!ordered.length&&!contexts.length)return <>{emptyState}{history.error&&<p className={styles.pending} role="status"><WorkspaceText text="Ticket edit history could not load."/> <button type="button" onClick={history.retry}><WorkspaceText text="Retry"/></button></p>}</>;
  return <>
    <WorkspaceElement as="section" className={styles.list} aria-label="Your tickets today">
      <div className={styles.columns} aria-hidden="true"><span><WorkspaceText text="Ticket / time" /></span><span><WorkspaceText text="Service / customer" /></span><span><WorkspaceText text="Status" /></span><span className={styles.amount}><WorkspaceText text="Tip" /></span><span className={styles.amount}><WorkspaceText text="Earnings" /></span><span /></div>
      {ordered.map(ticket => <StaffDailyTicketRow ticket={ticket} timezone={timezone} staffId={staffId} businessDate={businessDate} key={ticket.id}/>)}
      {contexts.map(context=><StaffTicketContextRow context={context} key={context.ticketId+context.businessDate}/>)}
      {history.error&&<p className={styles.pending} role="status"><WorkspaceText text="Ticket edit history could not load."/> <button type="button" onClick={history.retry}><WorkspaceText text="Retry"/></button></p>}
    </WorkspaceElement>
    <p className={styles.footnote}><WorkspaceText text="Only your assigned work · Salon local time" /></p>
  </>;
}

function StaffDailyTicketRow({ticket,timezone,staffId,businessDate}:{ticket:StaffAssignedWorkTicket;timezone:string;staffId:string;businessDate:string}){
 const history=useInlineFinancialHistory({ticketId:ticket.id,staffId,businessDate,sourceKinds:["ticket"]});
 return <details className={`${styles.ticket} ${history.hasChanges?styles.edited:""}`} data-edited-ticket={history.hasChanges?ticket.id:undefined}>
        <summary className={styles.row}>
          <span className={styles.code}><strong><WorkspaceText text={ticket.ticketNumber || "Ticket"} /></strong><small><WorkspaceText text={time(ticket.openedAt ?? ticket.firstActivityAt, timezone)} /></small>{history.hasChanges&&<small className={styles.editedLabel}><WorkspaceText text="Edited"/> · {history.changes.length}</small>}</span>
          <span className={styles.service}><strong>{ticket.services.length ? ticket.services.map(s => `${s.serviceName}${s.quantity !== 1 ? ` ×${number(s.quantity)}` : ""}`).join(", ") : "No assigned services"}</strong><small><CustomerName name={ticket.customerName} fallback="Walk-in" /> · {money(ticket.serviceTotal)} <WorkspaceText text="service" />{ticket.hasEarning ? ` · ${number(ticket.totalTurns)} ${ticket.totalTurns === 1 ? "turn" : "turns"}` : ""}</small>{!ticket.hasEarning && <span className={styles.pending}><WorkspaceText text="Earnings pending" /></span>}</span>
          <span className={`${styles.state} ${ticket.status === "closed" ? styles.closed : styles.open}`}>{ticket.status === "closed" ? <WorkspaceText text="Closed" /> : <WorkspaceText text="Open" />}</span>
          <span className={`${styles.tip} ${styles.amount}`}>{ticket.hasEarning ? money(ticket.tipAmount) : "—"}</span>
          <strong className={`${styles.total} ${styles.amount}`}>{ticket.hasEarning ? money(ticket.totalEarning) : "—"}</strong>
          <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </summary>
        <div className={styles.detail}>
          <InlineFinancialHistory changes={history.changes}/>
          {history.record&&<InlineFinancialRecord record={history.record}/>}
          <div className={styles.facts}><span><WorkspaceText text="Services" /> <strong>{money(ticket.serviceTotal)}</strong></span><span><WorkspaceText text="Tip" /> <strong>{ticket.hasEarning ? money(ticket.tipAmount) : <WorkspaceText text="Pending" />}</strong></span><span><WorkspaceText text="Turns" /> <strong>{ticket.hasEarning ? `${number(ticket.bigTurns)} big · ${number(ticket.smallTurns)} small` : <WorkspaceText text="Pending" />}</strong></span>{ticket.customerPhone && <span><WorkspaceText text="Customer phone" /> <strong>{ticket.customerPhone}</strong></span>}</div>
          <ul className={styles.services}>{ticket.services.map(service => <li className={styles.line} key={service.id}><span>{service.serviceName} ×{number(service.quantity)} <small>· <WorkspaceText text={time(service.createdAt, timezone)} /></small></span><strong>{money(service.lineTotal)}</strong></li>)}</ul>
          {!ticket.hasEarning && <p className={styles.pending}><WorkspaceText text="Earnings are pending. These services are shown for reference and excluded from the totals above." /></p>}
        </div>
      </details>;
}

function StaffTicketContextRow({context}:{context:StaffTicketHistoryContext}){
 const values=context.values,lines=Array.isArray(values.lines)?values.lines.filter((line):line is Record<string,unknown>=>Boolean(line)&&typeof line==="object"):[];
 const removed=Array.isArray(values.lines)&&!lines.length&&context.changes.some(change=>Array.isArray(change.before_values.lines)&&change.before_values.lines.length>0);
 return <details className={`${styles.ticket} ${context.changes.length?styles.edited:""}`} data-ticket-context={context.ticketId}>
  <summary className={styles.row}>
   <span className={styles.code}><strong>{financialHistoryText(context.ticketNumber,"Ticket")}</strong><small>{context.businessDate}</small>{context.changes.length>0&&<small className={styles.editedLabel}><WorkspaceText text="Edited"/> · {context.changes.length}</small>}</span>
   <span className={styles.service}><strong><WorkspaceText text={removed?"No longer assigned":"Earlier ticket"}/></strong><small><WorkspaceText text="Reference only · Excluded from today's totals"/></small></span>
   <span className={styles.state}><WorkspaceText text={financialHistoryText(values.status,"Recorded")}/></span>
   <span className={`${styles.tip} ${styles.amount}`}>—</span><strong className={`${styles.total} ${styles.amount}`}>—</strong>
   <svg className={styles.arrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  </summary>
  <div className={styles.detail}><InlineFinancialHistory changes={context.changes}/>{context.record&&<InlineFinancialRecord record={context.record}/>}</div>
 </details>;
}
