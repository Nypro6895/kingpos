import type { AppLocalContext } from "./app-local-host";
import { isExperienceOfflineGrant } from "./experience-offline-policy";
import type { AppLocalContextReason } from "./app-local-context-recovery";
import { isAppLocalStaffOnlineAccess } from "./app-local-staff-online-access";

/** Presentation families mirror the registered workspace pages. Per-feature
 * permissions and all writes remain authoritative in their original handlers. */
export function appLocalPageAuthority(path: string): "owner" | "staff" | "salon" | null {
  const pathname = path.split("?")[0].replace(/\/$/, "") || "/";
  if (/^\/staff\/(?:my-work|workday|appointments)$/.test(pathname)) return "staff";
  // Staff's Post tab uses the same original salon-workspace profile guard.
  // Its client-transformations subpage remains management-only below.
  if (pathname === "/salon-profile") return "salon";
  if (pathname === "/pos/customer-display" || /^\/pos\/portable(?:\/|$)/.test(pathname)) return null;
  return /^\/(?:staff(?:\/today)?|pos(?:\/.*)?|pos-tickets(?:\/.*)?|customers(?:\/.*)?|payroll(?:\/.*)?|services|salon-profile(?:\/.*)?|salon-settings|bookings|reports)$/.test(pathname) ? "owner" : null;
}

/** An online transport success is not page admission after an explicit denial.
 * A temporary display-lease outage may keep the freshly verified page online,
 * provided its existing workspace capability matches this page family. */
export function appLocalPageAdmissionReason(value: AppLocalContext, path: string, options: { generation?: string; online: boolean; now?: number }): AppLocalContextReason | null {
  if (!value || value.schemaVersion !== 1 || !value.context) return "schema";
  if (value.grantStatus === 401) return "sign-in";
  if (value.grantStatus === 403) return "permission-denied";
  if (value.grantStatus === 409) return "workspace-changed";
  if (value.offlineState === "unconfirmed") return "unconfirmed";
  if (value.offlineState === "online-only" && !isAppLocalStaffOnlineAccess(value, { path, online: options.online, now: options.now })) return "unconfirmed";
  const now = options.now ?? Date.now();
  const leased = Boolean(value.grant && isExperienceOfflineGrant(value.grant, { scope: value.context.scope, ...(options.generation ? { generation: options.generation } : {}) }, now));
  const online = !value.offline && options.online && Number.isFinite(value.onlineValidatedAt) && now - value.onlineValidatedAt < 30_000;
  if (!leased && !online) {
    if (value.grant && options.generation && value.grant.generation !== options.generation) return "generation";
    if (value.grant && Number.isFinite(value.grant.expiresAt) && value.grant.expiresAt <= now) return "lease-expired";
    if (value.grant) return "lease-invalid";
    return value.grantStatus === 503 ? "lease-unavailable" : "online-stale";
  }
  const authority = appLocalPageAuthority(path);
  if (!authority) return null;
  if (!value.context.authenticated || !value.context.viewerId) return "sign-in";
  const permitted = authority === "salon" ? Boolean(value.context.salonId) && (leased && ["owner", "staff"].includes(value.grant?.kind ?? "")
    || (leased || online) && Boolean(value.access?.ownerWorkspace || value.access?.staffWorkspace))
    : leased && value.grant?.kind === authority || online && Boolean(authority === "owner" ? value.access?.ownerWorkspace : value.access?.staffWorkspace);
  return permitted ? null : "page-authority";
}

export function canAdmitAppLocalPage(value: AppLocalContext, path: string, options: { generation?: string; online: boolean; now?: number }): boolean {
  return appLocalPageAdmissionReason(value, path, options) === null;
}
