import { cleanExploreQueryText, parseExploreQueryArea } from "@/lib/explore-query-intent";

export type ExploreSearchSuggestion = {
  id: string;
  kind: "salon" | "area" | "service" | "idea";
  label: string;
  detail: string;
  query: string;
  location?: string;
  category?: string;
  target: "salons" | "posts" | "auto";
};

const services = [
  ["Nails", "Nail salons", "nails"], ["Nails", "Gel nails", "gel nails"],
  ["Nails", "Acrylic nails", "acrylic nails"], ["Nails", "Pedicure", "pedicure"],
  ["Hair", "Hair salons", "hair"], ["Hair", "Hair extensions", "hair extensions"],
  ["Lashes", "Lash extensions", "lash extensions"], ["Brows", "Brow services", "brows"],
  ["Spa", "Facials", "facial"], ["Massage", "Massage", "massage"],
] as const;
const ideas = [
  ["Nails", "French nail designs", "French nail design"], ["Nails", "Christmas nail designs", "Christmas nail design"],
  ["Nails", "Gel nail designs", "gel nail design"], ["Nails", "Ombre nail designs", "ombre nail design"],
  ["Hair", "Hair extensions ideas", "hair extensions ideas"], ["Lashes", "Lash extension ideas", "lash extension ideas"],
] as const;

export function normalizeExploreSuggestionRequest(input: { query?: unknown; location?: unknown; category?: unknown }) {
  const query = cleanExploreQueryText(input.query).slice(0, 80);
  const location = cleanExploreQueryText(input.location);
  const category = cleanExploreQueryText(input.category).slice(0, 80);
  const area = parseExploreQueryArea(location);
  return { query, category: category.toLowerCase() === "all" ? "" : category,
    city: area?.kind === "city" ? area.city : "", state: area?.stateCode ?? "" };
}

export function mergeExploreSearchSuggestions(rows: unknown, input: { query: string; category: string }): ExploreSearchSuggestion[] {
  if (input.query.length < 2) return [];
  const selectedCategory = input.category.toLowerCase();
  const query = input.query.toLowerCase();
  const bounded = (Array.isArray(rows) ? rows : []).slice(0, 8).flatMap((value): ExploreSearchSuggestion[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const kind = row.kind === "salon" ? "salon" : row.kind === "area" ? "area" : null;
    const id = cleanExploreQueryText(row.id), label = cleanExploreQueryText(row.label);
    if (!kind || !id || !label) return [];
    return [{ id, kind, label, detail: cleanExploreQueryText(row.detail),
      query: label, location: kind === "area" ? label : undefined, target: "salons" }];
  });
  const local: ExploreSearchSuggestion[] = [];
  for (const [kind, source] of [["service", services], ["idea", ideas]] as const) {
    for (const [category, label, text] of source) {
      if (selectedCategory && selectedCategory !== category.toLowerCase()) continue;
      if (!label.toLowerCase().startsWith(query) && !text.toLowerCase().startsWith(query)) continue;
      local.push({ id: `${kind}:${text}`, kind, label, query: text, category, detail: kind === "idea" ? "Styles" : "Services", target: "salons" });
    }
  }
  const seen = new Set<string>();
  return [...bounded.slice(0, 6), ...local, ...bounded.slice(6)].filter(row => {
    if (seen.has(row.id)) return false;
    seen.add(row.id); return true;
  }).slice(0, 8);
}
