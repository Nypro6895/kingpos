"use client";
import { useCallback, useLayoutEffect, useRef } from "react";

export const RECEIPT_PRIVATE_CLOSE_EVENTS = ["kingpos:portable-lock", "kingpos:native-portable-lock", "reylumi:app-local-reset", "kingpos:native-writer-reset", "kingpos:native-storage-failed"] as const;
/** Body portals must not outlive the retained editor's native admission. */
export function useReceiptPresentationGuard(scope: string, close: () => void) {
  const current = useRef({ scope, epoch: 0, blocked: false }), closer = useRef(close);
  const mountedScope = useRef(scope);
  useLayoutEffect(() => { closer.current = close; });
  useLayoutEffect(() => {
    if (mountedScope.current !== scope) { mountedScope.current = scope; closer.current(); }
    current.current = { scope, epoch: current.current.epoch + 1, blocked: false };
    const revoke = () => { current.current.epoch++; current.current.blocked = true; closer.current(); };
    const admission = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; state?: string }>).detail;
      if (detail?.scope !== current.current.scope) return;
      if (detail.state === "ready") { current.current.epoch++; current.current.blocked = false; }
      else revoke();
    };
    for (const event of RECEIPT_PRIVATE_CLOSE_EVENTS) window.addEventListener(event, revoke);
    window.addEventListener("kingpos:receipt-admission-changed", admission);
    window.addEventListener("pagehide", revoke);
    return () => { current.current.epoch++; current.current.blocked = true; for (const event of RECEIPT_PRIVATE_CLOSE_EVENTS) window.removeEventListener(event, revoke); window.removeEventListener("kingpos:receipt-admission-changed", admission); window.removeEventListener("pagehide", revoke); };
  }, [scope]);
  return {
    capture: useCallback(() => ({ ...current.current }), []),
    valid: useCallback((token: { scope: string; epoch: number; blocked: boolean }) => !token.blocked && !current.current.blocked && current.current.scope === token.scope && current.current.epoch === token.epoch, []),
  };
}
