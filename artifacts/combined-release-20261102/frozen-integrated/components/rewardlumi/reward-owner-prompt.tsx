"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import type { RewardDiscoverySalon } from "@/lib/reward-discovery";
import { rewardInvitation, rewardLocalLabel, rewardVisitTarget } from "@/lib/reward-invitation";
import { rewardMoney } from "@/types/rewardlumi";
import { RewardPromoArtwork } from "./reward-promo-artwork";
import styles from "./reward-owner-prompt.module.css";

type Summary = {
  salonId: string; enabled: boolean; nearby: boolean; discoverable: boolean; reasons: string[];
  periodStart: string; periodEnd: string; discountCents: number; members: number;
  paidConversions: number; rewardUses: number; preview?: RewardDiscoverySalon | null;
};

export function RewardOwnerPrompt({ setup = false }: { setup?: boolean }) {
  const scope = useExperienceScope();
  return <RewardOwnerPromptReady key={scope?.context.scope ?? "unscoped"} setup={setup} />;
}

function RewardOwnerPromptReady({ setup }: { setup: boolean }) {
  const anchor = useRef<HTMLElement>(null);
  const [data, setData] = useState<Summary | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let started = false, revision = 0;
    const load = async () => {
      const current = ++revision;
      try {
        const response = await fetch("/api/rewards/owner-discovery", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        if (!response.ok) return;
        const value: Summary = await response.json();
        if (controller.signal.aborted || current !== revision || typeof value.salonId !== "string") return;
        try { setHidden(!setup && Number(localStorage.getItem("reward-owner-prompt:" + value.salonId)) > Date.now()); }
        catch { /* Dismissal is an optional local preference. */ }
        setData(value);
      } catch { /* Optional guidance never blocks the Owner workspace. */ }
    };
    const start = () => { if (!started) { started = true; void load(); } };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { start(); observer?.disconnect(); }
    }, { rootMargin: "100px" });
    if (observer && anchor.current) observer.observe(anchor.current); else start();
    const refresh = () => { if (started && document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { controller.abort(); observer?.disconnect(); document.removeEventListener("visibilitychange", refresh); };
  }, [setup]);

  function dismiss() {
    setHidden(true);
    try { if (data) localStorage.setItem("reward-owner-prompt:" + data.salonId, String(Date.now() + 7 * 86400000)); }
    catch { /* Dismissal does not change reward settings. */ }
  }

  // Activity belongs to the whole program. It is not Explore attribution or ROI.
  if (setup) return <section ref={anchor} className={data ? styles.activity : undefined} aria-label="Reward program activity">
    {data && <>
      <h2>Reward activity</h2>
      <p className={styles.muted}>Last 30 business days · {data.periodStart} – {data.periodEnd}</p>
      <p className={styles.muted}>Program activity across all channels.</p>
      {(data.members > 0 || data.paidConversions > 0 || data.rewardUses > 0 || data.discountCents > 0) ? <>
        <dl className={styles.metrics}>
          <div><dt>New members</dt><dd>{data.members}</dd></div>
          <div><dt>Paid referral bookings</dt><dd>{data.paidConversions}</dd></div>
          <div><dt>Rewards used</dt><dd>{data.rewardUses}</dd></div>
          <div><dt>Net reward discounts</dt><dd>{rewardMoney(data.discountCents)}</dd></div>
        </dl>
        <p className={styles.muted}>Reward discounts are already included in ticket totals.</p>
      </> : <p className={styles.muted}>No program activity in this period yet. Results appear after customers participate.</p>}
    </>}
  </section>;

  if (!data) return <section ref={anchor} aria-label="Grow with rewards" />;

  if (data.discoverable) return <section ref={anchor} className={styles.status} aria-label="Reward visibility">
    <span className={styles.statusMark} aria-hidden="true">✓</span>
    <div className={styles.statusCopy}><h2>Rewards are visible in Explore</h2><p>Eligible local customers can discover your salon’s rewards.</p></div>
    <Link className={styles.manage} href="/reward-system" prefetch={false}>Manage</Link>
  </section>;

  if (data.enabled) {
    const reasons = Array.isArray(data.reasons) ? data.reasons : [];
    const requirement = reasons.find(reason => !/New earning is paused|Local discovery is hidden/.test(reason));
    const href = requirement?.includes("salon profile") ? "/salon-profile"
      : requirement?.includes("city/state or map location") ? "/salon-settings" : "/reward-system";
    return <section ref={anchor} className={styles.status + " " + styles.attention} aria-label="Reward visibility needs attention">
      <span className={styles.statusMark} aria-hidden="true">!</span>
      <div className={styles.statusCopy}><h2>{!data.nearby ? "Your rewards are hidden from Explore" : "One more step to appear in Explore"}</h2>
        <p>{requirement || "Review your settings to show rewards to local customers."}</p></div>
      <Link className={styles.manage} href={href} prefetch={false}>{href === "/salon-profile" ? "Review profile" : href === "/salon-settings" ? "Add location" : "Review rewards"}</Link>
    </section>;
  }

  if (hidden) return <section ref={anchor} aria-label="Grow with rewards" />;

  const preview = data.preview;
  // This is explicitly a hypothetical new-customer preview, never the owner's
  // personal eligibility, a live published post, or an action that can book.
  const eligibility = { welcome: true, firstBooking: true, spend: true, visit: true, beforeAfter: true };
  const invitation = preview ? rewardInvitation(preview, "all", eligibility) : null;
  return <section ref={anchor} className={styles.invite} aria-label="Grow with rewards">
    <div className={styles.inviteContent}>
      {preview && <div className={styles.thumbnail}><RewardPromoArtwork key={preview.id} salon={preview} /></div>}
      <div className={styles.inviteCopy}>
        <p className={styles.eyebrow}>Rewards for your salon</p>
        <h2>Give customers a reason to come back</h2>
        <p>Help local customers discover your salon’s rewards.</p>
      </div>
      <button type="button" className={styles.later} onClick={dismiss} title="Remind me about rewards in 7 days">Later</button>
    </div>
    <div className={styles.actions}><Link className={styles.primary} href="/reward-system" prefetch={false}>Preview &amp; set up rewards</Link></div>
    <p className={styles.reviewNote}>Review earning rules, reward values and limits in setup. Earning stays off until you confirm.</p>
    {preview && invitation && <details className={styles.preview}>
      <summary>Customer post preview</summary>
      <p className={styles.previewNote}>Preview for a new customer · not published</p>
      <article className={styles.post} aria-label="Customer reward post preview">
        <header><strong>{preview.name}</strong><span>{rewardLocalLabel(preview)}</span></header>
        <div className={styles.postArtwork}><RewardPromoArtwork key={preview.id} salon={preview} /></div>
        <div className={styles.postCopy}><p className={styles.eyebrow}>Rewards at this salon</p><h3>{invitation.title}</h3><p>{invitation.body}</p>
          <span className={styles.previewAction} aria-disabled="true">{rewardVisitTarget(preview, "all", eligibility).startsWith("/book/") ? "Book a visit" : "Explore this salon"}</span>
          <small>Preview only. Eligible activity and your salon’s terms apply.</small>
        </div>
      </article>
    </details>}
  </section>;
}
