import type { ExploreSearchFilters, ExploreSearchQueryKind } from "@/types/explore";

/** Legacy target values remain accepted; all queries return salon results. */
export type ExploreQueryTarget = "auto" | "salons" | "posts";
export type ExploreQueryArea = { city: string; stateCode: string; kind: "city" | "state" | "postal" };

const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATES = new Set(Object.values(STATE_CODES));
const CATEGORY_WORDS: Record<string, string> = {
  nail: "Nails", nails: "Nails", manicure: "Nails", manicures: "Nails", pedicure: "Nails", pedicures: "Nails", acrylic: "Nails", acrylics: "Nails", gel: "Nails",
  hair: "Hair", haircut: "Hair", haircuts: "Hair", barber: "Hair", barbers: "Hair", lash: "Lashes", lashes: "Lashes", eyelash: "Lashes", eyelashes: "Lashes", brow: "Brows", brows: "Brows", eyebrow: "Brows", eyebrows: "Brows", massage: "Massage", massages: "Massage", wax: "Waxing", waxing: "Waxing", spa: "Spa", spas: "Spa", facial: "Spa", facials: "Spa", skincare: "Spa", makeup: "Makeup",
};
const CONTENT_CUES = new Set(["design", "designs", "idea", "ideas", "inspiration", "inspirations", "photo", "photos", "picture", "pictures", "look", "looks", "video", "videos", "tutorial", "tutorials", "trend", "trends", "transformation", "transformations", "art"]);
const GENERIC_SERVICE_WORDS = new Set(["salon", "salons", "service", "services", "shop", "shops", "place", "places", "studio", "studios", "full", "set", "sets", "extension", "extensions", "classic", "basic", "deluxe", "french", "and", "for", "a", "the", "best"]);
// Broad category words route the request. Styles and specific services remain
// mandatory content terms even when they also identify a category.
const CONTENT_CATEGORY_WORDS = new Set(["nail", "nails", "hair", "lash", "lashes", "brow", "brows", "spa", "spas", "makeup", "massage", "massages", "waxing"]);
const CONTENT_ROUTING_WORDS = new Set(["salon", "salons", "service", "services", "shop", "shops", "place", "places", "studio", "studios", "and", "for", "a", "the", "best"]);
const NAIL_STYLE_WORDS = new Set("red burgundy pink nude beige white black brown orange yellow green blue purple silver gold almond square squoval round oval coffin ballerina stiletto stilettos stilitle stilleto stilletto short medium long glossy matte sheer glazed chrome glitter french floral ombre marble neon pastel pearl cat eye 3d spring summer fall autumn winter holiday bridal christmas wedding lavender lilac ruby scarlet cherry chocolate cocoa emerald sage mint cobalt".split(" "));
for (const word of "jelly glass aura airbrush tortoise shell tortoiseshell polka dot dots animal print fawn deer bambi cheetah leopard micro milky matcha olive velvet magnetic amber caramel plum chartreuse citron soap clean minimal liquid metal silver sculpture abstract accents knit sweater cable cashmere mixed mix match mismatched reverse soft vivid dark neutral metallic".split(" ")) NAIL_STYLE_WORDS.add(word);
function nailStylePhrase(value: string) {
  const tokens = words(value);
  return tokens.some(token => NAIL_STYLE_WORDS.has(token)) && tokens.every(token => NAIL_STYLE_WORDS.has(token) || ["nail", "nails", "manicure", "color", "colour", "shape", "tone", "length", "season"].includes(token) || CONTENT_CUES.has(token) || ["and", "with", "for", "the"].includes(token));
}

export function cleanExploreQueryText(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
}
export function normalizeExploreSearchFilters(value: unknown): ExploreSearchFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>, filters: ExploreSearchFilters = {};
  for (const key of ["shape", "length", "color", "finish", "tone", "season"] as const) {
    const text = cleanExploreQueryText(input[key]).toLowerCase().slice(0, 40);
    if (text) filters[key] = text;
  }
  if (typeof input.maxPrice === "number" && Number.isFinite(input.maxPrice) && input.maxPrice >= 0 && input.maxPrice <= 100000) filters.maxPrice = input.maxPrice;
  for (const key of ["bookableOnly", "newOnly", "trendingOnly"] as const) if (input[key] === true) filters[key] = true;
  return filters;
}

/** Facets constrain real searchable content; suggested images never establish a match. */
export function exploreSearchContentTerms(contentQuery: string, filters: ExploreSearchFilters) {
  const terms = [contentQuery, ...["shape", "length", "color", "finish", "tone", "season"].map(key => filters[key as keyof ExploreSearchFilters])]
    .filter((value): value is string => typeof value === "string");
  return [...new Set(terms.flatMap(words))].join(" ").slice(0, 160);
}
function words(value: string) { return value.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []; }
export function exploreQueryStateCode(value: unknown) {
  const text = cleanExploreQueryText(value);
  return STATES.has(text.toUpperCase()) ? text.toUpperCase() : STATE_CODES[text.toLowerCase()] ?? "";
}
/** Street syntax is only a hint; the server must verify it against public salon addresses. */
export function exploreQueryStreetAddress(value: string, explicitAddress = false) {
  const label = cleanExploreQueryText(value).replace(/[.!?]+$/, "");
  explicitAddress ||= /^(?:at\s+address|address)\s+/i.test(label);
  const address = label.replace(/^(?:at\s+(?:address\s+)?|address\s+)/i, "").trim();
  if (!/^(?:\d+[a-z]?(?:[-/]\d+[a-z]?)?|[nsew]\d+(?:[nsew]\d+)?)\s+[\p{L}\p{N}]/iu.test(address)) return "";
  const street = /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|cir|circle|pkwy|parkway|hwy|highway|rte|route|pl|place|ter|terrace|sq|square|trl|trail|loop|pike)\b/i;
  if (!street.test(address) && !(explicitAddress && /\s+\p{L}/u.test(address))) return "";
  return address;
}
export function parseExploreQueryArea(value: string): ExploreQueryArea | null {
  const label = cleanExploreQueryText(value).replace(/[.!?]+$/, "");
  // A street followed by WI is not a city named "8333 W Appleton Ave Milwaukee".
  if (exploreQueryStreetAddress(label)) return null;
  if (/^\d{5}(?:-\d{4})?$/.test(label)) return { kind: "postal", city: label, stateCode: "" };
  const stateCode = exploreQueryStateCode(label);
  if (stateCode) return { kind: "state", city: "", stateCode };
  const trailing = label.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  if (trailing && STATES.has(trailing[2].toUpperCase())) return { kind: "city", city: trailing[1].replace(/,$/, "").trim(), stateCode: trailing[2].toUpperCase() };
  const stateName = Object.keys(STATE_CODES).sort((a, b) => b.length - a.length).find(name => label.toLowerCase().endsWith(` ${name}`) || label.toLowerCase().endsWith(`,${name}`));
  if (stateName) return { kind: "city", city: label.slice(0, -stateName.length).replace(/[\s,]+$/, ""), stateCode: STATE_CODES[stateName] };
  return null;
}
export function exploreQueryAreaLabel(area: ExploreQueryArea) {
  return area.kind === "state" ? area.stateCode : area.kind === "postal" ? area.city : `${area.city}, ${area.stateCode}`;
}

/** A service followed by an area is tentative until the server checks the full name. */
function combinedServiceArea(value: string) {
  const parts = value.split(" ");
  if (!parts.some(part => words(part).some(word => CATEGORY_WORDS[word]))) return null;
  let lastService = -1;
  for (let index = 0; index < parts.length; index++) {
    if (words(parts[index]).some(word => CATEGORY_WORDS[word] || CONTENT_CUES.has(word))) lastService = index;
  }
  // Keep multiword services such as "hair extensions" and "nail place" together.
  while (lastService + 1 < parts.length && words(parts[lastService + 1]).length > 0
    && words(parts[lastService + 1]).every(word => GENERIC_SERVICE_WORDS.has(word))) lastService++;
  if (lastService < 0 || lastService >= parts.length - 1) return null;
  const query = parts.slice(0, lastService + 1).join(" ").replace(/[,\s]+$/, "");
  const locationHint = parts.slice(lastService + 1).join(" ").replace(/[,.!?]+$/, "").trim();
  if (nailStylePhrase(locationHint)) return null;
  return query && locationHint ? { query, locationHint } : null;
}

export type ParsedExploreQueryIntent = {
  target: "salons";
  queryKind: ExploreSearchQueryKind;
  query: string;
  contentQuery: string;
  displayQuery: string;
  categoryHint: string;
  locationHint: string;
  addressHint: string;
  explicitLocation: boolean;
  locationArea: ExploreQueryArea | null;
  cityQuery: string;
  nearMe: boolean;
  tentativeArea: boolean;
  directArea: boolean;
  explicitName: boolean;
  salonCue: boolean;
  categoryOnly: boolean;
};

/** Deterministic routing hints. Arbitrary city names are confirmed by the server. */
export function parseExploreQueryIntent(value: string, options: { target?: ExploreQueryTarget; ignoreArea?: boolean } = {}): ParsedExploreQueryIntent {
  const displayQuery = cleanExploreQueryText(value);
  let body = displayQuery.replace(/[.!?]+$/, "");
  const quoted = body.match(/^["“](.+)["”]$/);
  const named = body.match(/^(?:salon|shop|studio)(?:\s+(?:named|called)\s+|:\s*)(.+)$/i);
  const explicitName = Boolean(quoted || named);
  if (quoted) body = quoted[1].trim();
  else if (named) body = named[1].trim();
  let locationHint = "", addressHint = "", nearMe = false, tentativeArea = false, directArea = false, explicitLocation = false;
  if (!options.ignoreArea && !explicitName) {
    // Correct the nearby typo only in a position that expresses proximity. A
    // standalone brand such as "Nearly Perfect Nails" keeps its original text.
    if (/(?:^|\s+)nearly\s+me$/i.test(body)) body = body.replace(/\bnearly\s+me$/i, "near me");
    else {
      const nearly = body.match(/^(.*?)\s+nearly$/i);
      const terms = nearly ? words(nearly[1]) : [];
      if (terms.some(term => CATEGORY_WORDS[term]) && terms.every(term => CATEGORY_WORDS[term] || GENERIC_SERVICE_WORDS.has(term))) body = `${nearly![1]} near me`;
    }
    const nearby = body.match(/^(.*?)\s*(?:\bnear(?:\s+by)?\s+(?:me|here|my location|current location)|\bnear by|\baround me|\bclose to me|\bnearby)$/i);
    if (nearby) { body = nearby[1].trim(); nearMe = true; }
    else {
      const standaloneAddress = exploreQueryStreetAddress(body);
      const place = standaloneAddress ? null : body.match(/^(.*?)\s+\b(near(?:\s+by)?|around|nearby|in|at(?:\s+address)?)\s+(.+)$/i);
      const prefix = place || standaloneAddress ? null : body.match(/^(near(?:\s+by)?|around|in|at(?:\s+address)?|address)\s+(.+)$/i);
      const placeName = place?.[3] ?? prefix?.[2];
      if (placeName) {
        const candidate = placeName.replace(/[,.!?]+$/, "").trim();
        const cue = (place?.[2] ?? prefix?.[1] ?? "").toLowerCase();
        addressHint = exploreQueryStreetAddress(candidate, cue === "at" || cue.includes("address"));
        if (!CATEGORY_WORDS[candidate.toLowerCase()] && !["style", "fashion", "person"].includes(candidate.toLowerCase())) {
          locationHint = addressHint ? "" : candidate; body = place?.[1]?.trim() ?? "";
          explicitLocation = true;
          tentativeArea = !addressHint && ["in", "at"].includes(cue) && !parseExploreQueryArea(candidate);
        }
      }
      if (!locationHint && !addressHint) {
        addressHint = exploreQueryStreetAddress(body);
        if (addressHint) { body = ""; directArea = true; }
      }
      const combined = !locationHint && !addressHint ? combinedServiceArea(body) : null;
      if (combined) {
        addressHint = exploreQueryStreetAddress(combined.locationHint);
        locationHint = addressHint ? "" : combined.locationHint; body = combined.query;
        tentativeArea = !addressHint && !parseExploreQueryArea(locationHint);
      } else {
        const area = !locationHint && !addressHint ? parseExploreQueryArea(body) : null;
        if (area) { locationHint = exploreQueryAreaLabel(area); body = ""; directArea = true; }
      }
    }
  }
  const tokens = words(body);
  const serviceWords = tokens.filter(token => CATEGORY_WORDS[token]);
  const category = serviceWords.length ? CATEGORY_WORDS[serviceWords[0]] : "";
  const hasContentCue = tokens.some(token => CONTENT_CUES.has(token)) || nailStylePhrase(body);
  const target = "salons" as const;
  const genericService = serviceWords.length > 0 && tokens.every(token => CATEGORY_WORDS[token] || GENERIC_SERVICE_WORDS.has(token));
  const categoryOnly = !explicitName && serviceWords.length > 0 && tokens.every(token => CONTENT_CATEGORY_WORDS.has(token) || CONTENT_ROUTING_WORDS.has(token));
  const queryKind: ExploreSearchQueryKind = explicitName ? "name" : hasContentCue ? "style" : genericService || !tokens.length ? "service" : "name";
  const categoryHint = !explicitName && (hasContentCue || genericService) ? category || (nailStylePhrase(body) ? "Nails" : "") : "";
  const theme = explicitName ? tokens : tokens.filter(token => !CONTENT_CATEGORY_WORDS.has(token) && !CONTENT_CUES.has(token) && !CONTENT_ROUTING_WORDS.has(token));
  const contentQuery = queryKind === "name" ? body : categoryOnly ? "" : (theme.join(" ") || tokens.find(token => CONTENT_CUES.has(token)) || tokens[0] || "");
  const locationArea = parseExploreQueryArea(locationHint);
  return {
    target, queryKind, query: body, contentQuery, displayQuery, categoryHint, locationHint, addressHint, explicitLocation, locationArea,
    cityQuery: addressHint ? "" : locationHint ? locationArea?.kind === "city" ? locationArea.city : locationArea ? "" : locationHint : !explicitName && !genericService && !hasContentCue ? body : "",
    nearMe, tentativeArea, directArea, explicitName, categoryOnly, salonCue: serviceWords.length > 0 || tokens.some(token => GENERIC_SERVICE_WORDS.has(token)),
  };
}
