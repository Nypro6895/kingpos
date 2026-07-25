"use client";

import { useCallback, useEffect, useState } from "react";

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
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    const readyTimer = window.setTimeout(() => {
      setIsSupported(Boolean(document.documentElement.requestFullscreen));
      handleFullscreenChange();
    }, 0);

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const enterFullscreen = useCallback(() => {
    const target =
      document.querySelector<HTMLElement>("[data-portable-pos-shell]") ??
      document.documentElement;

    if (document.fullscreenElement) {
      return;
    }

    void target.requestFullscreen?.().catch(() => undefined);
  }, []);

  if (!isSupported || isFullscreen) {
    return null;
  }

  return (
    <button
      aria-label="Enter full view"
      className="fixed bottom-4 right-4 z-30 grid h-12 w-12 place-items-center rounded-full border border-zinc-950/15 bg-white/88 text-zinc-950 shadow-[0_14px_36px_rgba(15,23,42,0.22)] backdrop-blur-md transition hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-500/25"
      data-portable-fullscreen-button
      onClick={enterFullscreen}
      title="Full view"
      type="button"
    >
      <FullscreenIcon />
    </button>
  );
}
