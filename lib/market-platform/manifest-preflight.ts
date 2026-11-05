import type { Manifest } from "./server";
import { publicScopeLabels } from "./published-contract";

export const manifestLimitBytes = 16384;
const fields = ["schemaVersion", "type", "version", "name", "description", "launchUrl", "privacyUrl", "supportUrl", "scopes", "price"];
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).length === allowed.length && allowed.every(k => Object.hasOwn(v, k));
const plain = (v: unknown): v is string => typeof v === "string" && !v.startsWith(" ") && !v.endsWith(" ") && !Array.from(v).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
// Mirrors the current SQL URL syntax only. This performs no network request or ownership verification.
export const isDeclaredPublicHttpsUrl = (v: unknown): v is string => typeof v === "string" && v.length <= 2048 && /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}(\/[A-Za-z0-9._~!$&()*+,;=:@%/-]*)?$/.test(v) && !/^https:\/\/[^/]*\.(localhost|local|internal|test|invalid|example)(\/|$)/.test(v);
export type ManifestPreflight = { ok: false; errors: string[] } | { ok: true; manifest: Manifest };
export function inspectManifest(text: string): ManifestPreflight {
  if (new TextEncoder().encode(text).length < 1 || new TextEncoder().encode(text).length > manifestLimitBytes) return { ok: false, errors: ["Choose a JSON manifest of at most 16 KiB."] };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, errors: ["The uploaded file must contain valid JSON."] }; }
  if (!object(value) || !keys(value, fields) || value.schemaVersion !== 1 || value.type !== "hosted-app") return { ok: false, errors: ["Use exactly the supported hosted-app manifest fields and schema version 1."] };
  const errors: string[] = [];
  if (!["version", "name", "description", "launchUrl", "privacyUrl", "supportUrl"].every(k => plain(value[k]))) errors.push("Manifest fields must be plain trimmed text.");
  if (typeof value.version !== "string" || value.version.length > 64 || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value.version)) errors.push("Use a stable semantic version, for example 1.2.0.");
  if (typeof value.name !== "string" || Array.from(value.name).length < 2 || Array.from(value.name).length > 100 || typeof value.description !== "string" || Array.from(value.description).length < 10 || Array.from(value.description).length > 2000) errors.push("Use a name of 2–100 characters and a description of 10–2000 characters.");
  if (![value.launchUrl, value.privacyUrl, value.supportUrl].every(isDeclaredPublicHttpsUrl)) errors.push("Use public HTTPS URLs without credentials, ports, queries or fragments.");
  if (!Array.isArray(value.scopes) || value.scopes.length > 5 || !value.scopes.every(s => typeof s === "string" && Object.hasOwn(publicScopeLabels, s)) || new Set(value.scopes).size !== value.scopes.length) errors.push("Choose unique supported read permissions only.");
  const price = value.price;
  if (!object(price) || !keys(price, ["currency", "amountCents", "billing"]) || price.currency !== "usd" || price.billing !== "one-time-version" || !Number.isSafeInteger(price.amountCents) || (price.amountCents as number) < 0 || (price.amountCents as number) > 999999 || ((price.amountCents as number) > 0 && (price.amountCents as number) < 50)) errors.push("Use USD integer cents: free, or 50–999999 cents, billed once for this version.");
  return errors.length ? { ok: false, errors } : { ok: true, manifest: value as Manifest };
}

/** Declaration diff only: does not approve, verify domains, scan code or change runtime access. */
export function declaredManifestChanges(next: Manifest, previous?: Manifest) {
  const urls = ["launchUrl", "privacyUrl", "supportUrl"] as const;
  return {
    comparedVersion: previous?.version ?? null,
    added: next.scopes.filter(s => !previous?.scopes.includes(s)),
    removed: previous?.scopes.filter(s => !next.scopes.includes(s)) ?? [],
    urls: urls.filter(k => !previous || next[k] !== previous[k]).map(field => ({ field, previous: previous?.[field] ?? null, next: next[field], originChanged: previous ? new URL(next[field]).origin !== new URL(previous[field]).origin : null })),
    priceChanged: previous ? next.price.amountCents !== previous.price.amountCents : null,
    listingChanged: previous ? next.name !== previous.name || next.description !== previous.description : null,
    versionAlreadyUsed: previous?.version === next.version,
  };
}
