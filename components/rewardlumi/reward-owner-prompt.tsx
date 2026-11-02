"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { rewardMoney } from "@/types/rewardlumi";
import styles from "./reward-discovery.module.css";
type Summary = { salonId: string; enabled: boolean; nearby: boolean; located: boolean; usableOffers: number; earning: boolean; discoverable:boolean; reasons:string[]; periodStart:string;periodEnd:string;discountCents:number; members: number; paidConversions: number; rewardUses: number };
export function RewardOwnerPrompt({ setup = false }: { setup?: boolean }) {
  const scope = useExperienceScope();
  return <RewardOwnerPromptReady key={scope?.context.scope ?? "unscoped"} setup={setup} />;
}
function RewardOwnerPromptReady({ setup }: { setup: boolean }) {
  const anchor = useRef<HTMLElement>(null);
  const [data, setData] = useState<Summary | null>(null), [hidden, setHidden] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); let started = false;
    const load = async () => {
      if (started) return; started = true;
      try {
        const response = await fetch("/api/rewards/owner-discovery", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) return;
        const value: Summary = await response.json();
        if (controller.signal.aborted) return;
        try { setHidden(!setup && Number(localStorage.getItem(`reward-owner-prompt:${value.salonId}`)) > Date.now()); } catch { /* Optional preference. */ }
        setData(value);
      } catch { /* Optional guidance never blocks the Owner workspace. */ }
    };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { void load(); observer?.disconnect(); } }, { rootMargin: "100px" });
    if (observer && anchor.current) observer.observe(anchor.current); else void load();
    return () => { controller.abort(); observer?.disconnect(); };
  }, [setup]);
  function dismiss() { setHidden(true); try { if (data) localStorage.setItem(`reward-owner-prompt:${data.salonId}`, String(Date.now() + 7 * 86400000)); } catch { /* Optional. */ } }
  return <section ref={anchor} className={data && !hidden ? styles.group : undefined} aria-label="Grow with rewards">
    {data && !hidden && <><div className={styles.heading}><div><h2>{setup?"Reward activity · last 30 business days":data.discoverable?"Your rewards are visible to local customers":data.enabled?"Your rewards need attention before appearing in Explore":"Help local customers find you and come back"}</h2>{!setup&&<p className={styles.muted}>{data.discoverable?"Nearby customers can discover your rewards in Explore.":data.enabled?data.reasons?.[0]:"Preview your offer, then enable it for local customers in Explore."}</p>}</div>{!setup && <button type="button" onClick={dismiss} className={styles.quiet}>Later</button>}</div>
      {(data.members>0||data.paidConversions>0||data.rewardUses>0)?<><p className={styles.muted}>Program activity across all channels · {data.periodStart} – {data.periodEnd}</p><div className={styles.metrics}><span><strong>{data.members}</strong>New members</span><span><strong>{data.paidConversions}</strong>Paid referral bookings</span><span><strong>{data.rewardUses}</strong>Rewards used</span><span><strong>{rewardMoney(data.discountCents)}</strong>Net reward discounts</span></div><p className={styles.muted}>Reward discounts are already included in ticket totals.</p></>:setup?<p className={styles.muted}>No program activity in this period yet. Results appear after customers participate.</p>:null}
      {!data.located&&data.enabled&&<p className={styles.muted}>Add a map location for distance-based discovery.</p>}
      {!setup && <div className={styles.controls}><Link className={styles.primary} href="/reward-system" prefetch={false}>{data.enabled ? "Manage rewards" : "Preview & set up rewards"}</Link></div>}
    </>}
  </section>;
}
