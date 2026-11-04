export const developerPanels = ["overview", "developer", "account", "testing", "commerce", "review", "finance"] as const;
export const standardDeveloperPanels: readonly string[] = developerPanels.filter(panel => panel !== "review" && panel !== "finance");
export type DeveloperLanguage = "en" | "vi";
export function developerLanguage(value: unknown): DeveloperLanguage { return value === "vi" ? "vi" : "en"; }
export function developerPanel(value: unknown, available: readonly string[] = developerPanels): string {
  return typeof value === "string" && developerPanels.some(panel => panel === value) && available.includes(value) ? value : "overview";
}
export function readDeveloperLocation(search: string, available: readonly string[] = developerPanels) {
  const params = new URLSearchParams(search);
  return { panel: developerPanel(params.get("panel"), available), language: developerLanguage(params.get("lang")) };
}
export function developerPanelHref(panel: string, language: DeveloperLanguage, saved = false) {
  const query = new URLSearchParams({ panel: developerPanel(panel), lang: developerLanguage(language) });
  if (saved) query.set("saved", "1");
  return "/developer-platform?" + query;
}
/** Presentation state only; a previous successful-save notice is one use. */
export function developerHistoryUrl(base: string, panel: string, language: DeveloperLanguage) {
  const url = new URL(base);
  url.searchParams.set("panel", developerPanel(panel));
  url.searchParams.set("lang", developerLanguage(language));
  url.searchParams.delete("saved");
  return url;
}
