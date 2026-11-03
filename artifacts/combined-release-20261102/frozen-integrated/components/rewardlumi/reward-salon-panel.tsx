"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { rewardEarnLines, rewardOfferLabel, type RewardPublicProgram } from "@/lib/reward-discovery";
import { rewardInvitation, rewardLocalLabel, rewardVisitTarget } from "@/lib/reward-invitation";
import styles from "./reward-salon-panel.module.css";

async function readProgram(salonId: string, signal: AbortSignal): Promise<RewardPublicProgram> {
  const response = await fetch("/api/rewards/program?salonId=" + encodeURIComponent(salonId), {
    cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw Error("Rewards could not be checked.");
  const data: RewardPublicProgram = await response.json();
  if (data.salon && (data.salon.id !== salonId || !Array.isArray(data.salon.offers))) throw Error("Invalid salon rewards.");
  return data;
}

export function RewardSalonPanel(props: { salonId: string; canBook: boolean }) {
  const scope = useExperienceScope();
  return <RewardSalonPanelReady key={(scope?.context.scope ?? "unscoped") + ":" + props.salonId} {...props} />;
}

function RewardSalonPanelReady({ salonId, canBook }: { salonId: string; canBook: boolean }) {
  const [reply, setReply] = useState<{ id: string; data: RewardPublicProgram } | null>(null);
  const [checking, setChecking] = useState(false), [notice, setNotice] = useState("");
  const rules = useRef<HTMLDetailsElement>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const revision = useRef(0), active = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    active.current = true;
    const load = async () => {
      const current = ++revision.current;
      actionRequest.current?.abort(); setChecking(false); setNotice("");
      try {
        const data = await readProgram(salonId, controller.signal);
        if (!controller.signal.aborted && current === revision.current) setReply({ id: salonId, data });
      } catch {
        if (!controller.signal.aborted && current === revision.current) setReply(null);
      }
    };
    void load();
    const refresh = () => { if (active.current && document.visibilityState === "visible") void load(); };
    const reset = () => {
      active.current = false; revision.current++; controller.abort(); actionRequest.current?.abort();
      setReply(null); setChecking(false); setNotice("");
    };
    window.addEventListener("reylumi:experience-reset", reset);
    document.addEventListener("visibilitychange", refresh);
    return () => { active.current = false; controller.abort(); actionRequest.current?.abort(); window.removeEventListener("reylumi:experience-reset", reset); document.removeEventListener("visibilitychange", refresh); };
  }, [salonId]);

  const data = reply?.id === salonId ? reply.data : null;
  const salon = data?.salon ? { ...data.salon, canBook: canBook && data.salon.canBook === true } : null;
  const invitation = salon ? rewardInvitation(salon, "all", data?.earningEligibility) : null;
  const target = salon ? rewardVisitTarget(salon, "all", data?.earningEligibility) : "";
  const authenticated = data?.authenticated === true;
  const member = authenticated && data?.joined === true;
  const currentSalonHref = "/explore/salons/" + salonId + "#salon-rewards";

  function showRules() {
    if (!rules.current) return;
    rules.current.open = true;
    rules.current.querySelector("summary")?.focus();
  }
  async function bookVisit() {
    if (!active.current || checking) return;
    actionRequest.current?.abort();
    const controller = new AbortController(), current = ++revision.current;
    actionRequest.current = controller; setChecking(true); setNotice("");
    try {
      const fresh = await readProgram(salonId, controller.signal);
      if (controller.signal.aborted || current !== revision.current || !active.current) return;
      setReply({ id: salonId, data: fresh });
      const nextSalon = fresh.salon ? { ...fresh.salon, canBook: canBook && fresh.salon.canBook === true } : null;
      const nextTarget = nextSalon ? rewardVisitTarget(nextSalon, "all", fresh.earningEligibility) : "";
      if (nextTarget.startsWith("/book/")) {
        const href = new URL(nextTarget, window.location.href).href;
        requestAnimationFrame(() => {
          if (!controller.signal.aborted && current === revision.current && active.current)
            window.dispatchEvent(new CustomEvent("reylumi:quick-book", { detail: { href } }));
        });
      } else if (nextSalon) setNotice("Visit options changed. Review the current reward conditions below.");
    } catch {
      if (!controller.signal.aborted && current === revision.current) setNotice("We couldn't check the latest rewards. Please try again.");
    } finally {
      if (!controller.signal.aborted && current === revision.current) setChecking(false);
    }
  }

  if (!salon || !invitation || !salon.offers.length) return <div id="salon-rewards" />;
  return <section id="salon-rewards" className={styles.panel} aria-label="Salon rewards">
    <p className={styles.eyebrow}>Rewards at {salon.name}</p>
    <h2>{invitation.title}</h2>
    {rewardLocalLabel(salon) && <p className={styles.location}>{rewardLocalLabel(salon)}</p>}
    <p className={styles.intro}>{invitation.body}</p>
    <div className={styles.actions}>
      {target.startsWith("/book/")
        ? <button type="button" className={styles.primary} disabled={checking} onClick={() => void bookVisit()}>{checking ? "Checking…" : "Book a visit"}</button>
        : <button type="button" className={styles.primary} onClick={showRules}>How rewards work</button>}
      {member && <Link prefetch={false} className={styles.secondary} href={"/rewards#salon-" + salonId}>My rewards <span aria-hidden="true">→</span></Link>}
      {authenticated && !member && <Link prefetch={false} className={styles.secondary} href="/qr">My QR <span aria-hidden="true">→</span></Link>}
    </div>
    {!authenticated && <p className={styles.account}>Keep track of your points with a personal account. <Link prefetch={false} href={"/signup?next=" + encodeURIComponent(currentSalonHref)}>Create an account</Link> · <Link prefetch={false} href={"/login?next=" + encodeURIComponent(currentSalonHref)}>Sign in</Link></p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <details ref={rules} className={styles.rules}>
      <summary>Reward conditions</summary>
      {member && typeof data?.available === "number" && <p>{data.available} points available at this salon.</p>}
      {authenticated && <p>Use your linked personal account when you check in. <Link prefetch={false} href="/qr">Show my QR</Link></p>}
      <ul>{rewardEarnLines(salon).map(line => <li key={line}>{line}.</li>)}</ul>
      {salon.offers.map(offer => <p key={offer.id}>{rewardOfferLabel(offer)}{offer.serviceName ? " · " + offer.serviceName : ""}</p>)}
      <p>Points stay with this salon. Booking or creating an account alone does not award points. Eligibility and current visit conditions determine whether a reward can be used.</p>
    </details>
  </section>;
}
