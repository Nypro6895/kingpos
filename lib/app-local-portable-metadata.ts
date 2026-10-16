import type { AppLocalContext } from "./app-local-host";
import type { PortablePosCapability } from "./pos-portable-capabilities";
import type { getPortablePosDeskData, getPortableCheckInData, getPortableBookData, getPortableTicketData, getPortableReportData } from "@/app/pos/portable/actions";

export type AppLocalPortableDescriptor = {
  scope: string; keyId: string; salonId: string; salonName: string; salonLogoUrl: string | null; timeZone: string;
  capabilities: PortablePosCapability[]; touchKeyboardEnabled: boolean; preparedAt: number; offlineEnabled: boolean; devicePrepared: boolean;
};
export type AppLocalPortableContext = AppLocalContext & { portable: AppLocalPortableDescriptor };
export const APP_LOCAL_PORTABLE_ROUTES = ["/pos/portable", "/pos/portable/check-in", "/pos/portable/book", "/pos/portable/ticket", "/pos/portable/today", "/pos/portable/report"] as const;
export const APP_LOCAL_PORTABLE_READS = {
  "portable.workspace": { argumentKeys: [], access: "scoped", retention: "scoped", capability: "portable.pos.use" },
  "portable.check-in": { argumentKeys: [], access: "scoped", retention: "scoped", capability: "portable.checkin.use" },
  "portable.book": { argumentKeys: ["date"], access: "scoped", retention: "scoped", capability: "portable.book.view" },
  "portable.ticket": { argumentKeys: ["date"], access: "scoped", retention: "scoped", capability: "portable.today.view" },
  "portable.report": { argumentKeys: ["date"], access: "scoped", retention: "scoped", capability: "portable.report.view" },
} as const;
export type AppLocalPortableWorkspaceData = Awaited<ReturnType<typeof getPortablePosDeskData>>;
export type AppLocalPortableCheckInData = Awaited<ReturnType<typeof getPortableCheckInData>>;
export type AppLocalPortableBookData = Awaited<ReturnType<typeof getPortableBookData>>;
export type AppLocalPortableTicketData = Awaited<ReturnType<typeof getPortableTicketData>>;
export type AppLocalPortableReportData = Awaited<ReturnType<typeof getPortableReportData>>;
