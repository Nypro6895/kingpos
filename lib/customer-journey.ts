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
/** Presentation only: recorded receipts win over their linked appointment.
 * Never merge by salon/date/name, or derive payment from elapsed time. */
export function customerJourneyGroups(data: CustomerActivityData) {
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
  return {
    active: unique.filter(isActiveCustomerVisit),
    upcoming: unique.filter((item): item is CustomerBookingActivity => item.type === "booking" && item.status === "upcoming")
      .sort((a,b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    history: unique.filter(item => !isActiveCustomerVisit(item) && item.status !== "upcoming")
      .sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
  };
}
export function customerVisitQrHref(item: CustomerActivity) {
  const id = item.type === "visit" ? item.id.replace(/^visit-/, "") : item.type === "booking" ? item.historyEvidence?.visitId : undefined;
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? `/qr?visit=${encodeURIComponent(id)}` : "/qr";
}
