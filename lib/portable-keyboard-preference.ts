"use client";

import { useSyncExternalStore } from "react";

// UI preference only. Electron persists localStorage in its existing device
// partition; do not put this in salon settings or the receipt vault.
export const PORTABLE_KEYBOARD_KEY = "kingpos:device-input:v1:supplemental-keyboard";
const changed = "kingpos:device-input-changed";

function read() {
  try { return window.localStorage.getItem(PORTABLE_KEYBOARD_KEY) === "true"; }
  catch { return false; }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PORTABLE_KEYBOARD_KEY || event.key === null) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSupplementalKeyboard() {
  return useSyncExternalStore(subscribe, read, () => false);
}

export function setSupplementalKeyboard(enabled: boolean) {
  // Let callers show a save error instead of pretending persistence succeeded.
  window.localStorage.setItem(PORTABLE_KEYBOARD_KEY, String(enabled));
  window.dispatchEvent(new Event(changed));
}
