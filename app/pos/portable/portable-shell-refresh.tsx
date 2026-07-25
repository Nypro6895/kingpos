"use client";

import {
  POS_SETTINGS_BROADCAST_CHANNEL,
  POS_SETTINGS_SAVED_STORAGE_KEY,
} from "@/app/pos/settings/settings-save-broadcast";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function PortableShellRefresh() {
  const router = useRouter();

  useEffect(() => {
    function refresh() {
      router.refresh();
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }

    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(POS_SETTINGS_BROADCAST_CHANNEL);

    channel?.addEventListener("message", refresh);

    function refreshFromStorage(event: StorageEvent) {
      if (event.key === POS_SETTINGS_SAVED_STORAGE_KEY) {
        refresh();
      }
    }

    window.addEventListener("storage", refreshFromStorage);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      channel?.removeEventListener("message", refresh);
      channel?.close();
      window.removeEventListener("storage", refreshFromStorage);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [router]);

  return null;
}
