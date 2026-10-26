"use client";

import { useEffect, useRef } from "react";

/** Signal a painted, interactive frame, rather than every image finishing. */
export function StartupReady() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const mounted = marker.current;
    let active = true;
    let second: number | undefined;
    let task: ReturnType<typeof setTimeout> | undefined;
    let paint: PerformanceObserver | undefined;
    const ready = () => {
      if (!active || !mounted) return;
      paint?.disconnect();
      mounted.dataset.reylumiShellReady = "true";
      window.dispatchEvent(new Event("reylumi:screen-ready"));
    };
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        // RAF callbacks precede rendering. A following task lets the browser
        // submit that frame; supported browsers also confirm the actual paint.
        task = setTimeout(() => {
          if (!active) return;
          if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("paint")) { ready(); return; }
          if (performance.getEntriesByName("first-contentful-paint").length) { ready(); return; }
          try {
            paint = new PerformanceObserver(entries => { if (entries.getEntriesByName("first-contentful-paint").length) ready(); });
            paint.observe({ type: "paint", buffered: true });
          } catch { ready(); }
        }, 0);
      });
    });
    return () => {
      active = false; cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second);
      if (task !== undefined) clearTimeout(task); paint?.disconnect();
      if (mounted) mounted.dataset.reylumiShellReady = "false";
    };
  }, []);
  return <span ref={marker} data-reylumi-shell-ready="false" hidden aria-hidden="true" />;
}
