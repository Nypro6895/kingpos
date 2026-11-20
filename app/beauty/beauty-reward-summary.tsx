"use client";

import Link from "next/link";
import { useRewardWallet } from "@/components/rewardlumi/use-reward-wallet";
import { newestRewardMembership, rewardWalletBalanceLine } from "@/lib/reward-wallet";
import type { RewardTransport } from "@/types/rewardlumi";
import styles from "./beauty-reward-summary.module.css";

export function BeautyRewardSummary({ viewerId, transport }: { viewerId: string | null; transport?: RewardTransport }) {
  const wallet = useRewardWallet({ viewerId, transport, enabled: Boolean(viewerId) });
  const salon = newestRewardMembership(wallet.cards ?? []);
  const detail = salon ? `/rewards#salon-${salon.salonId}` : "/rewards";
  return <section className={styles.summary} aria-label="My rewards" data-beauty-rewards>
    <div className={styles.heading}><h2><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M12 2c1.7 6.3 3.7 8.3 10 10-6.3 1.7-8.3 3.7-10 10C10.3 15.7 8.3 13.7 2 12c6.3-1.7 8.3-3.7 10-10Z"/></svg>My Rewards</h2><Link href={viewerId ? "/rewards?from=beauty" : "/login?next=%2Frewards"}>View all <span aria-hidden="true">›</span></Link></div>
    {!viewerId ? <div className={styles.empty}><p>Keep your salon rewards in one place.</p><Link href="/login?next=%2Frewards">Sign in to view rewards <span aria-hidden="true">→</span></Link></div>
      : wallet.error ? <div className={styles.empty} role="status"><p>{wallet.invalidated ? wallet.error : "Rewards are unavailable right now."}</p>{!wallet.invalidated && <button type="button" disabled={wallet.loading} onClick={() => void wallet.refresh()}>Try again</button>}</div>
      : wallet.loading && !wallet.cards ? <div className={styles.loading} role="status">Loading your rewards…</div>
      : salon ? <Link className={styles.balance} href={detail.replace("/rewards", "/rewards?from=beauty")} aria-label={`${salon.available} available points at ${salon.salonName}. View your rewards.`}>
        <div className={styles.metrics}>
          <div className={styles.points}><strong>{salon.available.toLocaleString("en-US")}</strong><span>points available</span></div>
          {rewardWalletBalanceLine(salon) && <span className={styles.pending}>{rewardWalletBalanceLine(salon)}</span>}
        </div>
        <div className={styles.salon}><span className={styles.latest}>Latest salon joined</span><span className={styles.name}>{salon.salonName}</span>{!salon.enabled && <small>New earning paused · your points are kept</small>}</div>
        <span className={styles.arrow} aria-hidden="true">›</span>
      </Link> : <div className={styles.empty}><p>{wallet.cards?.length ? "Your points stay with each salon." : "Your next salon visit can bring a little extra."}</p><Link href={wallet.cards?.length ? "/rewards?from=beauty" : "/explore"}>{wallet.cards?.length ? "View your salon rewards" : "Discover salon rewards"} <span aria-hidden="true">→</span></Link></div>}
  </section>;
}
