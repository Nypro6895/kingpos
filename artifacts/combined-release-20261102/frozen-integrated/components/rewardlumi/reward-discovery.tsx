"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useExperienceScope } from "@/components/experience-scope";
import { useExploreSocial, useSalonSocial } from "@/components/explore-social";
import { rewardDiscoveryPoint, rewardEarnLines, rewardOfferLabel, type RewardDiscoveryResult, type RewardPublicProgram } from "@/lib/reward-discovery";
import { rewardLocalLabel, rewardVisitTarget } from "@/lib/reward-invitation";
import { rewardFeedCandidates, rewardFeedInvitation } from "@/lib/reward-feed-presentation";
import { RewardPromoArtwork } from "./reward-promo-artwork";
import styles from "./reward-feed.module.css";

type Props = {
  latitude?: number | null; longitude?: number | null; location?: string; category?: string;
  viewerId?: string | null; adjacentSalonIds?: string[]; onChooseArea?: () => void;
};
const subscribePreference = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};
async function currentProgram(id: string, signal: AbortSignal): Promise<RewardPublicProgram> {
  const response = await fetch(`/api/rewards/program?salonId=${encodeURIComponent(id)}`, {
    cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok) throw Error("Current rewards could not be checked.");
  const value: RewardPublicProgram = await response.json();
  if (value.salon && (value.salon.id !== id || !Array.isArray(value.salon.offers))) throw Error("Invalid salon rewards.");
  return value;
}

export function RewardDiscovery(props: Props) {
  const scope = useExperienceScope();
  const context = JSON.stringify([scope?.context.scope, props.latitude, props.longitude, props.location, props.category, props.viewerId]);
  return <RewardFeedPost key={context} {...props} />;
}

function RewardFeedPost({ latitude, longitude, location = "", category = "", viewerId, adjacentSalonIds = [] }: Props) {
  const point = rewardDiscoveryPoint(latitude, longitude);
  const query = new URLSearchParams({ category, kind: "all", radius: "5" });
  if (point) { query.set("lat", String(point.latitude)); query.set("lon", String(point.longitude)); }
  else query.set("location", location);
  const url = `/api/rewards/discover?${query}`;
  const hasArea = Boolean(point || location.trim());
  const anchor = useRef<HTMLElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const closeDialog = useCallback(() => dialog.current?.close(), []);
  const request = useRef<AbortController | null>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const [visible, setVisible] = useState(false), [manualHidden, setHidden] = useState(false);
  const [loaded, setLoaded] = useState<{ url: string; program: RewardPublicProgram } | null>(null);
  const [settled, setSettled] = useState(false);
  const [details, setDetails] = useState(false), [checking, setChecking] = useState(false), [notice, setNotice] = useState("");
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const dismissal = `reward-discovery:hidden:${viewerId ?? "guest"}`;
  const preference = useSyncExternalStore(subscribePreference, useCallback(() => {
    try { return Number(sessionStorage.getItem(dismissal)) > Date.now() ? "hidden" : "shown"; } catch { return "shown"; }
  }, [dismissal]), () => "pending");
  const hidden = manualHidden || preference === "hidden";
  const { states } = useExploreSocial();
  const hiddenKey = Object.keys(states).filter(id => states[id]?.hidden).sort().join(",");
  const adjacentKey = adjacentSalonIds.join(",");
  const program = loaded?.url === url ? loaded.program : null;
  const salon = program?.salon ?? null;
  useSalonSocial(salon?.id);
  const socialHidden = Boolean(salon && states[salon.id]?.hidden);

  useEffect(() => {
    const node = anchor.current;
    if (!node || preference === "pending" || hidden || !hasArea) return;
    const show = () => { if (node.getClientRects().length) setVisible(true); };
    if (typeof IntersectionObserver === "undefined") { const frame = requestAnimationFrame(show); return () => cancelAnimationFrame(frame); }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { show(); observer.disconnect(); } }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [preference, hidden, hasArea]);

  useEffect(() => {
    if (!visible || hidden || !hasArea) return;
    const controller = new AbortController(); let revision = 0;
    async function load() {
      const version = ++revision;
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw Error("Unavailable");
        const result: RewardDiscoveryResult = await response.json();
        if (!Array.isArray(result.salons)) throw Error("Invalid discovery");
        const candidates = rewardFeedCandidates(result.salons, adjacentKey ? adjacentKey.split(",") : [], hiddenKey ? hiddenKey.split(",") : []);
        let next: RewardPublicProgram | null = null;
        // One ready post, with bounded validation work. Never hydrate 24 marketing cards.
        for (const candidate of candidates.slice(0, 3)) {
          if (controller.signal.aborted || version !== revision) return;
          const fresh = await currentProgram(candidate.id, controller.signal);
          if (fresh.salon?.offers.length) {
            next = { ...fresh, salon: { ...fresh.salon, distanceMiles: candidate.distanceMiles } };
            break;
          }
        }
        if (!controller.signal.aborted && version === revision) { setDetails(false); setChecking(false); setLoaded(next ? { url, program: next } : null); setSettled(true); }
      } catch {
        if (!controller.signal.aborted && version === revision) { setLoaded(null); setSettled(true); }
      }
    }
    void load();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      request.current?.abort(); setChecking(false); setDetails(false); setNotice("");
      void load();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    const reset = () => { controller.abort(); request.current?.abort(); dialog.current?.close(); setLoaded(null); setSettled(true); setDetails(false); setChecking(false); };
    window.addEventListener("reylumi:experience-reset", reset);
    return () => { controller.abort(); request.current?.abort(); request.current = null; closeDialog(); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); window.removeEventListener("reylumi:experience-reset", reset); };
  }, [url, visible, hidden, hasArea, adjacentKey, hiddenKey, closeDialog]);

  useEffect(() => {
    const node = dialog.current;
    if (details && node && !node.open) node.showModal();
    if (!details && node?.open) node.close();
    return () => { if (node?.open) node.close(); };
  }, [details]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (socialHidden) { request.current?.abort(); dialog.current?.close(); } }, [socialHidden]);

  const invitation = salon ? rewardFeedInvitation(salon, category, program?.earningEligibility) : null;
  const target = salon ? rewardVisitTarget(salon, "all", program?.earningEligibility) : "";
  const attached = Boolean(salon && adjacentSalonIds.includes(salon.id));
  const authenticated = program?.authenticated ?? Boolean(viewerId);
  function dismiss() {
    request.current?.abort(); dialog.current?.close(); setHidden(true);
    try { sessionStorage.setItem(dismissal, String(Date.now() + 86400000)); } catch { /* Optional preference. */ }
  }
  async function checkAndOpen(button: HTMLButtonElement, action: "terms" | "book") {
    if (!salon) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    trigger.current = button; setChecking(true); setNotice("");
    try {
      const fresh = await currentProgram(salon.id, controller.signal);
      if (controller.signal.aborted) return;
      if (!fresh.salon?.offers.length) { setDetails(false); setLoaded(null); return; }
      const next = { ...fresh, salon: { ...fresh.salon, distanceMiles: salon.distanceMiles } };
      setLoaded({ url, program: next });
      if (action === "terms") setDetails(true);
      else {
        const nextTarget = rewardVisitTarget(next.salon, "all", next.earningEligibility);
        if (nextTarget.startsWith("/book/")) {
          dialog.current?.close(); setDetails(false);
          const href = new URL(nextTarget, window.location.href).href;
          requestAnimationFrame(() => { if (!controller.signal.aborted && request.current === controller) window.dispatchEvent(new CustomEvent("reylumi:quick-book", { detail: { href } })); });
        } else setNotice("Booking is not available for this reward right now. Explore the salon for current options.");
      }
    } catch { if (!controller.signal.aborted) setNotice("We couldn't check the latest rewards. Please try again."); }
    finally { if (!controller.signal.aborted) setChecking(false); }
  }
  if (!hasArea || hidden || socialHidden) return null;
  // Keep the lazy observer at this actual feed position when GPS/account/area
  // remounts while scrolled. A resolved empty/error result takes no grid slot.
  if (!salon || !invitation) return settled ? null : <section ref={anchor} className={styles.pendingSlot} aria-hidden="true" />;

  const action = (inDialog = false) => target.startsWith("/book/")
    ? <button type="button" className={styles.primary} data-booking-href={target} disabled={checking} onClick={event => void checkAndOpen(event.currentTarget, "book")}>{checking ? "Checking…" : "Book a visit"}<span aria-hidden="true">↗</span></button>
    : <Link prefetch={false} className={styles.primary} href={target} onClick={() => { if (inDialog) dialog.current?.close(); }}>Explore this salon <span aria-hidden="true">↗</span></Link>;
  return <section ref={anchor} className={styles.slot} aria-label={`Salon rewards at ${salon.name}`} data-reward-discovery data-reward-attached={attached || undefined}>
    <article className={attached ? styles.attached : styles.post}>
      <header className={styles.identity}>
        <div className={styles.avatar} aria-hidden="true">{salon.logoImageUrl && failedLogo !== salon.logoImageUrl ? <Image src={salon.logoImageUrl} alt="" width={38} height={38} unoptimized onError={() => setFailedLogo(salon.logoImageUrl ?? null)}/> : salon.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join("")}</div>
        <div><Link prefetch={false} href={`/explore/salons/${salon.id}`} className={styles.salonName}>{salon.name}</Link><p>{rewardLocalLabel(salon)}<span className={styles.rewardLabel}>Salon rewards</span></p></div>
        <button type="button" className={styles.dismiss} onClick={dismiss} aria-label="Hide reward suggestion">×</button>
      </header>
      {!attached && <button type="button" className={styles.media} disabled={checking} aria-label={`View rewards at ${salon.name}`} onClick={event => void checkAndOpen(event.currentTarget, "terms")}><RewardPromoArtwork salon={salon} category={category}/></button>}
      <div className={styles.copy}>
        <h2>{invitation.title}</h2><p>{invitation.body}</p>
        <div className={styles.actions}>{action()}<button type="button" className={styles.terms} disabled={checking} onClick={event => void checkAndOpen(event.currentTarget, "terms")}>How rewards work</button></div>
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
      </div>
    </article>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="local-reward-title" onClose={() => { setDetails(false); trigger.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      {details && <>
        <div className={styles.detailMedia}><RewardPromoArtwork salon={salon} category={category}/><button type="button" className={styles.close} onClick={() => dialog.current?.close()} aria-label="Close reward details">Close</button></div>
        <div className={styles.copy}><p className={styles.detailIdentity}>{salon.name} · {rewardLocalLabel(salon)}</p><h2 id="local-reward-title">{invitation.title}</h2><p>{invitation.body}</p>
          <div className={styles.actions}>{action(true)}{program?.joined && <Link prefetch={false} href={`/rewards#salon-${salon.id}`} onClick={() => dialog.current?.close()}>My rewards</Link>}</div>
          {!authenticated && <p className={styles.account}>Use your personal account to keep track of points. <Link prefetch={false} href={`/signup?next=${encodeURIComponent(target)}`} onClick={() => dialog.current?.close()}>Create an account</Link> · <Link prefetch={false} href={`/login?next=${encodeURIComponent(target)}`} onClick={() => dialog.current?.close()}>Sign in</Link></p>}
          <details className={styles.rules}><summary>Reward conditions</summary>{program?.joined && program.available !== null && <p>{program.available} points available at this salon.</p>}<ul>{rewardEarnLines(salon).map(line => <li key={line}>{line}.</li>)}</ul>{salon.offers.map(offer => <p key={offer.id}>{rewardOfferLabel(offer)}{offer.serviceName ? ` · ${offer.serviceName}` : ""}</p>)}<p>Points stay with this salon. Booking or creating an account alone does not award points. Current visit conditions determine whether a reward can be used.</p></details>
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
        </div>
      </>}
    </dialog>
  </section>;
}
