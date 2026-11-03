import type { CustomerActivity, CustomerActivityData, CustomerBookingActivity } from "./customer-activity";

export type CustomerJourneyTab = "upcoming" | "history";
export function customerJourneyTab(value?: string | null, legacyActivity = false): CustomerJourneyTab {
  return legacyActivity || ["history", "past", "cancelled"].includes(value ?? "") ? "history" : "upcoming";
}
export function isActiveCustomerVisit(item: CustomerActivity) {
  if (item.type === "purchase" || ["cancelled","no_show"].includes(item.status)) return false;
  if(item.visitState)return ["waiting","in_service","checkout"].includes(item.visitState);
  return item.type==="booking" ? item.bookingStatus==="checked_in" || item.bookingStatus==="in_service" : item.status==="checked_in" || item.status==="in_service";
}
export function customerVisitArrivedAt(item:CustomerActivity){return item.type==="visit"?item.occurredAt:item.type==="booking"?item.historyEvidence?.checkedInAt:undefined;}
/** Use appointment instants, independent of the customer's device time zone.
 * Any recorded arrival/service/receipt evidence suppresses another check-in. */
export function canCheckInForAppointment(item: CustomerActivity, now: number) {
  if (item.type !== "booking" || !["upcoming", "past_appointment"].includes(item.status)) return false;
  if (item.bookingStatus && !["pending", "confirmed", "scheduled"].includes(item.bookingStatus)) return false;
  if (item.visitState || item.historyEvidence?.checkedInAt || item.historyEvidence?.visitId || item.historyEvidence?.ticket) return false;
  const start = Date.parse(item.startAt);
  return Number.isFinite(start) && Number.isFinite(now) && now >= start - 15 * 60_000 && now <= start + 60 * 60_000;
}
/** Presentation only: recorded receipts win over their linked appointment.
 * Never merge by salon/date/name, or derive payment from elapsed time. */
export function customerJourneyGroups(data: CustomerActivityData, now?: number) {
  const records = [...data.upcoming, ...data.history];
  const tickets = new Set<string>(), linkedBookings = new Set<string>();
  for (const item of records) if (item.type === "purchase") {
    tickets.add(item.ticketId);
    if (item.bookingId) linkedBookings.add(item.bookingId);
  }
  const seen = new Set<string>();
  const linkedVisits = new Set(records.flatMap(item=>item.type==="booking"&&item.historyEvidence?.visitId?[item.historyEvidence.visitId]:[]));
  const unique = records.filter(item => {
    const key = item.type === "purchase" ? `ticket:${item.ticketId}` : item.type === "booking" ? `booking:${item.bookingId}` : item.id;
    if (seen.has(key)) return false;
    if(item.type==="visit"&&linkedVisits.has(item.id.replace(/^visit-/,"")))return false;
    if (item.type === "booking" && (linkedBookings.has(item.bookingId) || item.historyEvidence?.ticket && tickets.has(item.historyEvidence.ticket.ticketId))) return false;
    seen.add(key); return true;
  });
  // Keep a just-started appointment accessible in Upcoming for its check-in
  // window even when the server has already classified it as past.
  const isUpcoming = (item: CustomerActivity) => item.type === "booking" &&
    (item.status === "upcoming" || now !== undefined && canCheckInForAppointment(item, now));
  return {
    active: unique.filter(isActiveCustomerVisit),
    upcoming: unique.filter((item): item is CustomerBookingActivity => isUpcoming(item))
      .sort((a,b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    history: unique.filter(item => !isActiveCustomerVisit(item) && !isUpcoming(item))
      .sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
  };
}
export function customerVisitQrHref(item: CustomerActivity) {
  const id = item.type === "visit" ? item.id.replace(/^visit-/, "") : item.type === "booking" ? item.historyEvidence?.visitId : undefined;
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? `/qr?visit=${encodeURIComponent(id)}` : "/qr";
}
