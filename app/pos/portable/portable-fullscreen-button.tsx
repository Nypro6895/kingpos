"use client";

import { useCallback, useEffect, useState } from "react";
import { desktopDevice } from "@/lib/portable-device-storage";

function FullscreenIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M8 4H4v4m12-4h4v4M8 20H4v-4m16 0v4h-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function PortableFullscreenButton() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    const native = desktopDevice()?.windowControls;
    const unsubscribe = native?.onFullscreen(setIsFullscreen);
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    const readyTimer = window.setTimeout(() => {
      setIsSupported(Boolean(native || document.documentElement.requestFullscreen));
      if (native) void native.fullscreen().then(setIsFullscreen); else handleFullscreenChange();
    }, 0);

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      unsubscribe?.();
    };
  }, []);

  const enterFullscreen = useCallback(() => {
    const native = desktopDevice()?.windowControls;
    if (native) { void native.fullscreen(true).then(setIsFullscreen); return; }
    const target =
      document.querySelector<HTMLElement>("[data-portable-pos-shell]") ??
      document.documentElement;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void target.requestFullscreen?.().catch(() => undefined);
  }, []);

  if (!isSupported) {
    return null;
  }

  return (
    <button
      aria-label={isFullscreen ? "Exit full view" : "Enter full view"}
      aria-pressed={isFullscreen}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-2 focus-visible:outline-emerald-700"
      data-portable-fullscreen-button
      onClick={enterFullscreen}
      title={isFullscreen ? "Exit full view" : "Full view"}
      type="button"
    >
      <FullscreenIcon />
    </button>
  );
}
