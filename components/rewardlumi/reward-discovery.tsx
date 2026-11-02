"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { rewardDiscoveryPoint, rewardEarnLines, rewardOfferLabel, type RewardDiscoveryKind, type RewardDiscoveryResult, type RewardDiscoverySalon,type RewardPublicProgram } from "@/lib/reward-discovery";
import {rewardInvitation,rewardLocalLabel,rewardVisitTarget} from "@/lib/reward-invitation";
import {RewardPromoArtwork} from "./reward-promo-artwork";
import styles from "./reward-discovery.module.css";

type Props = { latitude?: number | null; longitude?: number | null; location?: string; category?: string; viewerId?: string | null; onChooseArea?: () => void };
const filters: [RewardDiscoveryKind, string][] = [["all", "All rewards"], ["spend", "Service spend"], ["welcome", "Welcome points"], ["before_after", "Before & After"]];
const subscribePreference = (callback: () => void) => { window.addEventListener("storage", callback); return () => window.removeEventListener("storage", callback); };

export function RewardDiscovery(props: Props) {
  // Remount only this independent group on a committed region/account change.
  const context = JSON.stringify([props.latitude, props.longitude, props.location, props.category, props.viewerId]);
  return <RewardDiscoveryGroup key={context} {...props} />;
}

function RewardDiscoveryGroup({ latitude, longitude, location = "", category = "", viewerId, onChooseArea }: Props) {
  const point = rewardDiscoveryPoint(latitude, longitude);
  const [expanded, setExpanded] = useState(false), [kind, setKind] = useState<RewardDiscoveryKind>("all"), [radius, setRadius] = useState(5);
  const [reply, setReply] = useState<{ url: string; data: RewardDiscoveryResult } | null>(null), [failure, setFailure] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  const [manualHidden, setHidden] = useState<boolean | null>(null), [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<RewardDiscoverySalon | null>(null);
  const [membership,setMembership]=useState<Omit<RewardPublicProgram,"salon">>({joined:false,available:null});
  const [opening, setOpening] = useState<string | null>(null), [notice, setNotice] = useState("");
  const detailRequest = useRef<AbortController | null>(null);
  const anchor = useRef<HTMLElement>(null), dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement | null>(null);
  const dismissal = `reward-discovery:hidden:${viewerId ?? "guest"}`;
  const preference = useSyncExternalStore(subscribePreference, useCallback(() => {
    try { return Number(sessionStorage.getItem(dismissal)) > Date.now() ? "hidden" : "shown"; } catch { return "shown"; }
  }, [dismissal]), () => "pending");
  const ready = preference !== "pending", hidden = manualHidden ?? preference === "hidden";
  const query = new URLSearchParams({ category, kind, radius: String(radius) });
  if (point) { query.set("lat", String(point.latitude)); query.set("lon", String(point.longitude)); }
  else query.set("location", location);
  const url = `/api/rewards/discover?${query}`;
  const hasArea = Boolean(point || location.trim());
  const result: RewardDiscoveryResult | null = !hasArea ? { salons: [], hasMore: false, needsArea: true } : reply?.url === url ? reply.data : null;
  const error = failure === url;
  useEffect(() => {
    const node = anchor.current;
    if (!node || !ready || hidden) return;
    if (typeof IntersectionObserver === "undefined") { const frame = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(frame); }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: "120px" });
    observer.observe(node); return () => observer.disconnect();
  }, [ready, hidden]);
  useEffect(() => {
    if (!ready || !visible || hidden || !hasArea) return;
    const controller = new AbortController();
    let revision = 0;
    const load = () => { const current = ++revision; return fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), cache: "no-store" }).then(async r => {
      if (!r.ok) throw Error("Reward discovery unavailable");
      const data: RewardDiscoveryResult = await r.json();
      if (!Array.isArray(data.salons)) throw Error("Invalid rewards");
      if (!controller.signal.aborted && current === revision) { setReply({ url, data }); setFailure(null); }
    }).catch(() => { if (!controller.signal.aborted && current === revision) setFailure(url); }); };
    void load();
    // Revalidate opt-in/paused programs on return, without polling or blocking Explore.
    const onVisible = () => { if (document.visibilityState === "visible") { detailRequest.current?.abort();setOpening(null);setSelected(null); void load(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); document.removeEventListener("visibilitychange", onVisible); };
  }, [url, ready, visible, hidden, attempt, hasArea]);
  useEffect(() => {
    const node=dialog.current;
    if (selected && node && !node.open) node.showModal();
    if (!selected && node?.open) node.close();
    return()=>{if(node?.open)node.close();};
  }, [selected]);
  useEffect(() => () => detailRequest.current?.abort(), []);
  async function openDetails(salon: RewardDiscoverySalon, button: HTMLButtonElement) {
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller;
    trigger.current = button; setOpening(salon.id); setNotice("");
    try {
      const response = await fetch(`/api/rewards/program?salonId=${encodeURIComponent(salon.id)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw Error("Unavailable");
      const fresh: RewardPublicProgram = await response.json();
      if (controller.signal.aborted) return;
      if(fresh.salon?.id===salon.id&&Array.isArray(fresh.salon.offers)&&fresh.salon.offers.length){setMembership({joined:fresh.joined,available:fresh.available,earningEligibility:fresh.earningEligibility,authenticated:fresh.authenticated});setSelected({...fresh.salon,distanceMiles:salon.distanceMiles});}
      else{setReply(old=>old?{...old,data:{...old.data,salons:old.data.salons.filter(row=>row.id!==salon.id)}}:old);setNotice("This reward is no longer in the current list. Please choose another shop.");}
    } catch { if (!controller.signal.aborted) setNotice("Current reward terms could not be checked. Please try again."); }
    finally { if (!controller.signal.aborted) setOpening(null); }
  }
  function resetDetails(){detailRequest.current?.abort();setOpening(null);setSelected(null);}
  function chooseArea(){resetDetails();onChooseArea?.();}
  function dismiss() { resetDetails();setHidden(true); try { sessionStorage.setItem(dismissal, String(Date.now() + 86400000)); } catch { /* Optional. */ } }
  const unavailable = Boolean(result?.needsArea);
  const rows = result?.salons ?? [];
  const showPrompt = !hidden && ready;
  const invitation=selected?rewardInvitation(selected,kind,membership.earningEligibility):null;
  const visitTarget=selected?rewardVisitTarget(selected,kind,membership.earningEligibility):"";
  const authenticated=membership.authenticated??Boolean(viewerId);
  function openBooking(){
    const href=new URL(visitTarget,window.location.href).href;
    // The global link interceptor runs before React's onClick. Close our native
    // dialog first, then use its existing explicit booking-intent contract.
    dialog.current?.close();
    requestAnimationFrame(()=>window.dispatchEvent(new CustomEvent("reylumi:quick-book",{detail:{href}})));
  }
  if (ready && hidden) return <section ref={anchor} className={styles.group} aria-label="Discover local rewards"><button type="button" onClick={() => { setHidden(false); setExpanded(true); try { sessionStorage.removeItem(dismissal); } catch { /* Optional. */ } }}>Find local rewards</button></section>;
  if(ready&&!expanded&&!notice&&(!result||!rows.length||error))return <section ref={anchor} className={styles.group} aria-label="Discover local rewards"><button type="button" onClick={()=>setExpanded(true)}>Find local rewards</button>{!hasArea&&onChooseArea&&<button type="button" onClick={chooseArea}>Choose area</button>}</section>;
  return <section ref={anchor} className={styles.group} aria-label="Discover local rewards" hidden={!showPrompt} data-reward-discovery>
    <div className={styles.heading}><div><h2>Rewards {point ? "near you" : "in your selected area"}</h2><p className={styles.muted}>{point ? `Within ${radius} miles · ${category && category !== "All" ? category : "Local salons"}` : result?.areaLabel || location || "Choose a city or use your location to find participating salons."}</p></div><button type="button" className={styles.quiet} onClick={dismiss} aria-label="Hide reward suggestions for this session">Hide</button></div>
    {!expanded ? <div className={styles.controls}><button type="button" onClick={() => setExpanded(true)}>Find shops with rewards</button></div> : <div className={styles.controls} aria-label="Reward filters">
      {filters.map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { resetDetails();setKind(value); }}>{label}</button>)}
      {point && <label>Distance<select aria-label="Reward distance" value={radius} onChange={e => {resetDetails();setRadius(Number(e.target.value));}}><option value={5}>5 miles</option><option value={10}>10 miles</option><option value={15}>15 miles</option></select></label>}
    </div>}
    {expanded&&onChooseArea&&<button type="button" className={styles.quiet} onClick={chooseArea}>{point?"Choose another area":"Choose nearby city or ZIP"}</button>}
    {notice && <p role="status" className={styles.status}>{notice}</p>}
    {error ? <div className={styles.status} role="status">Rewards could not be loaded. <button type="button" onClick={() => { setFailure(null); setAttempt(n => n + 1); }}>Try again</button></div> : unavailable ? <div className={styles.status}>Choose a city or ZIP code to see local rewards.{onChooseArea && <button type="button" onClick={chooseArea}>Choose area</button>}</div> : !result ? <p className={styles.status} role="status">Finding local rewards…</p> : !rows.length ? <p className={styles.status}>No participating shops match {kind === "all" ? "this area" : "this reward filter"} yet. {kind !== "all" && <button type="button" onClick={() => setKind("all")}>Show all rewards</button>}{onChooseArea && <button type="button" onClick={chooseArea}>Change area</button>}</p> : <>
      {rows.slice(0, expanded ? 24 : 3).map(salon => <div className={styles.row} key={salon.id}>
        <div className={styles.identity}><strong>{salon.name}</strong><span className={styles.muted}>{rewardLocalLabel(salon)}</span><span className={styles.badge}>Rewards available</span><span className={styles.muted}>{rewardInvitation(salon,kind).title}</span></div>
        <button type="button" className={styles.primary} disabled={opening !== null} aria-label={`View rewards at ${salon.name}`} onClick={e => void openDetails(salon, e.currentTarget)}>{opening === salon.id ? "Checking…" : "View rewards"}</button>
      </div>)}
      {expanded && result?.hasMore && <p className={styles.muted}>Showing up to 24 participating shops. Choose a smaller area or another reward filter to narrow the list.</p>}
    </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="local-reward-title" onClose={() => { setSelected(null); trigger.current?.focus(); }} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      {selected && invitation && <><div className={styles.hero}><RewardPromoArtwork key={selected.id} salon={selected} category={category}/><button type="button" className={styles.close} onClick={() => dialog.current?.close()} aria-label="Close reward details">Close</button></div>
        <div className={styles.promoBody}><span className={styles.badge}>Rewards at {selected.name}</span><p className={styles.localContext}>{rewardLocalLabel(selected)}</p><h3 id="local-reward-title">{invitation.title}</h3>
        <p className={styles.promoCopy}>{invitation.body}</p>
        <footer>{visitTarget.startsWith("/book/")?<button type="button" className={styles.primary} data-booking-href={visitTarget} onClick={openBooking}>Book a visit</button>:<Link className={styles.primary} href={visitTarget} prefetch={false} onClick={()=>dialog.current?.close()}>Explore this salon</Link>}{membership.joined&&<Link href="/rewards" prefetch={false} onClick={()=>dialog.current?.close()}>My rewards</Link>}</footer>
        {!authenticated&&<p className={styles.accountPrompt}>Keep your points in a personal account. <span className={styles.accountLinks}><Link href={`/signup?next=${encodeURIComponent(visitTarget)}`} prefetch={false} onClick={()=>dialog.current?.close()}>Create an account</Link><span aria-hidden="true"> · </span><Link href={`/login?next=${encodeURIComponent(visitTarget)}`} prefetch={false} onClick={()=>dialog.current?.close()}>Sign in</Link></span></p>}
        <p className={styles.finePrint}>Earn on eligible activity under this salon’s rules. Booking or creating an account alone does not award points.</p>
        <details><summary>How to earn & reward terms</summary>{membership.joined&&membership.available!==null&&<p>{membership.available} available points here.</p>}<ul>{rewardEarnLines(selected).map(line => <li key={line}>{line}.</li>)}</ul>{selected.offers.map(offer=><p key={offer.id}>{rewardOfferLabel(offer)}{offer.serviceName?` · ${offer.serviceName}`:""}</p>)}<p className={styles.muted}>Points belong to this salon. Posting or sharing alone earns no points. Pending points cannot be spent. Eligibility and current terms are checked at the salon.</p></details>
        </div>
      </>}
    </dialog>
  </section>;
}
