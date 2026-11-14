"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useOverlayPortalHost, useTransientOverlay } from "@/components/overlay-dismissal";
import { useDialogViewport } from "@/components/use-dialog-viewport";
import { useBookingClock } from "@/components/booking-ui/use-booking-clock";
import { confirmNoShowHistory } from "@/components/booking-ui/no-show-confirmation";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { appointmentState } from "@/lib/appointment-state";
import type { BookingWorkspaceItem } from "@/lib/bookings";
import { createBookingPosTicketAction, runBookingStatusAction, type BookingActionResult } from "./actions";

function NoShowNoteDialog({ booking, pending, error, close, submit }: {
  booking: BookingWorkspaceItem; pending: boolean; error: string;
  close: () => void; submit: (note: string) => void;
}) {
  const translate = useWorkspaceTranslation();
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const host = useOverlayPortalHost();
  useTransientOverlay(close, true);
  useDialogViewport(ref, Boolean(host), "sheet");
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !host) return;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [host]);
  if (!host) return null;
  return createPortal(<dialog ref={ref} className="owner-no-show-dialog" aria-labelledby={title} role="dialog"
    onCancel={event => { event.preventDefault(); if (!pending) close(); }}
    onClick={event => { if (event.target === event.currentTarget && !pending) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <form onSubmit={event => { event.preventDefault(); if (!pending) submit(note); }}>
      <header><h2 id={title}><WorkspaceText text="Mark as no-show" /></h2><button type="button" onClick={close} disabled={pending} aria-label={translate("Close")}>×</button></header>
      <p>{booking.customer?.name ?? translate("Unknown customer")}</p>
      <label><WorkspaceText text="No-show note (optional)" /><textarea value={note} onChange={event => setNote(event.target.value)} disabled={pending} maxLength={2000} rows={3} autoFocus /></label>
      {error && <p role="alert"><WorkspaceText text={error} /></p>}
      <footer><button type="button" disabled={pending} onClick={close}><WorkspaceText text="Cancel" /></button><button type="submit" disabled={pending} className="owner-agenda-no-show"><WorkspaceText text={pending ? "Saving…" : "Mark No-show"} /></button></footer>
    </form>
  </dialog>, host);
}

export function OwnerAgendaRow({ booking, timezone, canManage, onOpen, inspiration }: {
  booking: BookingWorkspaceItem; timezone: string; canManage: boolean;
  onOpen: (booking: BookingWorkspaceItem) => void;
  inspiration?: ReactNode;
}) {
  const translate = useWorkspaceTranslation();
  const router = useRouter();
  const now = useBookingClock();
  const [pending, startTransition] = useTransition();
  const running = useRef(false);
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [resolved, setResolved] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<string | null>(null);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const status = resolved ?? (confirmed ? "confirmed" : booking.normalizedStatus);
  const displayStatus = appointmentState(status, booking.start_at, now);
  const ticketId = createdTicket ?? booking.posTicket?.id;
  const active = ["pending", "confirmed", "checked_in", "in_service"].includes(status);
  const arrivedTime = now > 0 && Date.parse(booking.start_at) <= now;
  const canConfirm = canManage && !ticketId && status === "pending";
  const canTicket = canManage && !ticketId && arrivedTime && ["confirmed", "checked_in", "in_service"].includes(status)
    && !["requested", "cancelled", "declined"].includes(confirmed ? "confirmed" : booking.confirmation_status);
  const canNoShow = canManage && !ticketId && arrivedTime && ["pending", "confirmed"].includes(status);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(booking.start_at));
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(booking.subtotal);

  function run(kind: "confirm" | "ticket" | "no_show", note = "") {
    if (running.current || (kind === "confirm" && !canConfirm) || (kind === "ticket" && !canTicket) || (kind === "no_show" && !canNoShow)) return;
    running.current = true;
    setResult(null);
    startTransition(async () => {
      try {
        let response = kind === "ticket"
          ? await createBookingPosTicketAction({ bookingId: booking.id })
          : await runBookingStatusAction({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, command: kind === "confirm" ? "confirm" : "mark_no_show", reason: note });
        if (kind === "confirm" && response.code === "no_show_review_required" && response.noShowHistory) {
          if (!await confirmNoShowHistory(response.noShowHistory)) return;
          response = await runBookingStatusAction({ bookingId: booking.id, expectedUpdatedAt: booking.updated_at, command: "confirm", reason: "", acknowledgeNoShow: true });
        }
        if (kind === "ticket" && response.ok && !response.ticketId) response = { ok: false, message: "Ticket could not be created. Please try again." };
        setResult(response);
        if (response.ok) {
          if (kind === "confirm") setConfirmed(true);
          if (kind === "ticket") { setCreatedTicket(response.ticketId!); setResolved("completed"); }
          if (kind === "no_show") { setResolved("no_show"); setNoShowOpen(false); }
          router.refresh();
        }
      } catch { setResult({ ok: false, message: "Could not update. Please try again." }); }
      finally { running.current = false; }
    });
  }

  return <details className="owner-agenda-item" name="owner-appointment" data-busy={pending}>
    <summary className="owner-agenda-row" aria-label={translate(`Appointment for ${booking.customer?.name ?? "Unknown customer"}`)}>
      <time dateTime={booking.start_at}>{time}</time>
      <span className="owner-agenda-staff">{booking.assignedStaffNames.join(", ") || translate("Unassigned")}</span>
      <span className="owner-agenda-service"><WorkspaceText text={booking.serviceNames.join(" / ") || "No services"} /><small>{booking.durationMinutes} <WorkspaceText text="min" /> · {money}</small></span>
      <span className="owner-agenda-customer"><strong>{booking.customer?.name ?? translate("Unknown customer")}</strong>{(!active || ticketId) && <small><WorkspaceText text={bookingStatusLabel(displayStatus, booking.no_show_kind)} /></small>}</span>
      <button type="button" className="owner-agenda-edit" aria-label={translate(canManage ? `Edit appointment for ${booking.customer?.name ?? "Unknown customer"}` : "View appointment")}
        disabled={pending} onClick={event => { event.preventDefault(); event.stopPropagation(); onOpen(booking); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L20 8a2.1 2.1 0 0 0-4-4L5 15Z" /></svg>
      </button>
    </summary>
    <div className="owner-agenda-expanded">
      <div className="owner-agenda-contact-actions">
        <div className="owner-agenda-contact">
          {canManage && booking.customer?.phone && <a href={`tel:${booking.customer.phone}`}>{booking.customer.phone}</a>}
          {canManage && booking.customer?.email && <a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a>}
          {(!canManage || (!booking.customer?.phone && !booking.customer?.email)) && <span><WorkspaceText text={canManage ? "No contact information" : "Customer details"} /></span>}
        </div>
        <div className="owner-agenda-actions" aria-busy={pending}>
          {canConfirm && <button type="button" disabled={pending} onClick={() => run("confirm")}><WorkspaceText text="Confirm" /></button>}
          {canTicket && <button type="button" disabled={pending} onClick={() => run("ticket")}><WorkspaceText text="Create ticket" /></button>}
          {ticketId && <a href={`/pos-tickets/${ticketId}`}><WorkspaceText text="POS ticket" /></a>}
          {canNoShow && <button type="button" disabled={pending} className="owner-agenda-no-show" onClick={() => { setResult(null); setNoShowOpen(true); }}><WorkspaceText text="No-show" /></button>}
        </div>
      </div>
      {(booking.public_notes || booking.notes) && <p className="owner-agenda-note">{booking.public_notes || booking.notes}</p>}
      {canManage && booking.internal_notes && <p className="owner-agenda-note"><WorkspaceText text="Internal note" />: {booking.internal_notes}</p>}
      {canManage && booking.no_show_reason && <p className="owner-agenda-note"><WorkspaceText text="No-show reason" />: {booking.no_show_reason}</p>}
      {booking.cancellation_reason && <p className="owner-agenda-note"><WorkspaceText text="Cancellation" />: {booking.cancellation_reason}</p>}
      {Boolean(booking.noShowCount) && <p className="owner-agenda-note">{booking.noShowCount} <WorkspaceText text="previous no-show" /></p>}
      {inspiration}
      {result && !noShowOpen && <p role={result.ok ? "status" : "alert"} className="owner-agenda-result"><WorkspaceText text={result.message} /></p>}
    </div>
    {noShowOpen && <NoShowNoteDialog booking={booking} pending={pending} error={result?.ok === false ? result.message : ""} close={() => { if (!running.current) setNoShowOpen(false); }} submit={note => run("no_show", note)} />}
  </details>;
}
