"use client";
import type { PortableOperation } from "./portable-operations";
export type DesktopUpdateState = { phase: string; version: string; currentVersion?: string; progress?: number; scheduledAt: number | null; message: string };
export type IOSPortableDevice = {
  version: 1;
  platform: "ios";
  request<T = unknown>(input: Record<string, unknown>): Promise<T>;
  storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
};
declare global {
  interface Window {
    __reylumiPortableDevice?: IOSPortableDevice;
    kingposDesktop?: {
      version: number;
      offline?: { prepare(scope: string, assets: string[]): Promise<void>; lock(): boolean };
      updates?: { state(): Promise<DesktopUpdateState>; later(): Promise<DesktopUpdateState>; download?(): Promise<DesktopUpdateState>; schedule(at: number): Promise<DesktopUpdateState>; now(): Promise<DesktopUpdateState> };
      display?: { pair(token: string | null): Promise<void>; open(): Promise<void>; close(): Promise<void> };
      windowControls?: { fullscreen(toggle?: boolean): Promise<boolean>; menu(): void; action?(action: "help" | "reopen" | "offline" | "updates" | "about" | "minimize" | "zoomIn" | "zoomOut" | "resetZoom"): Promise<void>; onFullscreen(callback: (value: boolean) => void): () => void };
      storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
      operations: { list(scope: string): Promise<PortableOperation[]>; checkpoint(scope: string, key: string): Promise<number>; save(operation: PortableOperation): Promise<void> };
    };
  }
}
export function desktopDevice() { return typeof window !== "undefined" ? window.kingposDesktop : undefined; }
export function iosPortableDevice() {
  const device = typeof window !== "undefined" ? window.__reylumiPortableDevice : undefined;
  return device?.version === 1 && device.platform === "ios" ? device : undefined;
}
/** Core durability is shared; Windows-only window, display and update UI is not. */
export function portableDevice() {
  const desktop = desktopDevice();
  if (desktop) return desktop;
  const ios = iosPortableDevice();
  if (!ios || !(location.pathname === "/pos/portable" || location.pathname.startsWith("/pos/portable/"))) return undefined;
  return {
    storage: ios.storage,
    operations: {
      list: (scope: string) => ios.request<PortableOperation[]>({ action: "operations.list", scope }),
      checkpoint: (scope: string, key: string) => ios.request<number>({ action: "operations.checkpoint", scope, key }),
      save: async (operation: PortableOperation) => {
        const reply = await ios.request<{ ok: boolean }>({ action: "operations.save", scope: operation.scope, operation });
        if (reply?.ok !== true) throw new Error("Unable to save on this device. Your ticket is still open.");
      },
    },
  };
}
// No silent fallback: if native persistence fails, the receipt must stay open.
export const portableDeviceStorage = {
  getItem(key: string) {
    const device = portableDevice();
    if (!device) return localStorage.getItem(key);
    const value = device.storage.get(key);
    if (value !== null || !iosPortableDevice()) return value;
    // Upgrade this origin's legacy WebKit copy only after native admission.
    // Keep the original copy; an interrupted migration must not erase work.
    let legacy: string | null = null;
    try { legacy = localStorage.getItem(key); } catch { /* New native installs need no browser storage. */ }
    if (legacy !== null) device.storage.set(key, legacy);
    return legacy;
  },
  setItem(key: string, value: string) { const device = portableDevice(); if (device) device.storage.set(key, value); else localStorage.setItem(key, value); },
  removeItem(key: string) {
    const device = portableDevice();
    if (device) {
      device.storage.remove(key);
      // A confirmed removal cannot later resurrect a migrated browser copy.
      if (iosPortableDevice()) { try { localStorage.removeItem(key); } catch { /* Native commit already succeeded. */ } }
    } else localStorage.removeItem(key);
  },
};
