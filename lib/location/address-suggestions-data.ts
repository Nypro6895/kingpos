export type AddressSuggestion = {
  id: string; label: string; addressLine1: string; city: string; state: string;
  postalCode: string; country: string;
};

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";

export function parseAddressSuggestions(payload: unknown, mode: "address" | "area"): AddressSuggestion[] {
  const features = record(payload).features;
  if (!Array.isArray(features)) return [];
  const seen = new Set<string>();
  return features.slice(0, 12).flatMap(value => {
    const row = record(value);
    const label = text(row.place_name);
    const types = Array.isArray(row.place_type) ? row.place_type : [];
    if (!label || !types.some(type => (mode === "address" ? ["address"] : ["municipality", "place", "postal_code", "region", "address"]).includes(String(type)))) return [];
    const context = [row, ...(Array.isArray(row.context) ? row.context : []).map(record)];
    const part = (prefixes: string[]) => context.find(item => prefixes.some(prefix => text(item.id).startsWith(prefix + "."))) ?? {};
    const city = part(["municipality", "place", "locality"]);
    const region = part(["region"]);
    const country = part(["country"]);
    const postal = part(["postal_code", "postcode"]);
    const countryCode = text(country.short_code || record(country.properties).short_code || record(row.properties).country_code, 8).toUpperCase();
    const stateCode = text(region.short_code || record(region.properties).short_code, 40);
    const number = text(row.address, 30);
    const street = text(row.text, 180);
    const addressLine1 = types.includes("address") ? [number, street].filter(Boolean).join(" ") : "";
    if (mode === "address" && !addressLine1) return [];
    if (seen.has(label)) return [];
    seen.add(label);
    return [{ id: text(row.id) || label, label, addressLine1,
      city: text(city.text, 120), state: stateCode.replace(/^[a-z]{2}-/i, "") || text(region.text, 120),
      postalCode: text(postal.text, 30), country: /^[A-Z]{2}$/.test(countryCode) ? countryCode : "" }];
  }).slice(0, 6);
}
