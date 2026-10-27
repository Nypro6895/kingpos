"use client";
import { useMemo, useSyncExternalStore } from "react";
export const CUSTOMER_DISPLAY_PREFERENCES_KEY = "kingpos:device:customer-display:v1";
export const CUSTOMER_DISPLAY_APPEARANCE_CHANGED = "kingpos:display-appearance-changed";
const eventName = "kingpos:customer-display-preferences";
export const DEFAULT_CUSTOMER_DISPLAY_PREFERENCES = { adsEnabled: true, idleSeconds: 60, slideSeconds: 12, layout: "split" as "split" | "full" };
function read() { try { return localStorage.getItem(CUSTOMER_DISPLAY_PREFERENCES_KEY) ?? ""; } catch { return ""; } }
function subscribe(callback: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === CUSTOMER_DISPLAY_PREFERENCES_KEY || event.key === null) callback(); };
  window.addEventListener(eventName, callback); window.addEventListener("storage", changed);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener("storage", changed); };
}
export function normalizeCustomerDisplayPreferences(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { adsEnabled: typeof input.adsEnabled === "boolean" ? input.adsEnabled : true,
    idleSeconds: typeof input.idleSeconds === "number" && [0, 30, 60, 90].includes(input.idleSeconds) ? input.idleSeconds : 60,
    slideSeconds: typeof input.slideSeconds === "number" && [8, 12, 15].includes(input.slideSeconds) ? input.slideSeconds : 12,
    layout: input.layout === "full" ? "full" as const : "split" as const };
}
export function useCustomerDisplayPreferences() {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => { try { return normalizeCustomerDisplayPreferences(JSON.parse(raw)); } catch { return { ...DEFAULT_CUSTOMER_DISPLAY_PREFERENCES }; } }, [raw]);
}
export function saveCustomerDisplayPreferences(value: unknown) {
  localStorage.setItem(CUSTOMER_DISPLAY_PREFERENCES_KEY, JSON.stringify(normalizeCustomerDisplayPreferences(value)));
  window.dispatchEvent(new Event(eventName));
}
export function notifyCustomerAppearanceChanged() {
  try { localStorage.setItem(CUSTOMER_DISPLAY_APPEARANCE_CHANGED, String(Date.now())); } catch { /* The server save is already committed. */ }
  window.dispatchEvent(new Event(CUSTOMER_DISPLAY_APPEARANCE_CHANGED));
}
