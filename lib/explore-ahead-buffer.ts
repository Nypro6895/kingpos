"use client";

type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
type Budget = { remaining: number; rearmedAt: number };
const budgets = new Map<string, Budget>();
const MAX_AUTOMATIC_PAGES = 3;

function connection() { return (navigator as Navigator & { connection?: Connection }).connection; }
export function canPrepareExploreAhead() {
  const network = connection();
  return navigator.onLine !== false && document.visibilityState === "visible" && !network?.saveData && !/(^|-)2g$/.test(network?.effectiveType ?? "");
}
export function isExploreAheadCancellation(error: unknown) {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

/** Stages share a small budget. A new cursor or empty page never refills it. */
export function exploreAheadBudget(key: string) {
  let budget = budgets.get(key);
  if (!budget) {
    if (budgets.size >= 24) budgets.delete(budgets.keys().next().value!);
    budget = { remaining: MAX_AUTOMATIC_PAGES, rearmedAt: 0 };
    budgets.set(key, budget);
  }
  return {
    advance(position: number, viewportHeight: number) {
      if (position - budget.rearmedAt < Math.max(160, viewportHeight * .75)) return;
      budget.remaining = MAX_AUTOMATIC_PAGES;
      budget.rearmedAt = position;
    },
    take() { if (!budget.remaining) return false; budget.remaining--; return true; },
  };
}

/** Cancels speculative reads permanently; a later visible opportunity can retry. */
export function watchExploreAheadAvailability(controller: AbortController) {
  const check = () => { if (!canPrepareExploreAhead()) controller.abort(); };
  const network = connection();
  document.addEventListener("visibilitychange", check);
  window.addEventListener("offline", check);
  network?.addEventListener("change", check);
  check();
  return () => {
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("offline", check);
    network?.removeEventListener("change", check);
  };
}
