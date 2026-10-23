"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

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
/** Optional collections start after the core has painted and their own region is visible. */
export function useExploreVisibleAfterFirstContent(ref: RefObject<HTMLElement | null>) {
  const [enabled, setEnabled] = useState(false);
  useLayoutEffect(() => {
    let activated = false;
    const update = () => {
      const node = ref.current;
      if (activated || !firstScreenReady() || !node?.getClientRects().length) return;
      const bounds = node.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= innerHeight) return;
      activated = true;
      setEnabled(true);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(update, { rootMargin: "0px" });
    if (ref.current) observer?.observe(ref.current);
    update();
    window.addEventListener("reylumi:screen-ready", update);
    window.addEventListener("reylumi:first-content-ready", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener("reylumi:screen-ready", update); window.removeEventListener("reylumi:first-content-ready", update); window.removeEventListener("scroll", update); };
  }, [ref]);
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
