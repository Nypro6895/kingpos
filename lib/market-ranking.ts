export type MarketRankable = { id: string; publisher?: string; available?: boolean };

// Stable ties preserve the catalog's editorial order.
export function rankMarketApps<T extends MarketRankable>(apps: readonly T[], installations: Record<string, number> = {}): T[] {
  const count = (id: string) => Number.isFinite(installations[id]) ? Math.max(0, installations[id]) : 0;
  return [...apps].sort((a, b) =>
    count(b.id) - count(a.id) ||
    Number(Boolean(b.available)) - Number(Boolean(a.available)) ||
    Number(Boolean(b.available) && b.publisher?.toLowerCase() === "reylumi") - Number(Boolean(a.available) && a.publisher?.toLowerCase() === "reylumi")
  );
}
