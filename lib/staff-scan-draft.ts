import type { ScanEntryLine } from "@/types/staff-scan";

export const scanDraftPrefix = (salonId: string, staffId: string) => `reylumi:staff-scan:${salonId}:${staffId}:`;
export type StaffScanDraft = { lines: ScanEntryLine[]; revision: number; at: number };
export const staffDraftStorageWarning = "Device storage unavailable. Keep this window open and use Stand by before leaving.";

function validDraft(value: unknown): value is StaffScanDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as StaffScanDraft;
  return Number.isSafeInteger(draft.revision) && draft.revision >= 0 && Number.isFinite(draft.at) &&
    Array.isArray(draft.lines) && draft.lines.length <= 30 && draft.lines.every(line =>
      line && typeof line.id === "string" && typeof line.serviceId === "string" &&
      typeof line.amount === "string" && /^\d*(\.\d{0,2})?$/.test(line.amount));
}

// These are unsent entries, never a queue for server writes. The server's
// current offer and revision must still be reviewed when opening the editor.
export function readStaffScanDraft(key: string): { draft: StaffScanDraft | null; warning?: string } {
  let unavailable = false;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const draft: unknown = JSON.parse(raw);
      return validDraft(draft) ? { draft } : { draft: null, warning: "Local entries could not be restored. Review the saved POS ticket before continuing." };
    }
  } catch { unavailable = true; }
  try {
    const legacy = sessionStorage.getItem(key);
    if (!legacy) return { draft: null, ...(unavailable ? { warning: staffDraftStorageWarning } : {}) };
    const draft: unknown = JSON.parse(legacy);
    if (!validDraft(draft)) return { draft: null, warning: "Local entries could not be restored. Review the saved POS ticket before continuing." };
    try {
      localStorage.setItem(key, JSON.stringify(draft));
      sessionStorage.removeItem(key);
      return { draft };
    } catch { return { draft, warning: staffDraftStorageWarning }; }
  } catch { return { draft: null, warning: staffDraftStorageWarning }; }
}

export function writeStaffScanDraft(key: string, draft: StaffScanDraft): boolean {
  try { localStorage.setItem(key, JSON.stringify(draft)); return true; }
  catch { return false; }
}

export function removeStaffScanDraft(key: string): boolean {
  let removed = true;
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try { storage().removeItem(key); } catch { removed = false; }
  }
  return removed;
}

// Run only after an authoritative workspace refresh. Never inspect or remove
// another salon/staff scope, including when a user signs out or changes role.
export function reconcileStaffScanDrafts(salonId: string, staffId: string, activeOfferIds: Set<string>): boolean {
  const prefix = scanDraftPrefix(salonId, staffId);
  let reconciled = true;
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      const store = storage();
      for (let index = store.length - 1; index >= 0; index--) {
        const key = store.key(index);
        if (key?.startsWith(prefix) && !activeOfferIds.has(key.slice(prefix.length))) store.removeItem(key);
      }
    } catch { reconciled = false; }
  }
  return reconciled;
}
