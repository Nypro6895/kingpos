"use client";

import { useEffect, useRef } from "react";
import { useExplorePrefetchDistance } from "@/lib/explore-viewport-priority";
import { canPrepareExploreAhead, exploreAheadBudget } from "@/lib/explore-ahead-buffer";

/** Mount with the rendered results, even when their data was ready earlier. */
export function ExploreAutoLoad({ enabled = true, onLoad, progressKey, distance, prepareAheadKey }: {
  enabled?: boolean;
  onLoad: (options?: { background?: boolean }) => void;
  progressKey?: string | number | null;
  distance?: number;
  prepareAheadKey?: string;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const adaptiveDistance = useExplorePrefetchDistance();
  const margin = Math.min(distance ?? adaptiveDistance, adaptiveDistance);
  useEffect(() => {
    const node = anchor.current;
    if (!enabled || !node) return;
    let requested = false;
    let frame = 0;
    const advance = () => {
      if (!prepareAheadKey) return;
      let position = window.scrollY;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (parent !== document.scrollingElement) position += parent.scrollTop;
      }
      exploreAheadBudget(prepareAheadKey).advance(position, window.innerHeight);
    };
    const check = () => {
      frame = 0;
      if (requested || navigator.onLine === false || document.visibilityState === "hidden" || !node.getClientRects().length) return;
      const bounds = node.getBoundingClientRect();
      advance();
      const ahead = Boolean(prepareAheadKey && canPrepareExploreAhead());
      const horizon = ahead ? Math.max(margin, window.innerHeight * 2.5) : margin;
      if (bounds.top <= window.innerHeight + horizon && bounds.bottom >= -margin) {
        if (prepareAheadKey && !exploreAheadBudget(prepareAheadKey).take()) return;
        requested = true;
        onLoad({ background: ahead && bounds.top > window.innerHeight });
      }
    };
    const schedule = () => { if (!frame && !requested) frame = requestAnimationFrame(check); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(schedule, { rootMargin: `${margin}px 0px` });
    observer?.observe(node);
    // Also handle nested/mobile scrolling and browsers without IntersectionObserver.
    const scroll = () => {
      advance();
      schedule();
    };
    document.addEventListener("scroll", scroll, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    const network = (navigator as Navigator & { connection?: EventTarget }).connection;
    network?.addEventListener("change", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule);
      network?.removeEventListener("change", schedule);
    };
  }, [enabled, onLoad, progressKey, margin, prepareAheadKey]);
  return <div ref={anchor} aria-hidden="true" className="h-px w-full" data-testid="explore-auto-load" />;
}
