export const EXPERIENCE_RESET_EVENT = "reylumi:experience-reset";
const RESET_CHANNEL = "reylumi:experience-reset:v2";
const RESET_STORAGE = "reylumi:experience-reset-signal:v2";
const REASONS = ["logout", "expired", "identity", "permissions", "workspace", "reset"] as const;
export type ExperienceResetReason = typeof REASONS[number];
export type ExperienceResetDetail = { reason: ExperienceResetReason; suspended: boolean };
type ResetSignal = { id: string; source: string; at: number; reason: ExperienceResetReason };
const source = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

/** Only invalidation signals cross tabs. No identity, grants or cached records are persisted. */
export function broadcastExperienceReset(reason: ExperienceResetReason): void {
  if (typeof window === "undefined") return;
  const signal: ResetSignal = { id: `${source}:${Math.random().toString(36).slice(2)}`, source, at: Date.now(), reason };
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(RESET_CHANNEL);
      channel.postMessage(signal);
      channel.close();
      return;
    }
  } catch { /* Use storage events where channels are unavailable. */ }
  try {
    window.localStorage.setItem(RESET_STORAGE, JSON.stringify(signal));
    window.localStorage.removeItem(RESET_STORAGE);
  } catch { /* Browsing remains functional when all optional storage is disabled. */ }
}

export function subscribeExperienceResets(receive: (reason: ExperienceResetReason) => void): () => void {
  const seen = new Set<string>();
  const accept = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const signal = value as Partial<ResetSignal>;
    if (typeof signal.id !== "string" || signal.id.length > 160 || signal.source === source
      || typeof signal.source !== "string" || typeof signal.at !== "number"
      || Math.abs(Date.now() - signal.at) > 60_000 || !REASONS.includes(signal.reason as ExperienceResetReason)
      || seen.has(signal.id)) return;
    seen.add(signal.id);
    if (seen.size > 32) seen.delete(seen.values().next().value!);
    receive(signal.reason as ExperienceResetReason);
  };
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(RESET_CHANNEL);
      channel.onmessage = event => accept(event.data);
    }
  } catch { /* The storage fallback can still receive invalidation. */ }
  const storage = (event: StorageEvent) => {
    if (event.key !== RESET_STORAGE || !event.newValue || event.newValue.length > 1024) return;
    try { accept(JSON.parse(event.newValue)); } catch { /* Ignore unrelated malformed storage. */ }
  };
  window.addEventListener("storage", storage);
  return () => { channel?.close(); window.removeEventListener("storage", storage); };
}
