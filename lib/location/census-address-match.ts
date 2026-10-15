import { normalizePublicSalonAddress } from "@/lib/location/address";
import type { PublicSalonAddressInput } from "@/types/location";

export type CensusAddressMatch = {
  latitude: number; longitude: number; matchedAddress: string;
  tigerLineId: string; side: "L" | "R"; provider: "us_census";
  accuracy: "address_range_interpolated"; fingerprint: string;
};
export type CensusAddressResult = { match: CensusAddressMatch | null; reason: string | null };

const ALIASES: Record<string, string> = {
  street: "st", avenue: "ave", boulevard: "blvd", road: "rd", drive: "dr",
  lane: "ln", court: "ct", circle: "cir", highway: "hwy", parkway: "pkwy",
  terrace: "ter", place: "pl", trail: "trl", north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function streetTokens(value: string) {
  return value.toLowerCase().replace(/[.,]/g, " ").trim().split(/\s+/).map(token => ALIASES[token] ?? token).join(" ");
}
function cityKey(value: string) { return value.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim(); }

/** Suite is preserved in the CAS fingerprint; Census identifies the building's street range. */
export function censusStreetAddress(input: PublicSalonAddressInput): string | null {
  const address = normalizePublicSalonAddress(input);
  if (!address.isComplete || address.country !== "US" || !/^[A-Z]{2}$/.test(address.state ?? "")
    || !/^\d{5}(?:-\d{4})?$/.test(address.postalCode ?? "")) return null;
  const line = input.addressLine1?.trim().replace(/\s+/g, " ") ?? "";
  // Only conventional integer street numbers pass automatic write quality checks.
  // Grid numbers, fractions, PO boxes and hyphenated ranges need separate review.
  const street = line.replace(/\s+(?:suite|ste|unit|apt|apartment)\.?\s+[\w-]+$/i, "")
    .replace(/\s+#\s*[\w-]+$/, "").trim();
  return /^\d+\s+[A-Za-z0-9][A-Za-z0-9 .'-]+$/.test(street) ? street : null;
}

export function parseCensusAddressMatch(input: PublicSalonAddressInput, payload: unknown): CensusAddressResult {
  const expected = normalizePublicSalonAddress(input);
  const street = censusStreetAddress(input);
  if (!street || !expected.fingerprint) return { match: null, reason: "unsupported_address" };
  const matches = record(record(payload).result).addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1) return { match: null, reason: Array.isArray(matches) && matches.length === 0 ? "no_match" : "ambiguous_match" };
  const row = record(matches[0]); const parts = record(row.addressComponents);
  const coords = record(row.coordinates); const tiger = record(row.tigerLine);
  if (typeof coords.x !== "number" || typeof coords.y !== "number" || !Number.isFinite(coords.x) || !Number.isFinite(coords.y)
    || coords.x < -180 || coords.x > 180 || coords.y < -90 || coords.y > 90 || (coords.x === 0 && coords.y === 0)) return { match: null, reason: "invalid_coordinates" };
  if (text(parts.state).toUpperCase() !== expected.state || text(parts.zip).slice(0, 5) !== expected.postalCode?.slice(0, 5)
    || cityKey(text(parts.city)) !== cityKey(expected.city ?? "")) return { match: null, reason: "region_mismatch" };
  const number = Number(street.match(/^\d+/)?.[0]);
  const from = text(parts.fromAddress); const to = text(parts.toAddress);
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to) || !Number.isSafeInteger(number)
    || number < Math.min(Number(from), Number(to)) || number > Math.max(Number(from), Number(to))
    || (Number(from) % 2 === Number(to) % 2 && number % 2 !== Number(from) % 2)) return { match: null, reason: "street_number_mismatch" };
  const providerStreet = [parts.preQualifier, parts.preDirection, parts.preType, parts.streetName, parts.suffixType, parts.suffixDirection, parts.suffixQualifier].map(text).filter(Boolean).join(" ");
  if (streetTokens(street.replace(/^\d+\s+/, "")) !== streetTokens(providerStreet)) return { match: null, reason: "street_name_mismatch" };
  const matchedAddress = text(row.matchedAddress); const tigerLineId = text(tiger.tigerLineId); const side = text(tiger.side);
  if (!matchedAddress || matchedAddress.length > 400 || !/^\d{1,20}$/.test(tigerLineId) || (side !== "L" && side !== "R")) return { match: null, reason: "missing_provenance" };
  // Components describe a range; the returned match must still identify this number.
  if (Number(matchedAddress.match(/^\d+/)?.[0]) !== number) return { match: null, reason: "street_number_mismatch" };
  return { match: {
    latitude: coords.y, longitude: coords.x, matchedAddress, tigerLineId, side,
    provider: "us_census", accuracy: "address_range_interpolated", fingerprint: expected.fingerprint,
  }, reason: null };
}
