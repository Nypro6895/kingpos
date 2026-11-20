export type ForumListMode = "feed" | "saved" | "following" | "mine";
export type ForumReadCacheInput = {
  mode: ForumListMode;
  q?: string;
  state?: string;
  section?: string;
  unanswered?: boolean;
};
export type ForumReadSnapshot<T> = {
  rows: T[];
  more: boolean;
  updatedAt: number;
  fresh: boolean;
};

const MODES = new Set<string>(["feed", "saved", "following", "mine"]);
const MAX_ENTRIES = 12;
const MAX_ROWS = 200;
const FRESH_MS = 30_000;

/** Only normal topic lists belong here. Reports, chat and credentials do not. */
export function forumReadCacheKey(input: ForumReadCacheInput): string {
  if (!MODES.has(input.mode)) throw new TypeError("Invalid forum list");
  return JSON.stringify([input.mode, (input.q ?? "").trim().slice(0, 150), input.state ?? "", input.section ?? "", Boolean(input.unanswered)]);
}

/** Create one cache per mounted, authorized Forum instance. Nothing is persisted.
 * Capture getEpoch() before each read, then pass it to put(). Privacy/account
 * withdrawal cannot be undone by a response that started before invalidation.
 */
export function createForumReadCache<T>(options: {
  now?: () => number;
  freshForMs?: number;
  maxEntries?: number;
  maxRows?: number;
} = {}) {
  const bounded = (value: number | undefined, fallback: number) => Number.isFinite(value) ? Math.max(1, Math.min(fallback, Math.floor(value!))) : fallback;
  const maxEntries = bounded(options.maxEntries, MAX_ENTRIES);
  const maxRows = bounded(options.maxRows, MAX_ROWS);
  const freshForMs = Number.isFinite(options.freshForMs) ? Math.max(0, Math.min(FRESH_MS, options.freshForMs!)) : FRESH_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { rows: T[]; more: boolean; updatedAt: number; invalidated: boolean }>();
  let epoch = 0;
  const validKey = (key: string) => typeof key === "string" && key.length > 0 && key.length <= 4096;

  function get(key: string): ForumReadSnapshot<T> | undefined {
    if (!validKey(key)) return;
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    entries.set(key, entry);
    const age = now() - entry.updatedAt;
    return { rows: entry.rows.slice(), more: entry.more, updatedAt: entry.updatedAt, fresh: !entry.invalidated && age >= 0 && age < freshForMs };
  }

  function put(key: string, snapshot: { rows: readonly T[]; more: boolean; updatedAt?: number }, expectedEpoch: number): boolean {
    const timestamp = snapshot.updatedAt ?? now();
    if (expectedEpoch !== epoch || !validKey(key) || !Array.isArray(snapshot.rows) || !Number.isFinite(timestamp) || timestamp > now()) return false;
    const rows = snapshot.rows.slice(0, maxRows);
    entries.delete(key);
    entries.set(key, { rows, more: snapshot.more || snapshot.rows.length > maxRows, updatedAt: timestamp, invalidated: false });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    return true;
  }

  function invalidate(key?: string): void {
    epoch++;
    if (key !== undefined) {
      const entry = entries.get(key);
      if (entry) entry.invalidated = true;
    } else {
      for (const entry of entries.values()) entry.invalidated = true;
    }
  }

  /** Patch accepted display metadata without renewing its age or authority. */
  function mapRows(transform: (row: T) => T, expectedEpoch: number): boolean {
    if (expectedEpoch !== epoch) return false;
    const patched = Array.from(entries, ([key, entry]) => [key, { ...entry, rows: entry.rows.map(transform) }] as const);
    // A withdrawal performed during a transform must still win atomically.
    if (expectedEpoch !== epoch) return false;
    for (const [key, entry] of patched) entries.set(key, entry);
    return true;
  }

  function clear(): void { epoch++; entries.clear(); }
  return { get, put, invalidate, clear, mapRows, getEpoch: () => epoch };
}
