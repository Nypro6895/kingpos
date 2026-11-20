import type { PosLiveDraftView } from "@/types/pos-desk";
import type { RewardView } from "@/types/rewardlumi";
import type { GiftSession } from "@/types/gift-card";

const cents = (value: number) => Math.round(value * 100);

export function completedCustomerCheckoutView(draft:PosLiveDraftView|null,gift:GiftSession|null) {
  const settled=draft?.status === "closed" ? draft.settled_receipt ?? (gift?.status === "completed" && !!gift.completedDraftId && gift.completedDraftId === draft.id && gift.completedReceiptVersion === draft.receipt_version && gift.completedCustomerVersion === draft.customer_version ? {ticketNumber:gift.ticketNumber,giftPurchaseCents:gift.purchase,giftPaidCents:gift.amount} : undefined) : undefined;
  return {settled,total:cents(draft?.total??0)+(settled?.giftPurchaseCents??0)};
}

/** Presentation only. The live receipt and server preview remain authoritative. */
export function customerCheckoutView(draft: PosLiveDraftView | null, reward: RewardView | null, gift: GiftSession | null, now = Date.now()) {
  const discount = Math.max(0, cents(draft?.discount ?? 0));
  const selectedReward = reward?.request?.status === "confirmed" ? reward.request.valueCents : 0;
  // A customer can confirm before POS has published the updated receipt.
  const rewardDiscount = selectedReward > 0 && discount >= selectedReward ? selectedReward : 0;
  const receiptTotal = cents(draft?.total ?? 0);
  const currentGift = gift?.status === "open" && Date.parse(gift.expires) > now && gift.total === receiptTotal ? gift : null;
  const giftAmount = currentGift?.approved ? Math.max(0, Math.min(currentGift.amount, receiptTotal)) : 0;
  const giftPurchase = Math.max(0, currentGift?.purchase ?? 0);
  const estimate = reward?.checkout;
  const estimateMatches = !!draft && !!estimate && estimate.customerId === draft.customer?.id
    && estimate.subtotalCents === cents(draft.subtotal) && estimate.discountCents === discount
    && estimate.tipCents === cents(draft.tip) && estimate.totalCents === receiptTotal
    && estimate.giftCents === giftAmount && estimate.rewardValueCents === rewardDiscount;
  return {
    discount: discount - rewardDiscount, rewardDiscount, giftAmount, giftPurchase,
    amountDue: receiptTotal + giftPurchase - giftAmount,
    estimatedPoints: estimateMatches && estimate.earningEnabled ? estimate.points : null,
  };
}
