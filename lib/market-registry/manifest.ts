import type { MarketRegistryManifest } from "@/types/market-registry";

export class MarketRegistryInputError extends Error {}

const keys = ["appVersion", "description", "displayName", "manifestSchemaVersion", "requestedCapabilities"];
const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function textField(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new MarketRegistryInputError(`${name} must be text.`);
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code >= 0xd800 && code <= 0xdfff) throw new MarketRegistryInputError(`${name} contains invalid Unicode.`);
  }
  const result = value.normalize("NFC").trim();
  if (!result || [...result].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) {
    throw new MarketRegistryInputError(`${name} must contain between 1 and ${max} characters without control characters.`);
  }
  return result;
}

/** UI feedback only. The database independently validates and freezes the manifest.
 * Hashes are calculated only by the database's versioned canonicalizer; JSON.stringify
 * is intentionally not an alternative signature or authorization representation. */
export function validateMarketRegistryManifest(input: unknown): MarketRegistryManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new MarketRegistryInputError("App details must be an object.");
  const value = input as Record<string, unknown>;
  if (Object.keys(value).sort().join("|") !== keys.join("|")) throw new MarketRegistryInputError("App details contain missing or unsupported fields.");
  if (value.manifestSchemaVersion !== 1 || !Array.isArray(value.requestedCapabilities) || value.requestedCapabilities.length !== 0) {
    throw new MarketRegistryInputError("This private review accepts metadata only, with no requested capabilities.");
  }
  const appVersion = textField(value.appVersion, "App version", 64);
  if (!versionPattern.test(appVersion)) throw new MarketRegistryInputError("Use a version such as 1.0.0 or 1.0.0-beta.1.");
  const manifest: MarketRegistryManifest = {
    manifestSchemaVersion: 1,
    appVersion,
    displayName: textField(value.displayName, "App name", 100),
    description: textField(value.description, "Description", 2000),
    requestedCapabilities: [],
  };
  if (/[\r\n\t]/.test(manifest.displayName)) throw new MarketRegistryInputError("App name must be on one line.");
  if (new TextEncoder().encode(JSON.stringify(manifest)).length > 16384) throw new MarketRegistryInputError("App details are too large.");
  return manifest;
}

export function registryId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new MarketRegistryInputError("The selected app or submission is invalid. Reload and try again.");
  }
  return value;
}

export function registryVersion(value: unknown, allowZero = false): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,8})$/.test(value)) throw new MarketRegistryInputError("The draft version is invalid. Reload and try again.");
  const version = Number(value);
  if (version < (allowZero ? 0 : 1)) throw new MarketRegistryInputError("The draft version is invalid. Reload and try again.");
  return version;
}

export function registryHash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new MarketRegistryInputError("The submission has changed. Reload and try again.");
  return value;
}

export function registryReason(value: unknown): string {
  const reason = textField(value, "Review reason", 1000);
  if ([...reason].length < 3) throw new MarketRegistryInputError("Review reason must contain at least 3 characters.");
  return reason;
}
