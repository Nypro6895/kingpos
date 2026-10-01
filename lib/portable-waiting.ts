"use client";
export const WAITING_CHANGED = "kingpos:waiting-changed";
export function notifyWaitingChanged() {
  window.dispatchEvent(new Event(WAITING_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(WAITING_CHANGED); channel.postMessage("changed"); channel.close();
  }
}
