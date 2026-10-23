/** Small, session-only browsing state. Never store account credentials or business records here. */
export const EXPERIENCE_STATE_PREFIX = "reylumi:experience:v1:";
export const EXPERIENCE_STATE_TTL_MS = 30 * 60 * 1000;
export const EXPERIENCE_STATE_MAX_TTL_MS = 2 * 60 * 60 * 1000;
export const EXPERIENCE_STATE_MAX_ENTRIES = 40;
export const EXPERIENCE_STATE_MAX_BYTES = 160 * 1024;
export const EXPERIENCE_STATE_MAX_ENTRY_BYTES = 16 * 1024;

export type ExperienceStateContext = { namespace: string; scope: string; key: string };
type StoredExperience = {
  version: 1;
  context: ExperienceStateContext;
  savedAt: number;
  expiresAt: number;
  value: unknown;
};

function sessionStore(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; }
  catch { return null; }
}

function validContext(context: ExperienceStateContext): boolean {
  return [context?.namespace, context?.scope, context?.key].every(
    part => typeof part === "string" && part.length > 0 && part.length <= 256,
  );
}

function storageKey(context: ExperienceStateContext): string {
  return EXPERIENCE_STATE_PREFIX + encodeURIComponent(JSON.stringify([context.namespace, context.scope, context.key]));
}

function keyContext(key: string): ExperienceStateContext | null {
  try {
    const parts: unknown = JSON.parse(decodeURIComponent(key.slice(EXPERIENCE_STATE_PREFIX.length)));
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const context = { namespace: parts[0], scope: parts[1], key: parts[2] };
    return validContext(context) ? context : null;
  } catch { return null; }
}

function sameContext(left: ExperienceStateContext, right: ExperienceStateContext): boolean {
  return left.namespace === right.namespace && left.scope === right.scope && left.key === right.key;
}

function parseStored(raw: string, context: ExperienceStateContext, now: number): StoredExperience | null {
  try {
    if (raw.length * 2 > EXPERIENCE_STATE_MAX_ENTRY_BYTES) return null;
    const entry = JSON.parse(raw) as StoredExperience;
    if (!entry || entry.version !== 1 || !validContext(entry.context) || !sameContext(entry.context, context)
      || !Object.prototype.hasOwnProperty.call(entry, "value")
      || !Number.isFinite(entry.savedAt) || !Number.isFinite(entry.expiresAt)
      || entry.savedAt > now || entry.expiresAt <= now || entry.expiresAt <= entry.savedAt
      || entry.expiresAt - entry.savedAt > EXPERIENCE_STATE_MAX_TTL_MS) return null;
    return entry;
  } catch { return null; }
}

function ownedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(EXPERIENCE_STATE_PREFIX)) keys.push(key);
  }
  return keys;
}

export function readExperienceState<T>(context: ExperienceStateContext, validate: (value: unknown) => value is T): T | null {
  const storage = sessionStore();
  if (!storage || !validContext(context)) return null;
  try {
    const key = storageKey(context);
    const raw = storage.getItem(key);
    if (!raw) return null;
    const entry = parseStored(raw, context, Date.now());
    if (!entry || !validate(entry.value)) { storage.removeItem(key); return null; }
    return entry.value;
  } catch { return null; }
}

export function writeExperienceState(context: ExperienceStateContext, value: unknown, options: { ttlMs?: number } = {}): boolean {
  const storage = sessionStore();
  const ttlMs = options.ttlMs ?? EXPERIENCE_STATE_TTL_MS;
  if (!storage || !validContext(context) || !Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > EXPERIENCE_STATE_MAX_TTL_MS) return false;
  try {
    const now = Date.now();
    const key = storageKey(context);
    const raw = JSON.stringify({ version: 1, context, savedAt: now, expiresAt: now + ttlMs, value });
    if (!parseStored(raw, context, now)) return false;
    const bytes = (key.length + raw.length) * 2;
    if (bytes > EXPERIENCE_STATE_MAX_ENTRY_BYTES) return false;
    const entries: Array<{ key: string; bytes: number; savedAt: number }> = [];
    for (const oldKey of ownedKeys(storage)) {
      if (oldKey === key) continue;
      const oldContext = keyContext(oldKey);
      const oldRaw = storage.getItem(oldKey);
      const oldEntry = oldContext && oldRaw ? parseStored(oldRaw, oldContext, now) : null;
      if (!oldEntry || !oldRaw) { storage.removeItem(oldKey); continue; }
      entries.push({ key: oldKey, bytes: (oldKey.length + oldRaw.length) * 2, savedAt: oldEntry.savedAt });
    }
    entries.sort((left, right) => left.savedAt - right.savedAt);
    let totalBytes = bytes + entries.reduce((total, entry) => total + entry.bytes, 0);
    while (entries.length >= EXPERIENCE_STATE_MAX_ENTRIES || totalBytes > EXPERIENCE_STATE_MAX_BYTES) {
      const oldest = entries.shift();
      if (!oldest) break;
      storage.removeItem(oldest.key);
      totalBytes -= oldest.bytes;
    }
    storage.setItem(key, raw);
    return true;
  } catch { return false; }
}

/** Logout can clear all entries; account/workspace code can clear an exact scope or namespace. */
export function clearExperienceState(filter: { namespace?: string; scope?: string } = {}): void {
  const storage = sessionStore();
  if (!storage) return;
  try {
    for (const key of ownedKeys(storage)) {
      const context = keyContext(key);
      if (!context || ((filter.namespace === undefined || context.namespace === filter.namespace)
        && (filter.scope === undefined || context.scope === filter.scope))) storage.removeItem(key);
    }
  } catch { /* A browser may revoke storage access at any time. */ }
}
