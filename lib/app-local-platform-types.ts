import type { ComponentProps } from "react";
import type { SettingsHubClient } from "@/app/settings/settings-hub-client";
import type { CustomerBookingSummary, CustomerBookingListScope } from "./customer-bookings";
import type { CustomerActivity, CustomerActivityReceipt } from "./customer-activity";
import type { AccountFollowingPage, AccountSavedPost } from "./account-social";
import type { resolveReferenceFavorites } from "./explore-reference-favorites";
import type { MyPlaceClient } from "@/app/my-place/my-place-client";
import type { ServicesManager } from "@/app/services/services-manager";
import type { SupportCaseItem, SupportConversation } from "./support-cases";
import type { RoleNavigationKind } from "@/app/role-navigation";
import type { CatalogPartition, ServicesCatalog } from "./services-catalog-cache";

export type AppLocalSettingsData = Pick<ComponentProps<typeof SettingsHubClient>, "user" | "createdAtLabel" | "index">;
export type AppLocalBookingsData = { tab: CustomerBookingListScope; bookings: CustomerBookingSummary[]; details: string | null; historyRows: CustomerActivity[] | null };
export type AppLocalReceiptData = { receipt: CustomerActivityReceipt };
export type AppLocalSavedPostsData = { filter: string; page: number; query: string; posts: AccountSavedPost[]; hasNext: boolean };
export type AppLocalFollowingData = AccountFollowingPage;
export type AppLocalFavoritesData = {
  salons: Array<{ salon_id: string; salon_name: string; saved: boolean; loved: boolean; hidden: boolean }>;
  hasMoreSalons: boolean; salonOffset: number;
  favorites: Awaited<ReturnType<typeof resolveReferenceFavorites>>["items"]; next: string | null;
};
export type AppLocalStaffIdentityData = { resourceScope: string; staffId: string; salonId: string };
export type AppLocalMyPlaceData = Omit<ComponentProps<typeof MyPlaceClient>, "error">;
export type AppLocalServicesData = Pick<ComponentProps<typeof ServicesManager>, "data">;
export type AppLocalServicesCatalogAdmissionData = { schemaVersion: 1; partition: CatalogPartition };
export type AppLocalServicesCatalogData = ServicesCatalog;
export type AppLocalMoreData = { roleKind: RoleNavigationKind; campaignInstalled: boolean };
export type AppLocalSupportData = { cases: SupportCaseItem[] };
export type AppLocalSupportCaseData = { conversation: SupportConversation };

/** Pinned transport metadata, never a source of authorization. */
export const APP_LOCAL_PLATFORM_READS = {
  "page.market": { argumentKeys: [], retention: "scoped" },
  "page.market-deposit": { argumentKeys: [], retention: "scoped" },
  "page.settings": { argumentKeys: [], retention: "scoped" },
  "settings.personal": { argumentKeys: ["kind"], retention: "none" },
  "settings.direct": { argumentKeys: ["kind", "salonId"], retention: "none" },
  "page.owner-today": { argumentKeys: ["date", "phase"], retention: "scoped" },
  "page.customer-bookings": { argumentKeys: ["tab", "details", "bookingId"], retention: "scoped" },
  "page.customer-receipt": { argumentKeys: ["ticketId"], retention: "scoped" },
  "page.staff-identity": { argumentKeys: ["view"], retention: "none" },
  "page.my-place": { argumentKeys: [], retention: "scoped" },
  "page.services": { argumentKeys: [], retention: "scoped" },
  "page.services-catalog-admission": { argumentKeys: [], retention: "none" },
  "page.services-catalog": { argumentKeys: [], retention: "none" },
  "page.more": { argumentKeys: [], retention: "scoped" },
  "page.support": { argumentKeys: [], retention: "scoped" },
  // The original RPC may expose an admin view; workspace leases do not attest platform-admin authority.
  "page.support-case": { argumentKeys: ["caseId"], retention: "none" },
} as const;

export const ROLE_READS = {
  "http.staff.creation": { method: "GET", path: "/api/staff/create-appointment", argumentKeys: ["salonId", "catalog"], access: "scoped", cacheable: false },
  "http.notifications.preferences": { method: "GET", path: "/api/notifications/preferences", argumentKeys: [], access: "scoped", cacheable: false },
  "http.owner.closing": { method: "GET", path: "/api/pos/closing", argumentKeys: ["mode", "salonId", "expectedScope", "date", "requestId"], access: "scoped", cacheable: false },
  "http.owner.closing-history": { method: "GET", path: "/api/pos/closing/history", argumentKeys: ["salonId", "date"], access: "scoped", cacheable: false },
} as const;
export const ROLE_COMMANDS = {
  "http.staff.create-appointment": { method: "POST", path: "/api/staff/create-appointment", argumentKeys: ["input"] },
  "http.staff.report-no-show": { method: "POST", path: "/api/staff/report-no-show", argumentKeys: ["input"] },
  "http.staff.confirm-booking": { method: "POST", path: "/api/staff/confirm-booking", argumentKeys: ["input"] },
  "http.staff.booking-preferences": { method: "POST", path: "/api/staff/booking-preferences", argumentKeys: ["input"] },
  "http.notifications.preferences": { method: "POST", path: "/api/notifications/preferences", argumentKeys: ["input"] },
  "http.owner.closing": { method: "POST", path: "/api/pos/closing", argumentKeys: ["input"] },
} as const;
