"use client";
import { useEffect, useMemo, useSyncExternalStore, type RefObject } from "react";
import type { LedgerActionState } from "@/app/payroll/ledger-actions";

type Intent = { fields: Array<[string, string]> };
type Snapshot = { state: LedgerActionState; pending: boolean; loaded: boolean; restored: Intent | null };
const unknown: LedgerActionState = { status: "unknown", message: "The result is not confirmed. Your request is kept. Check the saved result or retry this same request safely." };
const initial: Snapshot = { state: { status: "idle", message: "" }, pending: false, loaded: false, restored: null };
function formData(intent: Intent) { const data = new FormData(); for (const [key, value] of intent.fields) data.append(key, value); return data; }
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Unconfirmed result")), ms); })]); }
  finally { clearTimeout(timer); }
}
function createIntentStore(storageKey: string) {
  let snapshot = initial, intent: Intent | null = null, generation = 0, lastStored: string | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: Partial<Snapshot>) => { snapshot = { ...snapshot, ...next }; for (const listener of listeners) listener(); };
  const persist = () => { try {
    // A remounted form may already hold a newer intent under this same key.
    // A late acknowledgement from the old store must not erase or resurrect it.
    if (sessionStorage.getItem(storageKey) !== lastStored) return;
    const next = intent ? JSON.stringify(intent) : null;
    if (next) sessionStorage.setItem(storageKey, next); else sessionStorage.removeItem(storageKey);
    lastStored = next;
  } catch { /* Same identity remains in memory when storage is unavailable. */ } };
  function load() {
    if (snapshot.loaded) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      lastStored = raw;
      const saved: unknown = raw && raw.length <= 32_000 ? JSON.parse(raw) : null;
      if (saved && typeof saved === "object" && "fields" in saved && Array.isArray(saved.fields)
        && saved.fields.length <= 30 && saved.fields.every((field: unknown) => Array.isArray(field) && field.length === 2 && field.every(value => typeof value === "string"))) {
        intent = saved as Intent;
      }
    } catch { /* A malformed draft cannot become a request. */ }
    emit({ loaded: true, restored: intent, state: intent ? unknown : initial.state });
  }
  async function execute(callback: (data: FormData) => Promise<LedgerActionState>, checkOnly: boolean) {
    if (snapshot.pending || !intent) return;
    const attempt = ++generation, payload = intent;
    emit({ pending: true, state: { status: "idle", message: checkOnly ? "Checking saved payroll result." : "Recording." } });
    try {
      const result = await bounded(callback(formData(payload)), checkOnly ? 10_000 : 15_000);
      if (attempt !== generation) return;
      if (result.status === "saved" || result.status === "error") intent = null;
      emit({ state: result });
    } catch { if (attempt === generation) emit({ state: unknown }); }
    finally { if (attempt === generation) { persist(); emit({ pending: false }); } }
  }
  return {
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); queueMicrotask(load); return () => { listeners.delete(listener); }; },
    submit(form: HTMLFormElement | null, send: (data: FormData) => Promise<LedgerActionState>) {
      load();
      if (snapshot.pending || snapshot.state.status === "saved") return;
      if (intent) { emit({ state: unknown }); return; }
      if (!form || !form.reportValidity()) return;
      const data = new FormData(form); data.set("request_id", crypto.randomUUID());
      intent = { fields: [...data.entries()].map(([key, value]) => [key, String(value)]) };
      persist(); void execute(send, false);
    },
    execute,
  };
}
export function usePayrollIntent({ storageKey, formRef, send, verify }: {
  storageKey: string; formRef: RefObject<HTMLFormElement | null>;
  send: (data: FormData) => Promise<LedgerActionState>; verify: (data: FormData) => Promise<LedgerActionState>;
}) {
  const store = useMemo(() => createIntentStore(storageKey), [storageKey]);
  const snapshot = useSyncExternalStore(store.subscribe, store.snapshot, () => initial);
  useEffect(() => {
    if (!snapshot.restored || !formRef.current) return;
    for (const [key, value] of snapshot.restored.fields) {
      const field = formRef.current.elements.namedItem(key);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
    }
  }, [snapshot.restored, formRef]);
  return { state: snapshot.state, pending: snapshot.pending,
    submit: () => store.submit(formRef.current, send),
    retry: () => void store.execute(send, false), verify: () => void store.execute(verify, true),
    locked: !snapshot.loaded || snapshot.pending || snapshot.state.status === "unknown" || snapshot.state.status === "saved" };
}
