import type { ComponentProps } from "react";
import type { OwnerLiveBookingWorkspace } from "@/app/bookings/owner-live-booking-workspace";
import type { OwnerLiveTickets } from "@/app/pos-tickets/owner-live-tickets";
import type { OwnerLiveReports } from "@/app/reports/owner-live-reports";
import type { PortableCheckInData } from "@/app/pos/portable/actions";
import type { PosDeskStaff, PosDeskService } from "@/types/pos-desk";
import type { PosDeskDefaults } from "@/lib/pos-settings";
import type { PosWorkspacePreferences } from "@/lib/pos-workspace-preferences";

export const OWNER_LOCAL_PATHS = ["/pos", "/pos/check-in", "/pos/ticket", "/pos/book", "/pos/report"] as const;
export type OwnerLocalPath = typeof OWNER_LOCAL_PATHS[number];
export type OwnerLocalReadName = "owner.workspace" | "owner.check-in" | "owner.tickets" | "owner.bookings" | "owner.reports";
export type OwnerWorkspaceReference = {
  ownerScope: string; salonId: string; salonName: string; timezone: string; today: string;
  staff: PosDeskStaff[]; services: PosDeskService[]; defaults: PosDeskDefaults; preferences: PosWorkspacePreferences;
};
export type OwnerCheckInSnapshot = { data: PortableCheckInData; ids?: string[]; removedIds?: string[] };
export type OwnerBookingSnapshot = ComponentProps<typeof OwnerLiveBookingWorkspace>;
export type OwnerTicketSnapshot = ComponentProps<typeof OwnerLiveTickets> & { selectedDate: string; today: string };
export type OwnerReportSnapshot = ComponentProps<typeof OwnerLiveReports>;
export type OwnerLocalPanelData =
  | { view: "check-in"; props: OwnerCheckInSnapshot }
  | { view: "bookings"; props: OwnerBookingSnapshot }
  | { view: "tickets"; props: OwnerTicketSnapshot }
  | { view: "reports"; props: OwnerReportSnapshot }
  | { view: "workspace"; props: OwnerWorkspaceReference }
  | { view: "denied"; message: string };

const queryNames = new Set(["bookingId", "date", "q", "range", "request", "section", "service", "source", "staff", "staffId", "status", "tab", "view", "preset", "start", "end", "error"]);
/** Only declared read filters enter local keys. Action/payment URLs keep their original transport. */
export function ownerLocalHref(value: string): string | null {
  try {
    const url = new URL(value, "https://reylumi.com");
    if (url.origin !== "https://reylumi.com" || !OWNER_LOCAL_PATHS.includes(url.pathname as OwnerLocalPath) || url.username || url.password || value.length > 4096) return null;
    for (const [key, item] of url.searchParams) if (!queryNames.has(key) || item.length > 512) return null;
    url.searchParams.sort(); return url.pathname + url.search;
  } catch { return null; }
}
export function ownerLocalReadName(path: string): OwnerLocalReadName {
  return path === "/pos/check-in" ? "owner.check-in" : path === "/pos/ticket" ? "owner.tickets" : path === "/pos/book" ? "owner.bookings" : path === "/pos/report" ? "owner.reports" : "owner.workspace";
}
export function ownerLocalReadArgs(href: string): Record<string, unknown> {
  const normalized = ownerLocalHref(href); if (!normalized) throw new Error("Unsupported workspace page");
  return { query: new URL(normalized, "https://reylumi.com").searchParams.toString() };
}
