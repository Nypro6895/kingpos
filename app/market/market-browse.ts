export const MARKET_CATEGORIES = ["All features", "Customer care", "Payroll", "Payments", "Operations", "Marketing", "Commerce", "Reporting"] as const;
export type MarketBrowse = { query: string; category: typeof MARKET_CATEGORIES[number] };
type StartupDraft = { browse: MarketBrowse; href: string; scope?: string; focused: boolean; selectionStart: number | null; selectionEnd: number | null; savedAt: number };
let startupDraft: StartupDraft | undefined;
let listeningForReset = false;

function listenForReset() {
  if (typeof window === "undefined" || listeningForReset) return;
  listeningForReset = true;
  window.addEventListener("reylumi:experience-reset", clearMarketStartupDraft);
}

export function clearMarketStartupDraft() { startupDraft = undefined; }

export function rememberMarketStartupDraft(browse: MarketBrowse, options: { scope?: string; focused?: boolean; selectionStart?: number | null; selectionEnd?: number | null } = {}) {
  if (typeof window === "undefined") return;
  listenForReset();
  startupDraft = { browse: { query: browse.query.slice(0, 200), category: browse.category }, href: window.location.pathname + window.location.search,
    scope: options.scope, focused: options.focused === true, selectionStart: options.selectionStart ?? null, selectionEnd: options.selectionEnd ?? null, savedAt: Date.now() };
}

/** Single-use UI intent, never persisted or shared with a different route/viewer. */
export function takeMarketStartupDraft(scope?: string): StartupDraft | undefined {
  if (typeof window === "undefined") return;
  listenForReset();
  const draft = startupDraft;
  startupDraft = undefined;
  if (!draft || draft.href !== window.location.pathname + window.location.search ||
      (draft.scope !== undefined && draft.scope !== scope) || Date.now() - draft.savedAt > 60_000 || Date.now() < draft.savedAt) return;
  return draft;
}

export function marketBrowseFromQuery(query: { q?: unknown; category?: unknown }): MarketBrowse | undefined {
  if (query.q === undefined && query.category === undefined) return undefined;
  return {
    query: typeof query.q === "string" ? query.q.slice(0, 200) : "",
    category: MARKET_CATEGORIES.find(category => category === query.category) ?? "All features",
  };
}
