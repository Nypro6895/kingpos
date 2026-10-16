import { clearExperienceState } from "@/lib/experience-state";
import { resetExperienceResources, suspendExperienceResources } from "@/lib/experience-resource-cache";
import { broadcastExperienceReset, EXPERIENCE_RESET_EVENT, type ExperienceResetReason } from "@/lib/experience-cache-events";
import { lockExperienceOffline } from "@/lib/experience-offline-client";

/** Clear browsing snapshots, never POS outboxes or authoritative business data. */
export function resetExperienceCaches(options: { notify?: boolean; bookingDrafts?: boolean; preserveBookingHandoff?: boolean; scope?: string; reason?: ExperienceResetReason; suspend?: boolean; broadcast?: boolean } = {}): void {
  // A receiver adopts the originator's shared generation; it must not rotate it again.
  lockExperienceOffline({ scope: options.scope, rotateGeneration: options.broadcast !== false });
  const reason = options.reason ?? "reset";
  const suspended = options.suspend ?? (reason === "logout" || reason === "expired");
  if (suspended) suspendExperienceResources();
  else resetExperienceResources(options.scope);
  clearExperienceState();
  try {
    const storage = window.sessionStorage;
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (!key) continue;
      const feed = key.startsWith("kingpos-explore-continuous-feed") || key.startsWith("explore-sections:");
      const draft = options.bookingDrafts !== false && key.startsWith("kingpos.publicBookingDraft.") && !(options.preserveBookingHandoff && key.endsWith(".auth"));
      if (feed || draft) storage.removeItem(key);
    }
  } catch { /* Optional storage can be unavailable in private/mobile sessions. */ }
  if (options.notify !== false && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EXPERIENCE_RESET_EVENT, { detail: { reason, suspended } }));
  if (options.broadcast ?? (reason === "logout" || reason === "expired")) broadcastExperienceReset(reason);
}
