import type { RewardOffer, RewardView } from "@/types/rewardlumi";

/** The wallet RPC orders membership time, never points or last activity. */
export function rewardWalletCards(cards: RewardView[]): RewardView[] {
  return cards.map((card, index) => ({ card, index, time: Date.parse(card.joinedAt ?? "") }))
    .sort((a, b) => {
      const left = Number.isFinite(a.time) ? a.time : -Infinity;
      const right = Number.isFinite(b.time) ? b.time : -Infinity;
      // Preserve authoritative SQL order for sub-millisecond or missing dates.
      return left === right ? a.index - b.index : right > left ? 1 : -1;
    }).map(item => item.card);
}

export function newestRewardMembership(cards: RewardView[]): RewardView | null {
  // An older server without membership dates must not mislabel a random salon.
  if (cards.some(card => !Number.isFinite(Date.parse(card.joinedAt ?? "")))) return null;
  return rewardWalletCards(cards)[0] ?? null;
}

export function rewardWalletOffer(card: RewardView): { offer: RewardOffer; remaining: number; progress: number } | null {
  const offers = card.offers.filter(offer => Number.isSafeInteger(offer.points) && offer.points > 0 && offer.valueCents > 0);
  offers.sort((a, b) => a.points - b.points || a.id.localeCompare(b.id));
  const offer = offers[0];
  if (!offer) return null;
  return { offer, remaining: Math.max(0, offer.points - card.available), progress: Math.min(100, Math.max(0, card.available / offer.points * 100)) };
}

export function validateRewardWallet(cards: unknown): asserts cards is RewardView[] {
  if (!Array.isArray(cards) || cards.some(card => !card || typeof card.salonId !== "string" || typeof card.salonName !== "string"
    || typeof card.enabled !== "boolean"
    || ![card.available, card.pending, card.reserved].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Array.isArray(card.offers) || card.offers.some((offer: RewardOffer) => !offer || typeof offer.id !== "string" || typeof offer.title !== "string"
      || ![offer.points, offer.valueCents, offer.minimumCents].every(value => Number.isSafeInteger(value) && value >= 0))
    || (card.history && (!Array.isArray(card.history) || card.history.some((row: { id: unknown; reason: unknown; at: string; delta: number }) => !row || typeof row.id !== "string" || typeof row.reason !== "string" || !Number.isFinite(Date.parse(row.at)) || !Number.isSafeInteger(row.delta)))))) throw new Error("Your rewards could not be updated. Please try again.");
}

export function rewardWalletBalanceLine(card: RewardView): string {
  return [card.pending > 0 ? `${card.pending.toLocaleString("en-US")} pending` : "", card.reserved > 0 ? `${card.reserved.toLocaleString("en-US")} held for a visit` : ""].filter(Boolean).join(" · ");
}
