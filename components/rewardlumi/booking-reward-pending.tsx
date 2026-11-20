"use client";

import type { PendingBookingReward, RewardView } from "@/types/rewardlumi";
import { useRewardWallet } from "./use-reward-wallet";
import styles from "./booking-reward-pending.module.css";

export function findBookingReward(cards: RewardView[] | null, bookingId: string) {
  return cards?.flatMap(card => card.pendingBookings ?? []).find(row => row.bookingId === bookingId);
}

export function BookingRewardEstimate({ reward, compact = false }: { reward?: PendingBookingReward; compact?: boolean }) {
  if (!reward || reward.points <= 0) return null;
  const label = `+${reward.points.toLocaleString("en-US")} points pending`;
  if (compact) return <span className={styles.compact}>{label} · estimated</span>;
  return <div className={styles.notice} role="status">
    <strong>{label}</strong>
    <p>Estimated reward for this appointment. Earn after eligible services are completed and paid.</p>
    <small>{reward.firstBookingPoints > 0 ? `Includes ${reward.firstBookingPoints.toLocaleString("en-US")} first paid booking bonus. ` : ""}Final points depend on the salon’s terms and eligible payment. Pending points cannot be used.</small>
  </div>;
}

/** Uses the existing identity-scoped private wallet; never guesses client points. */
export function BookingRewardPending({ bookingId, enabled = true }: { bookingId: string; enabled?: boolean }) {
  const wallet = useRewardWallet({ enabled });
  return <BookingRewardEstimate reward={wallet.error || wallet.invalidated ? undefined : findBookingReward(wallet.cards, bookingId)}/>;
}
