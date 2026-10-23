export type ExperienceReloadReason = "identity" | "permissions" | "resource";
const KEY = "reylumi:experience-reload:v1";
const WINDOW_MS = 60_000;

/** One automatic recovery across documents, including alternating failure causes. */
export function allowExperienceReload(reason: ExperienceReloadReason): boolean {
  try {
    const now = Date.now();
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) {
      const previous = JSON.parse(raw) as { at?: number };
      if (typeof previous.at !== "number" || !Number.isFinite(previous.at) || previous.at > now || now - previous.at < WINDOW_MS) return false;
    }
    const value = JSON.stringify({ at: now, reason });
    window.sessionStorage.setItem(KEY, value);
    // If storage is unavailable, do not risk an unbounded cross-document loop.
    return window.sessionStorage.getItem(KEY) === value;
  } catch {
    return false;
  }
}
