"use client";

import { useEffect, useRef } from "react";
import { useExplorePrefetchDistance } from "@/lib/explore-viewport-priority";

/** Mount with the rendered results, even when their data was ready earlier. */
export function ExploreAutoLoad({ enabled = true, onLoad, progressKey, distance }: {
  enabled?: boolean;
  onLoad: () => void;
  progressKey?: string | number | null;
  distance?: number;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const adaptiveDistance = useExplorePrefetchDistance();
  const margin = Math.min(distance ?? adaptiveDistance, adaptiveDistance);
  useEffect(() => {
    const node = anchor.current;
    if (!enabled || !node) return;
    let requested = false;
    let frame = 0;
    const check = () => {
      frame = 0;
      if (requested || document.visibilityState === "hidden" || !node.getClientRects().length) return;
      const bounds = node.getBoundingClientRect();
      if (bounds.top <= window.innerHeight + margin && bounds.bottom >= -margin) {
        requested = true;
        onLoad();
      }
    };
    const schedule = () => { if (!frame && !requested) frame = requestAnimationFrame(check); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(schedule, { rootMargin: `${margin}px 0px` });
    observer?.observe(node);
    // Also handle nested/mobile scrolling and browsers without IntersectionObserver.
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [enabled, onLoad, progressKey, margin]);
  return <div ref={anchor} aria-hidden="true" className="h-px w-full" data-testid="explore-auto-load" />;
}
