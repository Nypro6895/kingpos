"use client";

import { useSyncExternalStore } from "react";

export const PORTABLE_ADD_ONS_KEY = "kingpos:device-services:v1:show-add-ons";
const changed = "kingpos:device-services-changed";

function read() {
  try { return window.localStorage.getItem(PORTABLE_ADD_ONS_KEY) !== "false"; }
  catch { return true; }
}

function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === PORTABLE_ADD_ONS_KEY || event.key === null) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", storage);
  };
}

export function usePortableServiceAddOns() {
  return useSyncExternalStore(subscribe, read, () => true);
}

export function setPortableServiceAddOns(enabled: boolean) {
  window.localStorage.setItem(PORTABLE_ADD_ONS_KEY, String(enabled));
  window.dispatchEvent(new Event(changed));
}
