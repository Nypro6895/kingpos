"use client";
import type { PortableOperation } from "./portable-operations";
import { portableNativePlatform, type PortableNativePlatform } from "./portable-native-platform";
export type DesktopUpdateState = { phase: string; version: string; currentVersion?: string; progress?: number; scheduledAt: number | null; message: string };
export type NativePortableDevice = {
  version: 1;
  platform: PortableNativePlatform;
  request<T = unknown>(input: Record<string, unknown>): Promise<T>;
  storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
};
export type IOSPortableDevice = NativePortableDevice & { platform: "ios" };
export const PORTABLE_NATIVE_STORAGE_FAILED = "kingpos:native-storage-failed";
export const PORTABLE_NATIVE_HOST_READY = "kingpos:portable-native-ready";
declare global {
  interface Window {
    __reylumiPortableDevice?: NativePortableDevice;
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
export function nativePortableDevice() {
  const device = typeof window !== "undefined" ? window.__reylumiPortableDevice : undefined;
  return device?.version === 1 && (device.platform === "ios" || device.platform === "android") &&
    typeof device.request === "function" && typeof device.storage?.get === "function" &&
    typeof device.storage.set === "function" && typeof device.storage.remove === "function" ? device : undefined;
}
export function iosPortableDevice() { const device = nativePortableDevice(); return device?.platform === "ios" ? device as IOSPortableDevice : undefined; }
export function androidPortableDevice() { const device = nativePortableDevice(); return device?.platform === "android" ? device : undefined; }
export function expectedPortableNativePlatform() { return portableNativePlatform(typeof navigator === "undefined" ? null : navigator.userAgent); }
function nativeFailure(error: unknown, scope?: string): never {
  // An old scope's rejected request must not revoke a newly admitted editor.
  // Unknown/disk failures still fence every editor in this document.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const scoped = ["storage-locked", "stale-host", "writer-required", "untrusted-page", "offline-not-enabled"].includes(code) ? scope : undefined;
  window.dispatchEvent(new CustomEvent(PORTABLE_NATIVE_STORAGE_FAILED, { detail: scoped ? { scope: scoped } : {} }));
  throw error;
}
const storageScope = (key: string) => key.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];
/** Core durability is shared; Windows-only window, display and update UI is not. */
export function portableDevice() {
  const desktop = desktopDevice();
  if (desktop) return desktop;
  if (typeof window === "undefined" || typeof location === "undefined") return undefined;
  if (!(location.pathname === "/pos/portable" || location.pathname.startsWith("/pos/portable/"))) return undefined;
  const native = nativePortableDevice(), expected = expectedPortableNativePlatform();
  if (expected && native?.platform !== expected) return nativeFailure(new Error("Connect and unlock POS Portable before opening saved tickets."));
  if (!native) return undefined;
  const request = async <T,>(input: Record<string, unknown>): Promise<T> => {
    try { return await native.request<T>(input); } catch (error) { return nativeFailure(error, typeof input.scope === "string" ? input.scope : undefined); }
  };
  return {
    storage: {
      get(key: string) { try { return native.storage.get(key); } catch (error) { return nativeFailure(error, storageScope(key)); } },
      set(key: string, value: string) { try { native.storage.set(key, value); } catch (error) { nativeFailure(error, storageScope(key)); } },
      remove(key: string) { try { native.storage.remove(key); } catch (error) { nativeFailure(error, storageScope(key)); } },
    },
    operations: {
      list: (scope: string) => request<PortableOperation[]>({ action: "operations.list", scope }),
      checkpoint: (scope: string, key: string) => request<number>({ action: "operations.checkpoint", scope, key }),
      save: async (operation: PortableOperation) => {
        const reply = await request<{ ok: boolean }>({ action: "operations.save", scope: operation.scope, operation });
        if (reply?.ok !== true) nativeFailure(new Error("Unable to save on this device. Your ticket is still open."));
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
    if (value !== null || !nativePortableDevice()) return value;
    // Upgrade this origin's legacy browser copy only after native admission.
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
      if (nativePortableDevice()) { try { localStorage.removeItem(key); } catch { /* Native commit already succeeded. */ } }
    } else localStorage.removeItem(key);
  },
};
