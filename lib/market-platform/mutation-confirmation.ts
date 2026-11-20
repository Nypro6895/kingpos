import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { OwnerMarketplace } from "@/types/market-platform-owner";
import { isDeclaredPublicHttpsUrl } from "./manifest-preflight";

export const developerUncertain = "The request may have completed, but its confirmation was invalid. Reload this workspace before retrying.";
export const ownerUncertain = "Your request may have completed, but its current state could not be confirmed. Reload Market before retrying.";
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const responseUuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const date = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));

/** Acknowledgement checks only. SQL still owns actor, entitlement, consent and immutable review authority. */
export function developerMutationConfirmed(operation: string, value: unknown, args: Record<string, unknown>): boolean {
  if (["profile_save", "moderate", "rotate_client"].includes(operation)) return value === true;
  if (operation === "register") return responseUuid(value);
  if (!object(value)) return false;
  if (operation === "review" || operation === "review_exact") return (operation !== "review_exact" || value.publisher_name === args.p_publisher_name) && value.version_id === args.p_version && value.decision === args.p_decision && typeof args.p_reason === "string" && value.reason === args.p_reason.replace(/^ +| +$/g, "") && responseUuid(value.actor_id) && date(value.created_at);
  if (operation === "sandbox") return responseUuid(value.id) && value.versionId === args.p_version && value.synthetic === true && date(value.expiresAt);
  if (operation !== "submit" || !responseUuid(value.id) || !responseUuid(value.app_id) || (args.p_app !== null && value.app_id !== args.p_app)
    || !object(args.p_manifest) || value.version !== args.p_manifest.version
    || typeof value.canonical !== "string" || value.canonical.length > 32768 || typeof value.sha256 !== "string") return false;
  try { const expected = JSON.parse(JSON.stringify(args.p_manifest)); return isDeepStrictEqual(value.manifest, expected) && isDeepStrictEqual(JSON.parse(value.canonical), expected) && createHash("sha256").update(value.canonical).digest("hex") === value.sha256; }
  catch { return false; }
}

export function installedAcknowledgement(value: unknown, salon: string, version: string, scopes: unknown) {
  if (!object(value) || !responseUuid(value.id) || !responseUuid(value.app_id) || !responseUuid(value.consented_by)
    || value.salon_id !== salon || value.version_id !== version || value.state !== "active" || !Number.isSafeInteger(value.generation) || (value.generation as number) < 1 || !isDeepStrictEqual(value.scopes, scopes)) return null;
  return { id: value.id, appId: value.app_id, versionId: version, scopes };
}
export function installationObserved(market: OwnerMarketplace, expected: NonNullable<ReturnType<typeof installedAcknowledgement>>) {
  return market.installations.some(i => i.id === expected.id && i.appId === expected.appId && i.versionId === expected.versionId && i.state === "active" && isDeepStrictEqual(i.scopes, expected.scopes));
}
export function revokedObserved(market: OwnerMarketplace, installation: string) { return market.installations.some(i => i.id === installation && i.state === "revoked"); }
export function connectionDetails(value: unknown, installation: string) {
  if (!object(value) || value.installationId !== installation || !responseUuid(value.clientId) || !responseUuid(value.versionId) || !isDeclaredPublicHttpsUrl(value.launchUrl)) return null;
  return { launchUrl: value.launchUrl, clientId: value.clientId, installationId: installation };
}
