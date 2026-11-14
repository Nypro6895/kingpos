"use client";

import { getAppLocalHost } from "./app-local-host";
import { APP_LOCAL_PORTABLE_READS } from "./app-local-portable-metadata";
import { prepareOfflineStaff } from "./portable-offline-staff";
import { portableNativeReadiness, PORTABLE_NATIVE_READY_CHANGED } from "./portable-native-client";
import { PORTABLE_POS_CAPABILITIES, type PortablePosCapability } from "./pos-portable-capabilities";

/** Warm original authorized GET resources only; outbox remains the sole writer. */
export async function preparePortableNativeWorkspace(scope: string, capabilities: readonly PortablePosCapability[], current: () => boolean = () => true) {
  const host = getAppLocalHost();
  if (!host.isNative || !current() || !navigator.onLine) return;
  if ((await portableNativeReadiness())?.offlineReady) return;
  for (const [name, rule] of Object.entries(APP_LOCAL_PORTABLE_READS)) {
    if (!current() || !navigator.onLine) return;
    if (capabilities.includes(rule.capability)) await host.read(name, {}, { scope });
  }
  if (current() && capabilities.includes(PORTABLE_POS_CAPABILITIES.checkInUse)) await prepareOfflineStaff(scope, true);
  if (!current()) return;
  await portableNativeReadiness();
  window.dispatchEvent(new Event(PORTABLE_NATIVE_READY_CHANGED));
}
