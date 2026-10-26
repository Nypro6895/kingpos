import { NAIL_LOOKS, type NailLook } from "@/lib/nail-inspiration-catalog";

export type NailLookView = { id: string; at: number };
const DAY = 86_400_000;
const looksById = new Map(NAIL_LOOKS.map(look => [look.id, look]));
export const NAIL_INTEREST_EVENT = "reylumi:nail-interest";

export function nailInterestStorageKey(viewerId?: string | null) {
  return `reylumi:nail-interest:v1:${viewerId ?? "guest"}`;
}

export function normalizeNailViews(value: unknown, now = Date.now()): NailLookView[] {
  if (!Array.isArray(value)) return [];
  const latest = new Map<string, NailLookView>();
  for (const entry of value.slice(0, 200)) {
    if (!entry || typeof entry.id !== "string" || !looksById.has(entry.id) ||
      typeof entry.at !== "number" || !Number.isFinite(entry.at) || entry.at > now || now - entry.at > 30 * DAY) continue;
    if (entry.at > (latest.get(entry.id)?.at ?? 0)) latest.set(entry.id, { id: entry.id, at: entry.at });
  }
  return [...latest.values()].sort((a, b) => b.at - a.at).slice(0, 40);
}

export function readNailViews(viewerId?: string | null): NailLookView[] {
  try { return normalizeNailViews(JSON.parse(window.localStorage.getItem(nailInterestStorageKey(viewerId)) ?? "[]")); }
  catch { return []; }
}

/** Explicit opens only; scrolling past an image does not imply a preference. */
export function recordNailLookView(id: string, viewerId?: string | null) {
  if (!looksById.has(id) || typeof window === "undefined") return;
  const views = readNailViews(viewerId);
  const now = Date.now();
  if (views.some(view => view.id === id && now - view.at < 30_000)) return;
  const next = normalizeNailViews([{ id, at: now }, ...views], now);
  try { window.localStorage.setItem(nailInterestStorageKey(viewerId), JSON.stringify(next)); }
  catch { /* Discovery still works when browser storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent(NAIL_INTEREST_EVENT, { detail: { viewerId: viewerId ?? null, views: next } }));
}

function similarity(a: NailLook, b: NailLook) {
  return (a.colors.some(color => b.colors.includes(color)) ? 3 : 0) +
    (a.shape === b.shape ? 2 : 0) + (a.finish === b.finish ? 2 : 0) +
    (a.length === b.length ? 1 : 0) + (a.tones.some(tone => b.tones.includes(tone)) ? 0.5 : 0);
}

/** Rank only eligible candidates: explicit searches/filters always take priority. */
export function personalizeNailLooks(candidates: NailLook[], savedKeys: string[], views: NailLookView[], now = Date.now()) {
  const interests = new Map<string, number>();
  for (const view of normalizeNailViews(views, now)) interests.set(view.id, 2 ** (-(now - view.at) / (7 * DAY)));
  for (const key of savedKeys) {
    if (key.startsWith("look:nail-") && looksById.has(key.slice(10))) interests.set(key.slice(10), 4);
  }
  if (!interests.size) return candidates;
  const ranked = candidates.map((look, index) => ({ look, index, score: [...interests].reduce((total, [id, weight]) =>
    total + similarity(look, looksById.get(id)!) * weight, 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(({ look }) => look);
  const selected: NailLook[] = [];
  const used = new Set<string>();
  // Every fourth recommendation explores the original rotation, avoiding a narrow feed.
  for (let index = 0; index < candidates.length; index++) {
    const pool = index % 4 === 3 ? candidates : ranked;
    const next = pool.find(look => !used.has(look.id));
    if (next) { selected.push(next); used.add(next.id); }
  }
  return selected;
}

/** Already displayed cards stay in place while new recommendations adapt. */
export function appendNailRecommendations(current: NailLook[], ranked: NailLook[], limit: number) {
  const eligible = new Set(ranked.map(look => look.id));
  const result = current.filter(look => eligible.has(look.id)).slice(0, limit);
  const used = new Set(result.map(look => look.id));
  for (const look of ranked) {
    if (result.length >= limit) break;
    if (!used.has(look.id)) { result.push(look); used.add(look.id); }
  }
  return result;
}
