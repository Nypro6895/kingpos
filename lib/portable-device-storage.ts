"use client";
import type { PortableOperation } from "./portable-operations";
export type DesktopUpdateState = { phase: string; version: string; scheduledAt: number | null; message: string };
declare global {
  interface Window {
    kingposDesktop?: {
      version: number;
      offline?: { prepare(scope: string, assets: string[]): Promise<void>; lock(): boolean };
      updates?: { state(): Promise<DesktopUpdateState>; later(): Promise<DesktopUpdateState>; schedule(at: number): Promise<DesktopUpdateState>; now(): Promise<DesktopUpdateState> };
      display?: { pair(token: string | null): Promise<void>; open(): Promise<void>; close(): Promise<void> };
      windowControls?: { fullscreen(toggle?: boolean): Promise<boolean>; menu(): void; onFullscreen(callback: (value: boolean) => void): () => void };
      storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
      operations: { list(scope: string): Promise<PortableOperation[]>; checkpoint(scope: string, key: string): Promise<number>; save(operation: PortableOperation): Promise<void> };
    };
  }
}
export function desktopDevice() { return typeof window !== "undefined" ? window.kingposDesktop : undefined; }
// No silent fallback: if native persistence fails, the receipt must stay open.
export const portableDeviceStorage = {
  getItem(key: string) { const device = desktopDevice(); return device ? device.storage.get(key) : localStorage.getItem(key); },
  setItem(key: string, value: string) { const device = desktopDevice(); if (device) device.storage.set(key, value); else localStorage.setItem(key, value); },
  removeItem(key: string) { const device = desktopDevice(); if (device) device.storage.remove(key); else localStorage.removeItem(key); },
};
