"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { canPrepareExploreAhead } from "@/lib/explore-ahead-buffer";

export function exploreAheadDistance(viewportHeight: number, fallback: number, allowed: boolean) {
  return allowed ? Math.max(fallback, viewportHeight * 2.5) : fallback;
}

/** First paint stays first; then prepare a bounded spatial buffer, even while idle. */
export function useExploreAheadDistance() {
  const fallback = useExplorePrefetchDistance();
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    const update = () => setDistance(firstScreenReady()
      ? exploreAheadDistance(window.innerHeight, fallback, canPrepareExploreAhead()) : 0);
    const network = (navigator as Navigator & { connection?: EventTarget }).connection;
    update();
    for (const event of ["reylumi:screen-ready", "reylumi:first-content-ready", "resize", "online", "offline"]) window.addEventListener(event, update);
    document.addEventListener("visibilitychange", update);
    network?.addEventListener("change", update);
    return () => {
      for (const event of ["reylumi:screen-ready", "reylumi:first-content-ready", "resize", "online", "offline"]) window.removeEventListener(event, update);
      document.removeEventListener("visibilitychange", update);
      network?.removeEventListener("change", update);
    };
  }, [fallback]);
  return distance;
}

let observedLoadMs = 0;
export function recordExploreLoadDuration(ms: number) {
  if (Number.isFinite(ms) && ms >= 0) observedLoadMs = observedLoadMs ? observedLoadMs * .6 + ms * .4 : ms;
  if (typeof window !== "undefined" && firstScreenReady()) window.dispatchEvent(new Event("reylumi:first-content-ready"));
}
export function explorePrefetchPolicy({ width = 390, loadMs = observedLoadMs, saveData = false, effectiveType = "" }: { width?: number; loadMs?: number; saveData?: boolean; effectiveType?: string } = {}) {
  if (saveData || /(^|-)2g$/.test(effectiveType) || loadMs >= 1400) return { distance: 140, limit: 4 };
  if (loadMs >= 700) return { distance: 320, limit: 6 };
  if (loadMs > 0 && loadMs < 700) return { distance: 900, limit: 12 };
  return { distance: width < 768 ? 320 : 480, limit: 8 };
}
export function currentExplorePrefetchPolicy() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return explorePrefetchPolicy({ width: window.innerWidth, saveData: connection?.saveData, effectiveType: connection?.effectiveType });
}
function firstScreenReady() {
  return Boolean(document.querySelector('[data-reylumi-shell-ready="true"]') && Array.from(document.querySelectorAll<HTMLElement>('[data-explore-first-content-ready="true"]')).some(node => node.getClientRects().length));
}
export function useExplorePrefetchDistance() {
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    const update = () => setDistance(firstScreenReady() ? currentExplorePrefetchPolicy().distance : 0);
    update();
    window.addEventListener("reylumi:screen-ready", update);
    window.addEventListener("reylumi:first-content-ready", update);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("reylumi:screen-ready", update); window.removeEventListener("reylumi:first-content-ready", update); window.removeEventListener("resize", update); };
  }, []);
  return distance;
}
/** Optional collections start after core paint and within the prepared buffer. */
export function useExploreVisibleAfterFirstContent(ref: RefObject<HTMLElement | null>) {
  const distance = useExploreAheadDistance();
  const [enabled, setEnabled] = useState(false);
  useLayoutEffect(() => {
    let activated = false;
    const update = () => {
      const node = ref.current;
      if (activated || !firstScreenReady() || !node?.getClientRects().length) return;
      const bounds = node.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= innerHeight + distance) return;
      activated = true;
      setEnabled(true);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(update, { rootMargin: `${distance}px` });
    if (ref.current) observer?.observe(ref.current);
    update();
    window.addEventListener("reylumi:screen-ready", update);
    window.addEventListener("reylumi:first-content-ready", update);
    document.addEventListener("scroll", update, { capture: true, passive: true });
    return () => { observer?.disconnect(); window.removeEventListener("reylumi:screen-ready", update); window.removeEventListener("reylumi:first-content-ready", update); document.removeEventListener("scroll", update, true); };
  }, [ref, distance]);
  return enabled;
}
export function useExploreFirstContentPaint(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const mounted = ref.current;
    let first = 0, second = 0;
    first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      const node = mounted;
      if (!node?.getClientRects().length) return;
      node.dataset.exploreFirstContentReady = "true";
      window.dispatchEvent(new Event("reylumi:first-content-ready"));
    }); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); if (mounted) delete mounted.dataset.exploreFirstContentReady; };
  }, [ref]);
}
