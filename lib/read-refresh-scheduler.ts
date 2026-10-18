"use client";

export type ReadRefreshReason = "focus" | "online" | "visible" | "foreground";
type Listener = (reason: ReadRefreshReason) => void;

const listeners = new Set<Listener>();
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: ReadRefreshReason | undefined;
let detach: (() => void) | undefined;

/** Only automatic data reads use this guard; authorization checks remain independent. */
export function canAutomaticallyRefreshRead() {
  return typeof window !== "undefined" && navigator.onLine !== false && document.visibilityState === "visible";
}

function flush() {
  timer = undefined;
  if (!pending || !canAutomaticallyRefreshRead()) return;
  const reason = pending;
  pending = undefined;
  // A route may detach while an earlier callback runs. Do not wake hidden routes.
  for (const listener of [...listeners]) if (listeners.has(listener)) listener(reason);
}

function schedule(reason: ReadRefreshReason) {
  // Keep the native foreground reason when WebKit sends accompanying focus events.
  if (pending !== "foreground") pending = reason;
  if (!timer && canAutomaticallyRefreshRead()) timer = setTimeout(flush, 100);
}

/** One browser/native lifecycle subscription, shared by every active read provider. */
export function subscribeReadRefresh(listener: Listener) {
  listeners.add(listener);
  if (!detach && typeof window !== "undefined") {
    const focus = () => schedule("focus");
    const online = () => schedule("online");
    const visible = () => { if (document.visibilityState === "visible") schedule("visible"); };
    const foreground = () => schedule("foreground");
    window.addEventListener("focus", focus);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("reylumi:foreground", foreground);
    detach = () => {
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("reylumi:foreground", foreground);
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    detach?.(); detach = undefined;
    if (timer) clearTimeout(timer);
    timer = undefined; pending = undefined;
  };
}
