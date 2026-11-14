"use client";

import { iosPortableDevice } from "./portable-device-storage";
import { migratePortableOperationsToNative } from "./portable-operations";

export type PortableNativeReadiness = {
  ok?: boolean; scope?: string; pending?: number; prepared?: boolean;
  storage: "native"; offlineReady: boolean; expiresAt: string;
};
export const PORTABLE_NATIVE_READY_CHANGED = "kingpos:native-readiness";

export async function preparePortableNativeStorage(scope: string): Promise<PortableNativeReadiness | null> {
  const native = iosPortableDevice();
  if (!native) return null;
  const result = await native.request<PortableNativeReadiness>({ action: "storage.prepare", scope });
  if (result?.ok !== true || result.scope !== scope || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now()) throw new Error("Connect and unlock POS Portable before opening saved tickets.");
  await migratePortableOperationsToNative(scope);
  window.dispatchEvent(new Event(PORTABLE_NATIVE_READY_CHANGED));
  return result;
}

export async function portableNativeReadiness(): Promise<PortableNativeReadiness | null> {
  const native = iosPortableDevice();
  return native ? native.request<PortableNativeReadiness>({ action: "offline.status" }) : null;
}
