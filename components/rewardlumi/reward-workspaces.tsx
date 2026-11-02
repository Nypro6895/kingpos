"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { rewardEarnLines } from "@/lib/reward-discovery";
import { rewardMoney, type RewardReply, type RewardTransport } from "@/types/rewardlumi";
import styles from "./rewardlumi.module.css";
export { RewardOwnerSetup as RewardOwner } from "./reward-owner-setup";
export function RewardWallet({ transport }: { transport?: RewardTransport }) {
  const send = useMemo(() => transport ?? rewardTransport("personal"), [transport]);
  const [data, setData] = useState<RewardReply | null>(null), [error, setError] = useState("");
  useEffect(() => { let alive = true; const load = () => send("wallet").then(d => { if (alive) { setData(d); setError(""); } }).catch(e => { if (alive) setError(e.message); }); void load(); const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000); return () => { alive = false; clearInterval(t); }; }, [send]);
  return <main className={styles.page} data-reward-wallet><h1>My Rewards</h1><p className={styles.muted}>Your points and rewards at each salon.</p>{error && <p role="alert" className={styles.error}>{error}</p>}
    {!data && !error && <p>Loading rewards…</p>}{data?.cards?.length === 0 && <section className={styles.panel}><h2>Start with a participating salon</h2><p>Choose a local salon with rewards, then check in using your linked personal account. Eligible activity earns points at that salon; available points can be used on a qualifying visit.</p><Link href="/explore">Find local rewards</Link></section>}
    {data?.cards?.map(card => <section className={styles.panel} key={card.salonId}><h2>{card.salonName}</h2><div className={styles.summary}><span><strong>{card.available}</strong>Available</span><span><strong>{card.pending}</strong>Pending</span>{card.reserved > 0 && <span><strong>{card.reserved}</strong>Reserved</span>}</div>
      {card.offers.map(offer => <div className={styles.row} key={offer.id}><span>{offer.title}<small className={styles.muted}> · minimum {rewardMoney(offer.minimumCents)}</small></span><strong>{offer.points} pts</strong></div>)}
      <Link href="/qr" className={styles.primary}>Use during your visit</Link>
      <details><summary>Ways to earn</summary>{card.program?.enabled?<ul>{rewardEarnLines(card.program).map(line=><li key={line}>{line}.</li>)}</ul>:<p>New earning is paused at this salon. Your existing balance and confirmed rewards are kept.</p>}<p className={styles.muted}>Pending points cannot be spent. Posting or sharing alone earns no points.</p></details>
      <details><summary>Point history</summary>{card.history?.map(row => <div className={styles.row} key={row.id}><span>{row.reason}<br /><small className={styles.muted}>{new Date(row.at).toLocaleDateString()}</small></span><strong>{row.delta > 0 ? "+" : ""}{row.delta}</strong></div>)}</details>
    </section>)}</main>;
}
