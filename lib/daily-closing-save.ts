"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { closingPayload, closingSnapshot, closingValues, normalizeClosingMoney, type ClosingFormValues, type ClosingMoneyField } from "@/lib/daily-closing-input";

export type ClosingRow = { cashAmount: number; creditCardAmount: number; otherAmount: number; note: string | null; status: string };
type SavedRead<T> = { closingInputs: T; readOnly: boolean };
type Intent<T> = { values: ClosingFormValues; expectedClosing: T };
type Phase = "loading" | "idle" | "saving" | "checking" | "unknown" | "review" | "saved" | "matched" | "error";
type State<T> = { values: ClosingFormValues; baseline: T; latest: T; pending: Intent<T> | null; phase: Phase; message: string | null; explicitSave: boolean; readOnly: boolean; storageWarning: boolean };
type Options<T extends ClosingRow> = {
  initial: T;
  storageKey: string;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  readOnly: boolean;
  save: (values: ClosingFormValues, expected: T) => Promise<T>;
  read: () => Promise<SavedRead<T>>;
  onSaved?: () => void;
};

export const CLOSING_SAVE_WAIT_MS = 15_000;
const unknownMessage = "Save not confirmed. Your entries are kept. Check the saved result before saving again.";
const same = (a: ClosingRow, b: ClosingRow) => JSON.stringify(a) === JSON.stringify(b);
const matches = (row: ClosingRow, values: ClosingFormValues) => closingSnapshot(closingValues(row)) === closingSnapshot(values);
const emptyClosing = (row: ClosingRow) => row.cashAmount === 0 && row.creditCardAmount === 0 && row.otherAmount === 0 && !row.note;
function validValues(value: unknown): value is ClosingFormValues {
  return Boolean(value && typeof value === "object" && ["cashAmount", "creditCardAmount", "otherAmount", "note"].every(key => typeof (value as Record<string, unknown>)[key] === "string"));
}
export function validClosingRow(value: unknown): value is ClosingRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["cashAmount", "creditCardAmount", "otherAmount"].every(key => typeof row[key] === "number" && Number.isFinite(row[key]) && row[key] >= 0)
    && (row.note === null || typeof row.note === "string") && typeof row.status === "string";
}

// Reuse the existing actions and reads. This controller has no write queue,
// request receipt or retry: a readback establishes current values only.
export function useDailyClosingSave<T extends ClosingRow>(options: Options<T>) {
  const [state, setState] = useState<State<T>>(() => ({ values: closingValues(options.initial), baseline: options.initial, latest: options.initial, pending: null, phase: "loading", message: null, explicitSave: false, readOnly: options.readOnly, storageWarning: false }));
  const current = useRef(state);
  const callbacks = useRef(options);
  const active = useRef(false);
  const generation = useRef(0);
  const observed = useRef(JSON.stringify(options.initial));
  const acknowledged = useRef(false);
  const editRevision = useRef(0);
  useEffect(() => { callbacks.current = options; });

  const publish = useCallback((next: State<T>, persist = true) => {
    if (!active.current) return;
    if (persist) {
      try {
        const { storage, storageKey } = callbacks.current;
        if (!next.pending && matches(next.baseline, next.values) && next.phase !== "review") storage.removeItem(storageKey);
        else storage.setItem(storageKey, JSON.stringify({ version: 1, values: next.values, baseline: next.baseline, pending: next.pending, explicitSave: next.explicitSave }));
      } catch { next = { ...next, storageWarning: true }; }
    }
    current.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    active.current = true;
    const lifecycle = generation;
    const timer = setTimeout(() => {
      let next = { ...current.current, phase: "idle" as Phase };
      try {
        const draft = JSON.parse(callbacks.current.storage.getItem(callbacks.current.storageKey) ?? "null");
        // Keep Portable drafts created by the previous form as well.
        if (validValues(draft?.values ?? draft)) {
          const values = draft.values ?? draft;
          const baseline = validClosingRow(draft.baseline) ? draft.baseline as T : next.baseline;
          const pending = validValues(draft.pending?.values) && validClosingRow(draft.pending?.expectedClosing) ? draft.pending as Intent<T> : null;
          next = { ...next, values, baseline, pending, explicitSave: true,
            phase: pending ? "unknown" : !same(baseline, next.latest) ? "review" : "idle",
            message: pending ? unknownMessage : "Draft restored. Review your entries, then press Save." };
        }
      } catch { next = { ...next, storageWarning: true }; }
      publish(next, false);
    }, 0);
    return () => { clearTimeout(timer); active.current = false; lifecycle.current++; };
  }, [publish]);

  const incoming = JSON.stringify(options.initial);
  useEffect(() => {
    const changed = observed.current !== incoming;
    const timer = setTimeout(() => {
      observed.current = incoming;
      const now = current.current;
      if (!changed && now.readOnly === options.readOnly) return;
      const latest = changed ? JSON.parse(incoming) as T : now.latest;
      // A live refresh never replaces typing or resolves an uncertain save.
      const conflict = changed && !same(now.baseline, latest) && !now.pending;
      publish({ ...now, latest, readOnly: options.readOnly, ...(conflict ? { phase: "review" as const, explicitSave: true, message: "Closing amounts changed on another screen. Your entries are kept." } : {}) });
    }, 0);
    return () => clearTimeout(timer);
  }, [incoming, options.readOnly, publish]);

  function updateValue(key: keyof ClosingFormValues, value: string) {
    const now = current.current;
    if (now.values[key] !== value) editRevision.current++;
    publish({ ...now, values: { ...now.values, [key]: value },
      phase: ["saved", "matched", "error"].includes(now.phase) ? "idle" : now.phase,
      message: ["saved", "matched", "error"].includes(now.phase) ? null : now.message });
  }

  async function save(explicit = false) {
    let now = current.current;
    if (now.readOnly || options.readOnly || now.pending || ["loading", "saving", "checking", "review", "unknown"].includes(now.phase) || (!explicit && now.explicitSave)) return;
    let values: ClosingFormValues;
    try {
      const payload = closingPayload(now.values);
      values = closingValues(payload);
    } catch (error) { publish({ ...now, phase: "error", message: (error as Error).message }); return; }
    // Legacy report reads represent an absent closing and an existing all-zero
    // closing identically. Preserve the first explicit zero Save: payroll must
    // distinguish a recorded zero from no closing input. Never repeat it after
    // this form has received an acknowledgement.
    const recordZero = explicit && !acknowledged.current && emptyClosing(now.baseline);
    if (matches(now.baseline, values) && !recordZero) { publish({ ...now, values, phase: "idle", message: "No changes to save." }); return; }
    if (!navigator.onLine) { publish({ ...now, phase: "error", explicitSave: true, message: "You are offline. Your entries are kept. Connect, then press Save." }); return; }
    const intent = { values, expectedClosing: now.baseline };
    const submittedEditRevision = editRevision.current;
    const token = ++generation.current;
    now = { ...now, values, pending: intent, phase: "saving", message: null };
    publish(now);
    const timer = setTimeout(() => {
      if (active.current && token === generation.current) publish({ ...current.current, phase: "unknown", explicitSave: true, message: unknownMessage });
    }, CLOSING_SAVE_WAIT_MS);
    try {
      const saved = await callbacks.current.save(values, intent.expectedClosing);
      if (!active.current || token !== generation.current) return;
      if (!validClosingRow(saved)) throw new Error("Saved amounts are unavailable.");
      const latest = current.current;
      if (!matches(saved, values)) {
        publish({ ...latest, latest: saved, phase: "review", explicitSave: true, message: "Saved amounts differ from your submission. Review them before saving again." });
        return;
      }
      const unchanged = editRevision.current === submittedEditRevision;
      acknowledged.current = true;
      publish({ ...latest, baseline: saved, latest: saved, pending: null, values: unchanged ? closingValues(saved) : latest.values,
        phase: unchanged ? "saved" : "idle", explicitSave: !unchanged,
        message: unchanged ? null : "The earlier values were saved. Your newer edits are not saved yet." });
      try { callbacks.current.onSaved?.(); } catch { /* The write was acknowledged; a refresh failure does not undo it. */ }
    } catch (error) {
      if (active.current && token === generation.current) publish({ ...current.current, phase: "unknown", explicitSave: true,
        message: `${unknownMessage} ${error instanceof Error ? error.message : "Connection interrupted."}` });
    } finally { clearTimeout(timer); }
  }

  function blurMoney(key: ClosingMoneyField) {
    updateValue(key, normalizeClosingMoney(current.current.values[key]));
    void save();
  }

  async function checkSaved() {
    if (["loading", "saving", "checking"].includes(current.current.phase)) return;
    const token = ++generation.current;
    const before = current.current;
    publish({ ...before, phase: "checking", message: "Checking saved amounts…" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([callbacks.current.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The check timed out.")), 10_000); })]);
      if (!active.current || token !== generation.current) return;
      if (!validClosingRow(result.closingInputs)) throw new Error("Saved amounts are unavailable.");
      const now = current.current;
      const target = now.pending?.values ?? now.values;
      if (matches(result.closingInputs, target) && !emptyClosing(result.closingInputs)) {
        publish({ ...now, baseline: result.closingInputs, latest: result.closingInputs, readOnly: result.readOnly, pending: null, phase: "matched", explicitSave: true,
          message: "Saved amounts match the last submission. Review any newer edits before pressing Save." });
      } else {
        publish({ ...now, latest: result.closingInputs, readOnly: result.readOnly, phase: "review", explicitSave: true,
          message: matches(result.closingInputs, target)
            ? "The report shows zero amounts, but cannot confirm whether the empty closing was saved. The earlier save may still finish. Review before making a new save."
            : "Saved amounts differ. The earlier save may still finish. Review the amounts below before making a new save." });
      }
    } catch (error) {
      if (active.current && token === generation.current) publish({ ...current.current, phase: "unknown", explicitSave: true, message: `Could not confirm saved amounts. Your entries are kept. ${error instanceof Error ? error.message : "Try checking again."}` });
    } finally { clearTimeout(timer); }
  }

  function review(useSaved: boolean) {
    if (current.current.phase !== "review") return;
    generation.current++;
    const now = current.current;
    publish({ ...now, baseline: now.latest, pending: null, values: useSaved ? closingValues(now.latest) : now.values,
      phase: "idle", explicitSave: true,
      message: useSaved ? "Saved amounts loaded." : "Your entries are kept for review. Press Save only when ready to replace the displayed saved amounts." });
  }

  return { ...state, busy: state.phase === "saving" || state.phase === "checking", blocked: state.readOnly || options.readOnly || Boolean(state.pending) || ["loading", "saving", "checking", "review", "unknown"].includes(state.phase), updateValue, blurMoney, save, checkSaved, review };
}

export const closingSessionStorage = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};
