import type { OwnerInstallation, OwnerMarketplace, OwnerVersion } from "@/types/market-platform-owner";
import { publicScopeLabels } from "./published-contract";
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const scopes = (value: unknown): value is string[] => Array.isArray(value) && value.every(scope => typeof scope === "string" && Object.hasOwn(publicScopeLabels, scope)) && new Set(value).size === value.length;
const https = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
};
function version(value: unknown): OwnerVersion | null {
  if (!object(value) || !uuid(value.id) || !uuid(value.app_id) || typeof value.version !== "string" || !/^\d+\.\d+\.\d+$/.test(value.version) || value.version.length > 100
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.canonical !== "string" || typeof value.publisher !== "string"
    || typeof value.entitled !== "boolean" || typeof value.connectionReady !== "boolean" || !object(value.manifest)) return null;
  const m = value.manifest, price = m.price;
  if (m.schemaVersion !== 1 || m.type !== "hosted-app" || m.version !== value.version || typeof m.name !== "string" || typeof m.description !== "string"
    || !https(m.launchUrl) || !https(m.privacyUrl) || !https(m.supportUrl) || !scopes(m.scopes) || !object(price) || price.currency !== "usd"
    || !Number.isSafeInteger(price.amountCents) || (price.amountCents as number) < 0 || price.billing !== "one-time-version") return null;
  return { id: value.id, app_id: value.app_id, version: value.version, sha256: value.sha256, canonical: value.canonical, publisher: value.publisher,
    entitled: value.entitled, connectionReady: value.connectionReady,
    manifest: { schemaVersion: 1, type: "hosted-app", version: value.version, name: m.name, description: m.description, launchUrl: m.launchUrl, privacyUrl: m.privacyUrl, supportUrl: m.supportUrl, scopes: [...m.scopes], price: { currency: "usd", amountCents: price.amountCents as number, billing: "one-time-version" } } };
}
function installation(value: unknown): OwnerInstallation | null {
  if (!object(value) || !uuid(value.id) || !uuid(value.appId) || !uuid(value.versionId) || (value.state !== "active" && value.state !== "revoked")
    || !scopes(value.scopes) || typeof value.usable !== "boolean" || typeof value.connectionReady !== "boolean") return null;
  return { id: value.id, appId: value.appId, versionId: value.versionId, state: value.state as OwnerInstallation["state"], scopes: [...value.scopes], usable: value.usable, connectionReady: value.connectionReady };
}
/** A successful HTTP read is not proof of a valid, same-salon workspace. Never fabricate empty ready data. */
export function readOwnerMarketplace(value: unknown, expectedSalon: string): OwnerMarketplace | null {
  if (!object(value) || !uuid(expectedSalon) || value.salonId !== expectedSalon || typeof value.salonName !== "string"
    || typeof value.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value.observedAt) || !Number.isFinite(Date.parse(value.observedAt))
    || typeof value.testPaymentsEnabled !== "boolean" || !Array.isArray(value.catalog) || !Array.isArray(value.installations)) return null;
  const catalog = value.catalog.map(version), installations = value.installations.map(installation);
  if (catalog.some(row => row === null) || installations.some(row => row === null)) return null;
  if (new Set(catalog.map(row => row!.id)).size !== catalog.length || new Set(installations.map(row => row!.id)).size !== installations.length) return null;
  return { salonId: expectedSalon, salonName: value.salonName, observedAt: value.observedAt, testPaymentsEnabled: value.testPaymentsEnabled, catalog: catalog as OwnerVersion[], installations: installations as OwnerInstallation[] };
}
