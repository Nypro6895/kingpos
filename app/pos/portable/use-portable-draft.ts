"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftOutbox, type DraftOutboxState, type DraftReply } from "@/lib/pos-draft-outbox";
import { portableCheckpoint } from "@/lib/portable-operations";
import { desktopDevice, portableDeviceStorage } from "@/lib/portable-device-storage";
import { publishLocalDisplaySnapshot } from "@/lib/pos-local-display";
import type { PosLiveDraftCustomer, PosLiveDraftReceiptLine } from "@/types/pos-desk";

export type PortableDraftPayload = {
  token: string; selectedStaffId: string | null; staffLines: PosLiveDraftReceiptLine[];
  customer: PosLiveDraftCustomer | null;
  discount: number; subtotal: number; tax: number; tip: number; total: number; totalBeforeTip: number;
};
export const PORTABLE_DRAFT_STATE_CHANGED = "kingpos:draft-state";
export const portableDraftStates = new Map<string, { pending: boolean; attention: boolean }>();
const PREFIX = "kingpos:portable-draft:v1:";

export function clearPortableLocalDrafts(event?: { preventDefault: () => void }) {
  if (!navigator.onLine) {
    event?.preventDefault();
    document.cookie = "kingpos-portable-local-lock=1; Path=/; Max-Age=31536000; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
    void caches.delete("kingpos-portable-shell-v1").catch(() => {});
  }
  window.dispatchEvent(new Event("kingpos:portable-lock"));
  // Locking ends access, not ownership of unsynced work. Scoped drafts remain
  // available only when the same POS account signs in again on this device.
}

export function usePortableDraft<Recovery>({ scope, operationScope, version, recovery, emptyRecovery, restore, onVersion, busy = false }: {
  busy?: boolean; scope: string | null; operationScope?: string; version: number; recovery: Recovery; emptyRecovery?: Recovery;
  restore: (value: Recovery) => void; onVersion: (version: number) => void;
}) {
  const recoveryKey = useRef<string | null>(null);
  const checkpointRef = useRef<(() => void) | null>(null);
  const queue = useRef<DraftOutbox<PortableDraftPayload> | null>(null);
  const recoveryRef = useRef(recovery);
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const emptyRecoveryRef = useRef(emptyRecovery);
  const restoreRef = useRef(restore);
  const versionRef = useRef(onVersion);
  const initialVersion = useRef(version);
  const [status, setStatus] = useState("Connecting…");
  const [ready, setReady] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const discardRef = useRef<(() => void) | null>(null);
  const persistRecovery = useRef<(() => void) | null>(null);

  useEffect(() => { restoreRef.current = restore; versionRef.current = onVersion; }, [restore, onVersion]);
  useEffect(() => {
    recoveryRef.current = recovery;
    persistRecovery.current?.();
  }, [recovery]);

  useEffect(() => {
    if (!scope) return;
    let active = true;
    let cleanup = () => {};
    const initialize = async () => {
    let key: string | null = null;
    let restored: DraftOutboxState<PortableDraftPayload> | undefined;
    let storageUnavailable = false;
    try {
      let tabId = sessionStorage.getItem("kingpos:portable-tab");
      if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem("kingpos:portable-tab", tabId); }
      key = desktopDevice() && operationScope ? PREFIX + operationScope + ":desktop" : PREFIX + scope + ":" + tabId;
      recoveryKey.current = key;
      const submittedAt = operationScope ? await portableCheckpoint(operationScope, key) : 0;
      if (!active) return;
      const raw = portableDeviceStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.savedAt <= submittedAt) {
          portableDeviceStorage.removeItem(key);
          if (emptyRecoveryRef.current) { recoveryRef.current = emptyRecoveryRef.current; restoreRef.current(emptyRecoveryRef.current); }
        } else if (saved.schema === 1 &&
            saved.outbox?.schema === 1 && Number.isSafeInteger(saved.outbox.version)) {
          if (saved.outbox.head || saved.outbox.next) {
            restored = saved.outbox;
            if (restored && !(saved.savedAt > Date.now() - 86_400_000)) {
              restored.blocked = "This local draft is more than a day old. Review it before continuing.";
            } else if (restored && restored.version !== initialVersion.current &&
                initialVersion.current !== (restored.head?.expectedVersion ?? -2) + 1) {
              restored.blocked = "The server receipt changed while this draft was offline. Review before continuing.";
            }
            if (saved.recovery) { recoveryRef.current = saved.recovery; restoreRef.current(saved.recovery); }
          } else if (operationScope && saved.recovery) {
            recoveryRef.current = saved.recovery; restoreRef.current(saved.recovery);
          }
        } else portableDeviceStorage.removeItem(key);
      } else if (submittedAt > 0 && emptyRecoveryRef.current) {
        recoveryRef.current = emptyRecoveryRef.current; restoreRef.current(emptyRecoveryRef.current);
      }
    } catch { storageUnavailable = true; }
    if (!active) return;
    const outbox = new DraftOutbox<PortableDraftPayload>({
      version: initialVersion.current, restored,
      id: () => crypto.randomUUID(), online: () => navigator.onLine,
      persist: (state) => {
        if (!key || storageUnavailable) throw new Error("Storage unavailable");
        portableDeviceStorage.setItem(key, JSON.stringify({ schema: 1, savedAt: Date.now(), outbox: state, recovery: recoveryRef.current }));
      },
      send: async (operation): Promise<DraftReply> => {
        const response = await fetch("/api/pos/portable/draft", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...operation, token: operation.payload.token }),
          signal: AbortSignal.timeout(8000), cache: "no-store",
        });
        if (response.status >= 500 || response.status === 429) return { kind: "retry" };
        if (!response.ok) return { kind: "blocked", message: "Draft sync needs attention. Review the POS session before continuing." };
        const result = await response.json();
        if (result.kind === "ok" && Number.isSafeInteger(result.version)) {
          if (result.snapshot) publishLocalDisplaySnapshot(result.snapshot);
          return result;
        }
        if (result.kind === "blocked" && typeof result.message === "string") return result;
        return { kind: "retry" };
      },
    });
    queue.current = outbox;
    const update = () => {
      if (operationScope) {
        portableDraftStates.set(operationScope, { pending: outbox.pending, attention: !!outbox.state.blocked || outbox.storageError || storageUnavailable });
        window.dispatchEvent(new Event(PORTABLE_DRAFT_STATE_CHANGED));
      }
      setNeedsReview(!!outbox.state.blocked);
      versionRef.current(outbox.state.version);
      setStatus(outbox.storageError || storageUnavailable ? "Device storage unavailable — keep this window open" :
        outbox.state.blocked ?? (!navigator.onLine ? "Offline — draft kept on this device" :
          outbox.pending ? "Draft saved on device — waiting to sync" : "Draft synced"));
    };
    const unsubscribe = outbox.subscribe(update);
    persistRecovery.current = () => {
      try {
        if (!key || storageUnavailable) throw new Error("Storage unavailable");
        portableDeviceStorage.setItem(key, JSON.stringify({ schema: 1, savedAt: Date.now(), outbox: outbox.state, recovery: recoveryRef.current }));
        outbox.storageError = false;
      } catch { outbox.storageError = true; }
      update();
    };
    const flushDesktop = (event: Event) => {
      persistRecovery.current?.();
      const request = event as CustomEvent<{ saved: boolean; busy?: boolean }>;
      request.detail.busy = busyRef.current;
      request.detail.saved = !outbox.storageError && !storageUnavailable;
    };
    window.addEventListener("kingpos:desktop-flush", flushDesktop);
    const reconnect = () => { update(); outbox.wake(0); };
    const lock = () => { outbox.stop(); persistRecovery.current = null; };
    discardRef.current = () => {
      outbox.stop(); persistRecovery.current = null;
      try { if (key) portableDeviceStorage.removeItem(key); } catch { /* Reload still works. */ }
      window.location.reload();
    };
    window.addEventListener("kingpos:portable-lock", lock);
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", update);
    checkpointRef.current = () => {
      // Recovery is replaced synchronously before any in-flight acknowledgment
      // can persist the submitted cart again.
      if (key) { try { portableDeviceStorage.removeItem(key); } catch {} }
    };
    queueMicrotask(() => { if (active) { update(); setReady(true); outbox.wake(); } });
    cleanup = () => {
      outbox.stop(); unsubscribe(); persistRecovery.current = null; queue.current = null;
      discardRef.current = null;
      window.removeEventListener("kingpos:portable-lock", lock);
      window.removeEventListener("kingpos:desktop-flush", flushDesktop);
      window.removeEventListener("online", reconnect); window.removeEventListener("offline", update);
    };
    };
    void initialize();
    return () => { active = false; cleanup(); };
  }, [scope, operationScope]);

  const enqueue = useCallback((payload: PortableDraftPayload) => { queue.current?.enqueue(payload); }, []);
  const flush = useCallback(async () => scope ? (await queue.current?.flush()) ?? false : true, [scope]);
  const observeVersion = useCallback((value: number, compatible = true) => { queue.current?.observeVersion(value, compatible); }, []);
  const blocked = useCallback(() => !!queue.current?.state.blocked, []);
  const discard = useCallback(() => discardRef.current?.(), []);
  const persistLocal = useCallback((payload: PortableDraftPayload, value: Recovery) => {
    if (!queue.current) return false;
    recoveryRef.current = value;
    queue.current.enqueue(payload);
    persistRecovery.current?.();
    return !queue.current.storageError;
  }, []);
  const checkpoint = useCallback((empty: Recovery) => { recoveryRef.current = empty; checkpointRef.current?.(); }, []);
  return { persistLocal, recoveryKey, checkpoint, ready, status, enqueue, flush, observeVersion, blocked, needsReview, discard };
}
