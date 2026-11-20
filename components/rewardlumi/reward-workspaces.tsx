"use client";

import Link from "next/link";
import { BookingRewardEstimate } from "./booking-reward-pending";
import { useRef } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { rewardEarnLines } from "@/lib/reward-discovery";
import { rewardWalletBalanceLine, rewardWalletOffer } from "@/lib/reward-wallet";
import { rewardMoney, type RewardTransport, type RewardView } from "@/types/rewardlumi";
import { useRewardWallet } from "./use-reward-wallet";
import { useRewardWalletAnchor } from "./use-reward-wallet-anchor";
import styles from "./reward-wallet.module.css";
export { RewardOwnerSetup as RewardOwner } from "./reward-owner-setup";

export function RewardWallet({ viewerId, transport, anchorPath, backHref = "/more" }: { viewerId?: string; transport?: RewardTransport; anchorPath?: string; backHref?: "/beauty" | "/more" }) {
  const root = useRef<HTMLElement>(null);
  const scope = useExperienceScope();
  const wallet = useRewardWallet({ viewerId, transport });
  useRewardWalletAnchor({ root, salonIds: wallet.cards?.map(card => card.salonId) ?? [],
    identity: (scope?.context.scope ?? "personal") + ":" + (viewerId ?? scope?.context.viewerId ?? "session"),
    enabled: wallet.allowed && !wallet.invalidated, path: anchorPath });
  return <main ref={root} className={styles.page} data-reward-wallet>
    <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-orange" href={backHref}>← {backHref === "/beauty" ? "Back to Beauty" : "Back to More"}</Link>
    <header className={styles.header}><div><span className={styles.eyebrow}>A little extra, just for you</span><h1>My Rewards</h1><p>Your points stay with the salon where you earned them.</p></div><Link className={styles.discover} href="/explore">Explore salons <span aria-hidden="true">↗</span></Link></header>
    {wallet.error && <div role="alert" className={styles.error}><p>{wallet.error}{wallet.cards ? " Showing your last update." : ""}</p>{!wallet.invalidated && <button type="button" disabled={wallet.loading} onClick={() => void wallet.refresh()}>Try again</button>}</div>}
    {wallet.loading && !wallet.cards && <div className={styles.loading} role="status">Loading your salon rewards…</div>}
    {wallet.cards?.length === 0 && !wallet.uncreditedVisits.length && <section className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">✦</span><h2>Your next visit can bring a little extra.</h2><p>Find a salon with rewards. Use your linked account when you visit to earn on qualifying activity.</p><Link href="/explore" className={styles.primary}>Discover salon rewards <span aria-hidden="true">→</span></Link><p className={styles.note}>Each salon has its own rewards and terms.</p></section>}
    {wallet.uncreditedVisits.map(item=><section key={item.salonId} className={styles.empty}><h2>{item.salonName}</h2><p>{item.visits} {item.visits===1?"visit":"visits"} linked to your account.</p><p>{item.reason}</p><Link href="/activity">Review visits</Link></section>)}
    <div className={styles.list}>{wallet.cards?.map(card => <SalonRewards key={card.salonId} card={card}/>)}</div>
    {Boolean(wallet.cards?.length) && <p className={styles.bottomNote}>Points are kept separately at each salon. Pending or held points are not included in your available balance.</p>}
  </main>;
}

function SalonRewards({ card }: { card: RewardView }) {
  const next = rewardWalletOffer(card), balanceLine = rewardWalletBalanceLine(card);
  return <section className={styles.card} id={`salon-${card.salonId}`} aria-labelledby={`reward-name-${card.salonId}`} data-reward-salon={card.salonId}>
    <div className={styles.cardTop}><div className={styles.points}><strong>{card.available.toLocaleString("en-US")}</strong><span>points available</span></div><span className={styles.gift} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 10h16v11H4zM3 6h18v4H3zM12 6v15"/><path d="M12 6H8.5a2.5 2.5 0 1 1 2.4-3.2L12 6Zm0 0h3.5a2.5 2.5 0 1 0-2.4-3.2L12 6Z"/></svg></span></div>
    <h2 id={`reward-name-${card.salonId}`}>{card.salonName}</h2>
    {balanceLine && <p className={styles.balanceNote}>{balanceLine}</p>}
    {card.pendingBookings?.map(reward => <div key={reward.bookingId}><BookingRewardEstimate reward={reward}/><Link className={styles.salonLink} href={`/my-bookings?details=${encodeURIComponent(reward.bookingId)}`}>View appointment</Link></div>)}
    {!card.enabled && <p className={styles.paused}>New earning paused · your points are kept.</p>}
    {next ? <div className={styles.nextReward}>
      <p>{next.remaining ? <><strong>{next.remaining.toLocaleString("en-US")} more points</strong> for {next.offer.title}</> : <><span className={styles.readyDot} aria-hidden="true"/>Enough points for <strong>{next.offer.title}</strong></>}</p>
      {next.remaining > 0 && <div className={styles.progress} role="progressbar" aria-label={`Points toward ${next.offer.title}`} aria-valuemin={0} aria-valuemax={next.offer.points} aria-valuenow={Math.min(card.available, next.offer.points)}><span style={{ width: `${next.progress}%` }}/></div>}
      <small>On a qualifying visit{next.offer.minimumCents > 0 ? ` · ${rewardMoney(next.offer.minimumCents)} minimum in eligible services` : ""}</small>
    </div> : <p className={styles.balanceNote}>Your balance is saved. Check with the salon for its current rewards.</p>}
    <details className={styles.details}><summary><span>View rewards &amp; details</span><span className={styles.chevron} aria-hidden="true">⌄</span></summary>
      <div className={styles.detailBody}>
        {card.offers.length > 0 && <div className={styles.offers}><h3>Rewards at this salon</h3>{card.offers.map(offer => <div className={styles.offer} key={offer.id}><div><strong>{offer.title}</strong><p>{offer.minimumCents > 0 ? `${rewardMoney(offer.minimumCents)} minimum in eligible services` : "Eligible services only"}</p></div><span>{offer.points.toLocaleString("en-US")} pts</span></div>)}</div>}
        <Link href="/qr" className={styles.primary}>Show My QR <span aria-hidden="true">→</span></Link>
        <p className={styles.note}>At the salon, open your current visit to choose and confirm a reward before payment. The reward applies only when your visit qualifies and is paid.</p>
        <details className={styles.secondaryDetails}><summary>How to earn &amp; use points</summary><div>
          {card.program?.enabled ? <ul>{rewardEarnLines(card.program).map(line => <li key={line}>{line}.</li>)}</ul> : <p>New earning is paused at this salon. Your existing balance and confirmed rewards are kept.</p>}
          <p>Points work only at {card.salonName}. Pending points cannot be used. Held points are already set aside for a confirmed visit.</p>
          <p>Posting or sharing alone earns no points. Your current visit and the salon’s terms determine whether a reward can be used.</p>
        </div></details>
        <details className={styles.secondaryDetails}><summary>Point history</summary><div>{card.history?.length ? card.history.map(row => <div className={styles.history} key={row.id}><div><span>{row.reason}</span><small>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(row.at))}</small></div><strong>{row.delta > 0 ? "+" : ""}{row.delta.toLocaleString("en-US")}</strong></div>) : <p className={styles.note}>No point activity yet.</p>}</div></details>
        <Link className={styles.salonLink} href={`/explore/salons/${card.salonId}`}>View salon <span aria-hidden="true">↗</span></Link>
      </div>
    </details>
  </section>;
}
