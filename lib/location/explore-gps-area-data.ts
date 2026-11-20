import type { ExploreGpsArea, ExploreGpsPoint } from "@/types/explore-gps-area";

const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA",
  Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
const STATE_CODES = new Set(Object.values(US_STATES));
const STATE_NAMES = new Map(Object.entries(US_STATES).map(([name, code]) => [name.toLowerCase(), code]));

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function safeName(value: unknown): string | null {
  const name = text(value);
  return name && name.length <= 100 && !/[\x00-\x1f<>]/.test(name) ? name : null;
}
function stateCode(value: unknown): string | null {
  const candidate = text(value).replace(/^US-/i, "");
  return STATE_CODES.has(candidate.toUpperCase()) ? candidate.toUpperCase()
    : STATE_NAMES.get(candidate.toLowerCase()) ?? null;
}
function unique(values: Array<string | null>): string | null {
  const selected = [...new Set(values.filter((value): value is string => Boolean(value)))];
  return selected.length === 1 ? selected[0] : null;
}

export function normalizeExploreGpsPoint(value: unknown): ExploreGpsPoint | null {
  const input = record(value);
  if (typeof input.latitude !== "number" || typeof input.longitude !== "number"
    || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)
    || input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180) return null;
  return { latitude: input.latitude, longitude: input.longitude };
}

/** Census returns polygon membership. Its centroids are deliberately ignored. */
export function parseCensusGpsArea(payload: unknown): ExploreGpsArea | null {
  const geographies = record(record(record(payload).result).geographies);
  const states = Array.isArray(geographies.States) ? geographies.States : [];
  if (states.length !== 1) return null;
  const stateRow = record(states[0]);
  const state = stateCode(stateRow.STUSAB) ?? stateCode(stateRow.NAME);
  const stateFips = text(stateRow.STATE);
  if (!state || !/^\d{2}$/.test(stateFips)) return null;
  let city: string | null = null;
  for (const layer of ["Incorporated Places", "Census Designated Places"]) {
    const rows = Array.isArray(geographies[layer]) ? geographies[layer] : [];
    const relevant = rows.map(record).filter(row => text(row.STATE) === stateFips);
    if (relevant.length > 1) return null;
    if (relevant.length === 1) {
      city = safeName(relevant[0].BASENAME);
      if (!city) return null;
      break;
    }
  }
  // Only accept a single containing ZIP polygon. Centroids and nearest salons
  // never supply a ZIP, and an ambiguous boundary remains city/state only.
  const zipRows = geographies["2020 Census ZIP Code Tabulation Areas"];
  const postalCode = Array.isArray(zipRows) && zipRows.length === 1
    && /^\d{5}$/.test(text(record(zipRows[0]).ZCTA5)) ? text(record(zipRows[0]).ZCTA5) : null;
  return {
    label: city ? `${city}, ${state}` : postalCode ?? state, city, state, postalCode,
    country: "US", source: "gps", provider: "us_census", precision: city ? "city" : postalCode ? "postal" : "state",
    attribution: { label: "U.S. Census Bureau", url: "https://www.census.gov/" },
  };
}

/** Reverse API defaults select the containing feature per layer, not N nearest features. */
export function parseMapTilerGpsArea(payload: unknown): ExploreGpsArea | null {
  const features = record(payload).features;
  if (!Array.isArray(features) || features.length > 32) return null;
  const nodes: Record<string, unknown>[] = [];
  for (const value of features) {
    const feature = record(value);
    nodes.push(feature);
    if (Array.isArray(feature.context) && feature.context.length <= 32) nodes.push(...feature.context.map(record));
  }
  const kind = (node: Record<string, unknown>) => text(node.id).split(".")[0]
    || (Array.isArray(node.place_type) ? text(node.place_type[0]) : "");
  const countries = nodes.map(node => text(record(node.properties).country_code) || text(node.country_code)
    || (kind(node) === "country" ? text(node.short_code) : "")).filter(Boolean).map(value => value.toUpperCase());
  if (!countries.includes("US") || countries.some(value => value !== "US")) return null;
  const state = unique(nodes.filter(node => kind(node) === "region").map(node =>
    stateCode(node.short_code) ?? stateCode(record(node.properties).short_code) ?? stateCode(node.text)));
  if (!state) return null;
  const cityNodes = nodes.filter(node => ["municipality", "place"].includes(kind(node)));
  const cityNames = [...new Set(cityNodes.map(node => safeName(node.text)).filter(Boolean))];
  if (cityNames.length > 1) return null;
  const city = cityNames[0] ?? null;
  const postalCode = unique(nodes.filter(node => ["postal_code", "postcode"].includes(kind(node)))
    .map(node => /^\d{5}$/.test(text(node.text)) ? text(node.text) : null));
  return {
    label: city ? `${city}, ${state}` : postalCode ?? state,
    city, state, postalCode, country: "US", source: "gps", provider: "maptiler",
    precision: city ? "city" : postalCode ? "postal" : "state",
    // Never render untrusted provider-supplied attribution HTML.
    attribution: { label: "MapTiler / OpenStreetMap contributors", url: "https://www.maptiler.com/copyright/" },
  };
}
