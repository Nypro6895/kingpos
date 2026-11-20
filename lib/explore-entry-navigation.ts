import type { MouseEvent } from "react";
import type { ExploreLocationSource } from "@/types/explore";

export const EXPLORE_HOME_RESET_EVENT = "kingpos:explore-home-reset";

export function exploreHomeUrl(location: string, source: ExploreLocationSource) {
  const params = new URLSearchParams({ browse: "1", location: location.trim() });
  if (location.trim()) params.set("locationSource", source === "none" ? "saved" : source);
  return `/explore?${params}`;
}

// A real document reload is different from router.refresh() and Back navigation.
let checkedDocumentReload = false;
export function consumeExploreDocumentReload() {
  if (checkedDocumentReload) return false;
  checkedDocumentReload = true;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return navigation?.type === "reload" && new URL(navigation.name).pathname === "/explore";
}

export function handleExploreLogoClick(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    || window.location.pathname !== "/explore") return;
  const reset = new CustomEvent(EXPLORE_HOME_RESET_EVENT, { cancelable: true });
  if (!window.dispatchEvent(reset)) event.preventDefault();
}
