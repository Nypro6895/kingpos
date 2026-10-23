/** A read/display lease; never an authorization credential accepted by a mutation. */
import { isTrustedStaffOfflineBinding, type StaffOfflineBinding } from "./staff-offline-binding";
export const EXPERIENCE_OFFLINE_MAX_AGE = 24 * 60 * 60 * 1000;
export type ExperienceOfflineGrant = {
  version: 1; scope: string; scopes: string[]; viewerId: string | null;
  workspaceId: string; salonId: string | null; grantRevision: string;
  generation: string; issuedAt: number; expiresAt: number; path: string;
  kind: "owner" | "staff" | "customer" | "portable" | "public";
  localCommands?: boolean;
  staffBinding?: StaffOfflineBinding;
};

const SECRET = /^(?:token|access_token|refresh_token|code|secret|signature|session|session_id|password|client_secret|payment|bookingStripe|checkout|payment_intent|payment_intent_client_secret|setup_intent|setup_intent_client_secret|redirect_status|key|invite|next|return_to)$/i;
/** Explicit read-workspace allowlist: credentials, payments, admin and edit URLs stay network-only. */
export function getExperienceOfflinePath(href: string, origin = "https://reylumi.invalid"): string | null {
  try {
    if (!href || href.length > 2048 || /\\|%2f|%5c|%00/i.test(href)) return null;
    const url = new URL(href, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password || url.hash) return null;
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (!/^(?:\/(?:pos(?:\/(?:ticket(?:\/[\w-]+)?|book|check-in|report|settings))?|pos\/portable(?:\/(?:ticket|book|check-in|report|today))?|staff\/(?:today|my-work|workday|appointments)|payroll|customers(?:\/[\w-]+)?|activity(?:\/receipts\/[\w-]+)?|my-bookings(?:\/[\w-]+)?|my-place|more(?:\/(?:saved-post|following))?|beauty|explore(?:\/favorites)?|market|notifications))$/.test(path)) return null;
    if (/(?:^|\/)(?:new|edit|create|delete|checkout|payment|setup)(?:\/|$)/.test(path)) return null;
    for (const [key, value] of url.searchParams) if (SECRET.test(key) || value.length > 512 || /(?:token|secret|password)=/i.test(value)) return null;
    if (path === "/market" && [...url.searchParams.keys()].some(key => !["q", "category"].includes(key))) return null;
    url.searchParams.sort();
    return path + url.search;
  } catch { return null; }
}

export function isExperienceOfflineGrant(value: unknown, expected?: { scope?: string; generation?: string; path?: string }, now = Date.now()): value is ExperienceOfflineGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as ExperienceOfflineGrant;
  if ((/^\/staff\/(?:my-work|workday|appointments)(?:\?|$)/.test(grant.path ?? "") || grant.kind === "staff")
    && (grant.kind !== "staff" || !grant.viewerId || !grant.salonId || !isTrustedStaffOfflineBinding(grant.staffBinding, { viewerId: grant.viewerId, salonId: grant.salonId }))) return false;
  return grant.version === 1 && typeof grant.scope === "string" && grant.scope.length > 0 && grant.scope.length <= 8192
    && Array.isArray(grant.scopes) && grant.scopes.length > 0 && grant.scopes.length <= 4 && grant.scopes.every(scope => typeof scope === "string" && scope.length > 0 && scope.length <= 8192) && grant.scopes.includes(grant.scope)
    && (grant.viewerId === null || typeof grant.viewerId === "string") && typeof grant.workspaceId === "string"
    && (grant.salonId === null || typeof grant.salonId === "string") && typeof grant.grantRevision === "string"
    && typeof grant.generation === "string" && /^[\w-]{16,100}$/.test(grant.generation)
    && ["owner", "staff", "customer", "portable", "public"].includes(grant.kind)
    && Number.isFinite(grant.issuedAt) && Number.isFinite(grant.expiresAt) && grant.issuedAt <= now + 60_000
    && grant.expiresAt > now && grant.expiresAt > grant.issuedAt && grant.expiresAt - grant.issuedAt <= EXPERIENCE_OFFLINE_MAX_AGE
    && getExperienceOfflinePath(grant.path) === grant.path
    && (!expected?.scope || grant.scopes.includes(expected.scope))
    && (!expected?.generation || grant.generation === expected.generation)
    && (!expected?.path || grant.path === expected.path);
}
