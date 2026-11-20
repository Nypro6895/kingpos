/** Installed navigation acknowledges only the exact form/attempt it owns. */
export const APP_LOCAL_SEARCH_NAVIGATION_EVENT = "reylumi:app-local-search-navigation";

export type AppLocalSearchNavigationDetail = {
  phase: "start" | "complete";
  attempt: string;
  destination: string;
  accepted?: boolean;
};

export function appLocalSearchNavigationDetail(event: Event): AppLocalSearchNavigationDetail | null {
  const value = (event as CustomEvent<AppLocalSearchNavigationDetail>).detail;
  return value && (value.phase === "start" || value.phase === "complete")
    && typeof value.attempt === "string" && /^search-\d+$/.test(value.attempt)
    && typeof value.destination === "string" && value.destination.startsWith("/") && !value.destination.startsWith("//")
    ? value : null;
}
