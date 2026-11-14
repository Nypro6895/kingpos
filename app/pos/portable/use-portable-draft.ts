"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DraftOutbox, type DraftOutboxState, type DraftReply } from "@/lib/pos-draft-outbox";
import { portableCheckpoint } from "@/lib/portable-operations";
import { PORTABLE_NATIVE_READY_CHANGED } from "@/lib/portable-native-client";
import { desktopDevice, iosPortableDevice, portableDevice, portableDeviceStorage } from "@/lib/portable-device-storage";
import { publishLocalDisplaySnapshot } from "@/lib/pos-local-display";
import type { PosLiveDraftCustomer, PosLiveDraftReceiptLine } from "@/types/pos-desk";
import { acquirePortableRecoveryWriter, isNativePortableDevice, portableRecoveryStorageKey } from "@/lib/portable-recovery-key";

export type PortableDraftPayload = {
  token: string; selectedStaffId: string | null; staffLines: PosLiveDraftReceiptLine[];
  customer: PosLiveDraftCustomer | null;
  discount: number; subtotal: number; tax: number; tip: number; total: number; totalBeforeTip: number;
};
export const PORTABLE_DRAFT_STATE_CHANGED = "kingpos:draft-state";
export const portableDraftStates = new Map<string, { pending: boolean; attention: boolean }>();

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
  const [initializationRevision, setInitializationRevision] = useState(0);
  const discardRef = useRef<(() => void) | null>(null);
  const persistRecovery = useRef<(() => void) | null>(null);
  const lockedScope = useRef<string | null>(null);

  useEffect(() => { restoreRef.current = restore; versionRef.current = onVersion; }, [restore, onVersion]);
  useEffect(() => {
    recoveryRef.current = recovery;
    persistRecovery.current?.();
  }, [recovery]);

  useEffect(() => {
    // Activity may keep prior state while releasing effects and its writer.
    // Reacquire authority before enabling any edits in a retained view.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the UI with external Web Lock ownership before enabling edits.
    setReady(false);
    if (!scope) return;
    let active = true;
    let releaseWriter: (() => void) | null = null;
    const durableNative = Boolean(iosPortableDevice() && portableDevice());
    let initialSetup = true;
    let writerNeedsReadmission = false, readmitting = false, readmissionRequested = false, writerEpoch = 0, locked = lockedScope.current === scope;
    const lock = (event: Event) => {
      if (event.type === "kingpos:native-portable-lock" && !durableNative) return;
      lockedScope.current = scope; locked = true; writerEpoch++; writerNeedsReadmission = true;
      queue.current?.stop(); persistRecovery.current = null; setReady(false);
    };
    const invalidateWriter = () => { if (durableNative && !locked) { writerEpoch++; writerNeedsReadmission = true; setReady(false); } };
    const retryInitialization = () => { if (durableNative && initialSetup && active && !locked && writerNeedsReadmission) setInitializationRevision(value => value + 1); };
    window.addEventListener("kingpos:portable-lock", lock);
    window.addEventListener("kingpos:native-portable-lock", lock);
    window.addEventListener("reylumi:app-local-reset", invalidateWriter);
    window.addEventListener("kingpos:native-writer-reset", invalidateWriter);
    window.addEventListener(PORTABLE_NATIVE_READY_CHANGED, retryInitialization);
    const releaseInitialListeners = () => {
      window.removeEventListener("reylumi:app-local-reset", invalidateWriter);
      window.removeEventListener("kingpos:native-writer-reset", invalidateWriter);
      window.removeEventListener(PORTABLE_NATIVE_READY_CHANGED, retryInitialization);
      window.removeEventListener("kingpos:portable-lock", lock);
      window.removeEventListener("kingpos:native-portable-lock", lock);
    };
    let cleanup = () => { releaseInitialListeners(); releaseWriter?.(); };
    const initialize = async () => {
    if (locked) return;
    const initializationEpoch = writerEpoch;
    let key: string | null = null;
    let restored: DraftOutboxState<PortableDraftPayload> | undefined;
    let storageUnavailable = false;
    try {
      let tabId = sessionStorage.getItem("kingpos:portable-tab");
      if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem("kingpos:portable-tab", tabId); }
      const native = isNativePortableDevice();
      key = portableRecoveryStorageKey({ scope, operationScope, tabId, desktop: Boolean(desktopDevice()), native, durableNative, storage: portableDeviceStorage });
      if (native || durableNative) {
        releaseWriter = await acquirePortableRecoveryWriter(key);
        if (!active || locked || initializationEpoch !== writerEpoch) { releaseWriter?.(); releaseWriter = null; return; }
        if (!releaseWriter) { setReady(false); setStatus("POS is already open in another window. Continue there or close it first."); setNeedsReview(true); return; }
      }
      if (durableNative && operationScope && portableDeviceStorage.getItem(key) === null) {
        // Upgrade only this known live draft. Never guess among other windows'
        // carts, change an outbox ID, or erase the browser copy before commit.
        const slot = localStorage.getItem("kingpos:portable-native-recovery:v1:" + scope);
        const previousKey = slot?.startsWith("kingpos:portable-draft:v1:" + scope + ":") ? slot : "kingpos:portable-draft:v1:" + scope + ":" + tabId;
        const legacyKey = localStorage.getItem(previousKey) !== null ? previousKey : "kingpos:portable-draft:v1:" + scope + ":native";
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) {
          const value = JSON.parse(legacy);
          const checkpoint = await portableCheckpoint(operationScope, legacyKey);
          if (!active || locked || initializationEpoch !== writerEpoch) { releaseWriter?.(); releaseWriter = null; return; }
          if (value.savedAt > checkpoint) portableDeviceStorage.setItem(key, legacy);
        }
      }
      recoveryKey.current = key;
      const submittedAt = operationScope ? await portableCheckpoint(operationScope, key) : 0;
      if (!active || locked || initializationEpoch !== writerEpoch) { releaseWriter?.(); releaseWriter = null; return; }
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
    } catch {
      if (!active || locked || initializationEpoch !== writerEpoch) { releaseWriter?.(); releaseWriter = null; return; }
      storageUnavailable = true;
    }
    if (!active || locked || initializationEpoch !== writerEpoch) return;
    const outbox = new DraftOutbox<PortableDraftPayload>({
      version: initialVersion.current, restored,
      id: () => crypto.randomUUID(), online: () => navigator.onLine,
      persist: (state) => {
        if (!key || storageUnavailable || locked || durableNative && writerNeedsReadmission) throw new Error("Storage unavailable");
        portableDeviceStorage.setItem(key, JSON.stringify({ schema: 1, savedAt: Date.now(), outbox: state, recovery: recoveryRef.current }));
      },
      send: async (operation): Promise<DraftReply> => {
        if (locked || durableNative && writerNeedsReadmission) return { kind: "retry" };
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
        if (!key || storageUnavailable || locked || durableNative && writerNeedsReadmission) throw new Error("Storage unavailable");
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
    const reconnect = () => { if (!active || locked || durableNative && writerNeedsReadmission) return; update(); outbox.wake(0); };
    const readmitWriter = async () => {
      if (!durableNative || !active || locked || !writerNeedsReadmission || !key) return;
      readmissionRequested = true;
      if (readmitting) return;
      readmitting = true;
      try {
        while (readmissionRequested && writerNeedsReadmission && active && !locked) {
          readmissionRequested = false;
          const epoch = writerEpoch;
          releaseWriter?.(); releaseWriter = null;
          const replacement = await acquirePortableRecoveryWriter(key);
          if (!active || locked) { replacement?.(); return; }
          if (epoch !== writerEpoch) { replacement?.(); continue; }
          if (!replacement) { setNeedsReview(true); setStatus("POS is already open in another window. Continue there or close it first."); return; }
          releaseWriter = replacement; writerNeedsReadmission = false;
          // Keep live recovery and the original in-flight UUID; restoring an
          // older disk snapshot after a host reset could lose recent input.
          persistRecovery.current?.();
          setReady(!storageUnavailable && !outbox.storageError);
          if (!outbox.storageError) outbox.wake(0);
        }
      } catch { setStatus("Device storage unavailable — keep this window open"); }
      finally { readmitting = false; }
    };
    initialSetup = false;
    window.removeEventListener(PORTABLE_NATIVE_READY_CHANGED, retryInitialization);
    window.addEventListener(PORTABLE_NATIVE_READY_CHANGED, readmitWriter);
    discardRef.current = () => {
      outbox.stop(); persistRecovery.current = null;
      try { if (key) portableDeviceStorage.removeItem(key); } catch { /* Reload still works. */ }
      window.location.reload();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("reylumi:foreground", reconnect);
    window.addEventListener("offline", update);
    checkpointRef.current = () => {
      // Recovery is replaced synchronously before any in-flight acknowledgment
      // can persist the submitted cart again.
      if (key) { try { portableDeviceStorage.removeItem(key); } catch {} }
    };
    queueMicrotask(() => { if (active && !locked && initializationEpoch === writerEpoch && (!durableNative || !writerNeedsReadmission)) { update(); setReady(true); outbox.wake(); } });
    cleanup = () => {
      outbox.stop(); unsubscribe(); persistRecovery.current = null; queue.current = null;
      releaseWriter?.(); releaseWriter = null;
      discardRef.current = null;
      window.removeEventListener("kingpos:portable-lock", lock);
      window.removeEventListener("kingpos:native-portable-lock", lock);
      window.removeEventListener("kingpos:desktop-flush", flushDesktop);
      window.removeEventListener("online", reconnect); window.removeEventListener("offline", update);
      window.removeEventListener("reylumi:foreground", reconnect);
      releaseInitialListeners();
      window.removeEventListener(PORTABLE_NATIVE_READY_CHANGED, readmitWriter);
    };
    };
    void initialize();
    return () => { active = false; cleanup(); };
  }, [scope, operationScope, initializationRevision]);

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
