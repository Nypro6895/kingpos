"use client";

import { useEffect } from "react";

export const POS_SETTINGS_BROADCAST_CHANNEL = "kingpos-pos-settings-updates";
export const POS_SETTINGS_SAVED_STORAGE_KEY = "kingpos-pos-settings-saved-at";

export function SettingsSaveBroadcast({ saved }: { saved?: string }) {
  useEffect(() => {
    if (!saved) {
      return;
    }

    const timestamp = String(Date.now());

    try {
      window.localStorage.setItem(POS_SETTINGS_SAVED_STORAGE_KEY, timestamp);
    } catch {
      // Cross-tab refresh is a convenience only.
    }

    if (typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(POS_SETTINGS_BROADCAST_CHANNEL);
    channel.postMessage({ saved, timestamp, type: "pos-settings-saved" });
    channel.close();
  }, [saved]);

  return null;
}
