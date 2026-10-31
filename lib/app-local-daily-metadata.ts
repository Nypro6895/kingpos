import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { Location } from "@/types/location";
import type { getCurrentSalonPosTicketOptions } from "./pos-tickets";
import type { taxCompanySalons, taxCompanyReport } from "./tax-company";

export const APP_LOCAL_DAILY_READS = {
  "owner.ticket-detail": { argumentKeys: ["ticketId"], access: "scoped", retention: "scoped" },
  // A tax connection has its own revocation policy, independent of the workspace lease.
  "customer.tax-salons": { argumentKeys: [], access: "scoped", retention: "none" },
  "customer.tax-report": { argumentKeys: ["salonId", "run", "period"], access: "scoped", retention: "none" },
} as const;
export const APP_LOCAL_DAILY_ROUTES = ["/pos-tickets/:ticketId", "/pos/ticket/:ticketId", "/tax-company", "/tax-company/:salonId", "/tax-company/install"] as const;
export type AppLocalTicketDetailData = {
  businessTimezone?: string;
  ticket: PosTicketWithRelations;
  salon: Location;
  canManageTickets: boolean;
  canVoidTickets: boolean;
  options: Pick<Awaited<ReturnType<typeof getCurrentSalonPosTicketOptions>>, "services" | "staff">;
};
export type AppLocalTaxSalonsData = Awaited<ReturnType<typeof taxCompanySalons>>;
export type AppLocalTaxReportData = Awaited<ReturnType<typeof taxCompanyReport>>;
