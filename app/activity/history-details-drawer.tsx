"use client";
import { useCloseOnNavigation } from "@/components/overlay-dismissal";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { historyBookingLabel } from "@/lib/booking-history";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { loadHistoryDetailsAction } from "./history-details-actions";
import { HistoryLinkControl } from "./history-link-control";
import { VisitExperiencePrompt } from "./visit-experience-prompt";
import { BookingDetailActions } from "@/app/my-bookings/[bookingId]/booking-detail-actions";
import bookingStyles from "@/components/booking-ui/booking-theme.module.css";
import type { CustomerActivity, CustomerActivityReceipt } from "@/lib/customer-activity";
import type { CustomerBookingDetail } from "@/lib/customer-bookings";

export function HistoryDetailsDrawer({ activity, onClose }: { activity: CustomerActivity; onClose: () => void }) {
  useCloseOnNavigation(onClose);
  const dialog = useRef<HTMLDialogElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) setPortalHost(document.body); }); return () => { active = false; }; }, []);
  const [data, setData] = useState<{ booking: CustomerBookingDetail | null; receipt: CustomerActivityReceipt | null } | null>(activity.type === "visit" ? { booking: null, receipt: null } : null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [now] = useState(() => Date.now());
  const [activeBookingId, setActiveBookingId] = useState<string>();
  const bookingId = activeBookingId ?? (activity.type === "booking" ? activity.bookingId : activity.type === "purchase" ? activity.bookingId : undefined);
  const ticketId = activity.type === "purchase" ? activity.ticketId : undefined;
  useEffect(() => {
    if (!portalHost) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = previousOverflow; };
  }, [portalHost]);
  useEffect(() => {
    if (activity.type === "visit") return;
    let active = true;
    loadHistoryDetailsAction({ bookingId, ticketId }).then(result => {
      if (!active) return;
      if (result.error) setError(result.error);
      else { setError(""); setData({ booking: result.booking ?? null, receipt: result.receipt ?? null }); }
    }).catch(() => { if (active) setError("Details could not be loaded. Please try again."); });
    return () => { active = false; };
  }, [activity.type, bookingId, ticketId, retry]);
  const booking = data?.booking;
  const receipt = data?.receipt;
  const timezone = booking?.salon_timezone_snapshot ?? activity.timezone ?? "America/Chicago";
  const date = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
  const money = (value: number | string) => new Intl.NumberFormat("en-US", { style: "currency", currency: activity.currency }).format(Number(value));
  const location = receipt ? [receipt.salon.addressLine1,receipt.salon.addressLine2,receipt.salon.city,receipt.salon.state,receipt.salon.postalCode].filter(Boolean).join(", ") : booking ? [booking.salon?.address_line1,booking.salon?.address_line2,booking.salon?.city,booking.salon?.state,booking.salon?.postal_code].filter(Boolean).join(", ") : activity.salon.location;
  const services = receipt?.services ?? booking?.lines?.map(line => ({ id: line.id, name: line.service_name_snapshot, staffName: line.assignedStaff?.displayName, quantity: Number(line.quantity ?? 1), lineTotal: Number(line.line_total) })) ?? activity.services;
  const phone = receipt?.salon.phone ?? booking?.salon?.phone;
  const total = receipt?.totals.total ?? (booking?.lines?.reduce((sum,line) => sum + Number(line.line_total),0) ?? activity.total);
  const checkedInAt = booking?.historyEvidence?.checkedInAt ?? (activity.type === "purchase" ? activity.checkedInAt : activity.type === "visit" ? activity.occurredAt : null);
  const startAt = booking?.start_at ?? activity.occurredAt;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(startAt));
  const time = (value: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
  const duration = booking ? Math.round((new Date(booking.end_at).getTime() - new Date(booking.start_at).getTime()) / 60000) : null;
  const canChange = Boolean(booking && !receipt && !booking.historyEvidence?.ticket && ["confirmed", "scheduled", "pending"].includes(booking.status) && new Date(booking.start_at).getTime() > now);
  const status = receipt ? "Visited" : booking ? historyBookingLabel(booking.status, booking.start_at, booking.historyEvidence, now) ?? bookingStatusLabel(booking.status, booking.no_show_kind) : activity.type === "visit" ? "Checked in" : "";
  const address = receipt ? [receipt.salon.addressLine1, receipt.salon.addressLine2].filter(Boolean).join(", ") : [booking?.salon?.address_line1, booking?.salon?.address_line2].filter(Boolean).join(", ");
  const city = receipt ? [receipt.salon.city, receipt.salon.state, receipt.salon.postalCode].filter(Boolean).join(", ") : booking ? [booking.salon?.city, booking.salon?.state, booking.salon?.postal_code].filter(Boolean).join(", ") : location;
  const logo = booking?.salon?.logoUrl ?? activity.salon.imageUrl;
  const canViewSalon = Boolean(booking?.salon?.publicDiscoveryEnabled || receipt);
  return portalHost ? createPortal(<dialog ref={dialog} aria-labelledby="history-details-title" onCancel={event => { if (event.target !== event.currentTarget) event.stopPropagation(); }} onClose={event => { if (event.target === event.currentTarget) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}
    className={`${bookingStyles.bookingSurface} fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-sm overflow-y-auto border-0 bg-white p-0 text-text-primary shadow-xl backdrop:bg-black/30`}>
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-white px-4 py-2">
      <h2 id="history-details-title" className="text-sm font-semibold">Booking details</h2>
      <button type="button" onClick={() => dialog.current?.close()} className="flex h-10 w-10 items-center justify-center text-xl text-text-secondary" aria-label="Close history details">&times;</button>
    </header>
    <div className="px-4 pb-6 text-sm">
      <section className="border-b border-border-subtle py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-orange-soft text-brand-orange">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt={`${activity.salon.name} logo`} className="h-full w-full object-cover" />
            ) : activity.salon.name.slice(0, 2)}
          </span>
          <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="text-lg font-semibold leading-6">{activity.salon.name}</h3><span className="pt-1 text-[11px] font-normal text-text-secondary">{status}</span></div>
            <div className="mt-1 text-xs leading-5 text-text-secondary">{address ? <p>{address}</p> : null}{city ? <p>{city}</p> : null}</div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-brand-teal">
              {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>Call salon</a> : null}
              {canViewSalon ? <Link href={`/explore/salons/${activity.salon.id}`}>View salon</Link> : null}
            </div>
          </div>
        </div>
      </section>
      {!data && !error ? <p role="status" className="py-3 text-xs">Loading details...</p> : null}
      {error ? <div role="alert" className="py-3"><p>{error}</p><button className="min-h-10 text-brand-teal" onClick={() => { setError(""); setRetry(retry+1); }} type="button">Try again</button></div> : null}
      <section className="border-b border-border-subtle py-3">
        <p className="text-lg font-semibold">{day}</p>
        <p className="mt-1 font-medium">{time(startAt)}{booking ? `\u2013${time(booking.end_at)}` : ""}</p>
        {duration !== null ? <p className="mt-1 text-xs text-text-secondary">{duration} min</p> : null}
        {checkedInAt ? <p className="mt-1 text-xs text-text-secondary">Check-in · {date(checkedInAt)}</p> : null}
        {receipt ? <p className="mt-1 text-xs text-text-secondary">Receipt {receipt.ticketNumber} · {date(receipt.closedAt ?? receipt.openedAt)}{receipt.verifiedVisit ? " · Verified visit" : ""}</p> : null}
      </section>
      <section className="border-b border-border-subtle py-3"><h3 className="mb-1 text-xs font-normal">{receipt ? "Services received" : "Services"}</h3>
        <ul className="divide-y divide-border-subtle">{services.map((service,index) => <li key={service.id ?? index} className="flex justify-between gap-3 py-2"><div className="min-w-0"><p className="font-semibold">{service.name}{service.quantity && service.quantity > 1 ? ` x${service.quantity}` : ""}</p><p className="mt-0.5 text-xs font-normal text-text-secondary">{[service.staffName, !receipt && booking?.lines?.[index]?.duration_minutes ? `${booking.lines[index].duration_minutes} min` : null].filter(Boolean).join(" · ")}</p></div>{service.lineTotal !== undefined ? <span className="shrink-0 font-semibold">{money(service.lineTotal)}</span> : null}</li>)}</ul>
      </section>
      {receipt ? <dl className="grid grid-cols-2 gap-y-1.5 border-b border-border-subtle py-3 text-xs text-text-secondary">
        <dt>Subtotal</dt><dd className="text-right">{money(receipt.totals.subtotal)}</dd>
        {receipt.totals.discount_amount ? <><dt>Discount</dt><dd className="text-right">&minus;{money(receipt.totals.discount_amount)}</dd></> : null}
        {receipt.totals.tax_amount ? <><dt>Tax</dt><dd className="text-right">{money(receipt.totals.tax_amount)}</dd></> : null}
        {receipt.totals.tip_amount ? <><dt>Tip</dt><dd className="text-right">{money(receipt.totals.tip_amount)}</dd></> : null}
        <dt className="text-sm font-semibold text-text-primary">Paid at salon</dt><dd className="text-right text-lg font-semibold text-text-primary">{money(total)}</dd>
        {receipt.payments.length ? <><dt>Payment method</dt><dd className="text-right">{receipt.payments.map(payment => payment.label).join(", ")}</dd></> : null}
      </dl> : activity.type !== "visit" ? <section className="border-b border-border-subtle py-3"><p className="flex items-center justify-between gap-3 font-semibold"><span>Estimated total</span><span className="text-lg">{money(total)}</span></p><p className="mt-1 text-[11px] text-text-secondary">Booking estimate. Final amount is recorded by the salon.</p></section> : null}
      {booking && (booking.inspiration || booking.public_notes || booking.no_show_reason || booking.cancellation_reason) ? <details className="border-b border-border-subtle py-2">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-3 text-xs">
          {booking.inspiration?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="h-8 w-8 rounded-md object-cover" src={booking.inspiration.imageUrl} alt="Booked inspiration" />
          ) : null}<span className="flex-1">Booked look &amp; notes</span><span className="text-lg text-text-secondary">&rsaquo;</span>
        </summary>
        <div className="grid gap-2 pb-2 text-xs text-text-secondary">
          {booking.inspiration ? <><p>{booking.inspiration.source_title_snapshot ?? "Your inspiration"}</p>{booking.inspiration.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="max-h-48 w-full rounded-lg object-contain" src={booking.inspiration.imageUrl} alt="Booked look" />
          ) : null}{booking.inspiration.source_caption_snapshot ? <p>{booking.inspiration.source_caption_snapshot}</p> : null}</> : null}
          {booking.public_notes ? <p>{booking.public_notes}</p> : null}
          {booking.no_show_reason ? <p>Note: {booking.no_show_reason}</p> : null}
          {booking.cancellation_reason ? <p>Cancellation: {booking.cancellation_reason}</p> : null}
        </div>
      </details> : null}
      {booking && receipt ? <details className="border-b border-border-subtle py-2 text-xs"><summary className="cursor-pointer py-2">Original booking · Est. {money(booking.lines?.reduce((sum,line) => sum+Number(line.line_total),0) ?? 0)}</summary><ul>{booking.lines?.map(line => <li className="flex justify-between py-1" key={line.id}><span>{line.service_name_snapshot}</span><span>{money(line.line_total)}</span></li>)}</ul></details> : null}
      <div className="grid gap-2 pt-3">
        {booking ? <HistoryLinkControl bookingId={booking.id} evidence={booking.historyEvidence} timezone={timezone} /> : null}
        {receipt?.verifiedVisit ? <VisitExperiencePrompt compact actionLabel="Report experience" countsTowardReputation={receipt.verifiedVisit.countsTowardReputation} initialBody={receipt.verifiedVisit.experienceBody} initialState={receipt.verifiedVisit.experienceState} salonName={activity.salon.name} ticketId={receipt.ticketId} windowDays={receipt.verifiedVisit.windowDays} /> : null}
        {booking ? <BookingDetailActions embedded onChanged={newBookingId => { if (newBookingId) setActiveBookingId(newBookingId); setRetry(value => value+1); }} booking={booking} canViewSalon={canViewSalon} canChange={canChange} canBookAgain={!canChange && Boolean(booking.lines?.some(line => line.currentServiceBookable))} /> : data && activity.type !== "booking" ? <Link className="inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-orange px-4 text-white" href={`/book/${activity.salon.id}`}>Rebook</Link> : null}
      </div>
    </div>
  </dialog>, portalHost) : null;
}
