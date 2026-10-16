const PREFIX = "kingpos:portable-draft:v1:";

export function isNativePortableDevice(): boolean {
  const device = window as unknown as { __reylumiNativePayments?: number; webkit?: { messageHandlers?: { reylumi?: unknown } } };
  return device.__reylumiNativePayments === 1 && Boolean(device.webkit?.messageHandlers?.reylumi);
}

/** Browser tabs stay independent; an installed app must survive a new WebView. */
export function portableRecoveryStorageKey({ scope, operationScope, tabId, desktop, native, storage }: {
  scope: string; operationScope?: string; tabId: string; desktop: boolean; native: boolean;
  storage: Pick<Storage, "getItem" | "setItem">;
}) {
  if (desktop && operationScope) return PREFIX + operationScope + ":desktop";
  const legacy = PREFIX + scope + ":" + tabId;
  if (!native) return legacy;
  const slot = "kingpos:portable-native-recovery:v1:" + scope;
  const previous = storage.getItem(slot);
  if (previous?.startsWith(PREFIX + scope + ":") && previous.length <= 2048) return previous;
  // Keep the original key/checkpoint when upgrading an already open ticket.
  // Never guess among another window's old drafts or delete unsubmitted work.
  const key = storage.getItem(legacy) ? legacy : PREFIX + scope + ":native";
  storage.setItem(slot, key);
  return key;
}

/** Native windows sharing a recovery slot must not overwrite each other's work. */
export async function acquirePortableRecoveryWriter(key: string): Promise<(() => void) | null> {
  if (!navigator.locks) return null;
  return new Promise(resolve => {
    void navigator.locks.request("kingpos:native-draft:" + key, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(null); return; }
      let release!: () => void;
      const released = new Promise<void>(done => { release = done; });
      resolve(release);
      await released;
    }).catch(() => resolve(null));
  });
}
