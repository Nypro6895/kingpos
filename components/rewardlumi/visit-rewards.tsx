"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { rewardMoney, type RewardTransport, type RewardView } from "@/types/rewardlumi";
import styles from "./rewardlumi.module.css";
import { useNativeDialogNavigation, useTransientOverlay } from "@/components/overlay-dismissal";
import type { RewardOffer } from "@/types/rewardlumi";

export function VisitRewards({ scope, token, visitId, transport, receipt, onChange, presentation, onAvailabilityChange }: {
  scope: "personal" | "display" | "pos"; token?: string; visitId?: string;
  transport?: RewardTransport; receipt?: unknown; onChange?: (view: RewardView | null) => void;
  presentation?: "checkout"; onAvailabilityChange?: (available: boolean) => void;
}) {
  const send = useMemo(() => transport ?? rewardTransport(scope, token), [transport, scope, token]);
  const [view, setView] = useState<RewardView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const epoch = useRef(0), pending = useRef(false), acting = useRef(false), change = useRef(onChange);
  const invalidate = useCallback(() => { epoch.current++; }, []);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const receiptKey = JSON.stringify(receipt);
  const load = useCallback(async () => {
    if (pending.current || acting.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setError("Reconnect to load rewards."); setLoaded(true); return; }
    pending.current = true; const generation = epoch.current;
    try {
      const result = await send(scope === "pos" ? "quote" : "load", { visitId, token, ...(receiptKey ? { receipt: JSON.parse(receiptKey) } : {}) });
      if (generation !== epoch.current) return;
      setView(result.view ?? null); change.current?.(result.view ?? null); setError(""); setLoaded(true);
    } catch (e) { if (generation === epoch.current) { setError(e instanceof Error ? e.message : "Reconnect to load rewards."); setLoaded(true); } }
    finally { pending.current = false; }
  }, [send, scope, visitId, token, receiptKey]);
  useEffect(() => {
    invalidate(); const generation = epoch.current;
    queueMicrotask(() => { if (epoch.current !== generation) return; setView(null); change.current?.(null); setLoaded(false); void load(); });
    const tick = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2500);
    const reset = () => { invalidate(); setView(null); change.current?.(null); };
    window.addEventListener("reylumi:experience-reset", reset);
    return () => { invalidate(); clearInterval(tick); window.removeEventListener("reylumi:experience-reset", reset); };
  }, [load, invalidate]);
  useEffect(() => { onAvailabilityChange?.(loaded && !error); }, [loaded, error, onAvailabilityChange]);
  async function act(op: string, offerId?: string) {
    if (acting.current || busy || !view?.visitId) return;
    acting.current = true; setBusy(true); setError(""); const generation = epoch.current;
    try {
      // A background refresh must not swallow a customer's tap. Finish that
      // read first, then perform the mutation while further reads are paused.
      while (pending.current) await new Promise(resolve => setTimeout(resolve, 25));
      if (generation !== epoch.current) return;
      pending.current = true;
      const result = await send(op, { visitId: view.visitId, offerId, consent: customer && op === "request", quote: view.request?.quote, revision: view.request?.revision });
      if (generation === epoch.current) { setView(result.view ?? null); change.current?.(result.view ?? null); }
    } catch (e) { if (generation === epoch.current) setError(e instanceof Error ? e.message : "Please retry."); }
    finally { pending.current = false; acting.current = false; setBusy(false); setSelection(null); }
  }
  const customer = scope !== "pos";
  if (presentation === "checkout") return <CheckoutRewards view={view} error={error} busy={busy} loaded={loaded} selection={selection} setSelection={setSelection} act={act} retry={load} />;
  if (!view && !error) return null;
  if (!view) return <section className={styles.panel} aria-label="Rewards"><p className={styles.muted}>{loaded ? error : "Loading rewards…"}</p><button onClick={() => void load()}>Retry rewards</button></section>;
  if (!view.enabled && !view.available && !view.request) return null;
  const request = view.request;
  const active = request && !["cancelled", "redeemed"].includes(request.status);
  return <section className={styles.panel} aria-label="Visit rewards" data-reward-visit>
    <div className={styles.row}><h3><span className={styles.star}>★</span> Rewards</h3><strong>{view.available} points{view.reserved > 0 ? ` · ${view.reserved} held` : ""}</strong></div>
    {active ? <>
      <p className={styles.notice}><strong>{request.title} · {request.points} points</strong><br />
        {request.status === "confirmed" ? "Confirmed · applied when this ticket is paid" : request.quote ? customer ? "Use these points on this visit?" : "Waiting for customer confirmation" : "Requested · waiting for eligible services on this ticket"}</p>
      <div className={styles.actions}>
        {customer && request.quote && request.status !== "confirmed" && <button className={styles.primary} disabled={busy || !!error} onClick={() => void act("confirm")}>Confirm use of {request.points} points</button>}
        <button disabled={busy} onClick={() => void act("cancel")}>{customer ? "Not now" : "Remove suggestion"}</button>
      </div>
      {!customer && request.status !== "confirmed" && <p className={styles.muted}>Ask the customer to confirm on their phone or the customer display. On one screen, let the customer open My QR → their visit.</p>}
    </> : request?.status === "redeemed" ? <p className={styles.status}>Reward redeemed.</p> : <>
      {request?.status === "cancelled" && <p className={styles.muted}>Reward declined for this visit. You may choose again.</p>}
      {view.offers.filter(o => o.points <= view.available).slice(0, showAll ? undefined : 3).map(offer => customer && selection === offer.id ? <div className={styles.notice} key={offer.id}>
        <p>Use <strong>{offer.points} points</strong> for <strong>{offer.title}</strong> on this visit?</p><p className={styles.muted}>Applies when eligible services reach {rewardMoney(offer.minimumCents)}. You can remove it before payment.</p><div className={styles.actions}><button className={styles.primary} disabled={busy || !!error} onClick={() => void act("request", offer.id)}>Confirm {offer.points} points</button><button disabled={busy} onClick={() => setSelection(null)}>Back</button></div>
      </div> : <div className={styles.row} key={offer.id}>
        <span><strong>{offer.title}</strong><br /><span className={styles.muted}>{offer.points} pts · minimum {rewardMoney(offer.minimumCents)}</span></span>
        <button className={styles.primary} disabled={busy || !!error} onClick={() => customer ? setSelection(offer.id) : void act("suggest", offer.id)}>{customer ? "Use reward" : "Ask customer"}</button>
      </div>)}
      {view.offers.filter(o => o.points <= view.available).length > 3 && <button type="button" onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer rewards" : "View all rewards"}</button>}
      {!view.offers.some(o => o.points <= view.available) && <p className={styles.muted}>{view.pending ? `${view.pending} points pending completed, paid bookings.` : "Earn points on qualifying paid visits."}</p>}
    </>}
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Refresh</button></p>}
  </section>;
}

function CheckoutRewards({ view, error, busy, loaded, selection, setSelection, act, retry }: { view: RewardView | null; error: string; busy: boolean; loaded: boolean; selection: string | null; setSelection: (value: string | null) => void; act: (op: string, offer?: string) => Promise<void>; retry: () => Promise<void> }) {
  const [allOpen, setAllOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useNativeDialogNavigation(dialog);
  const open = allOpen || !!selection;
  function close() { setAllOpen(false); setSelection(null); }
  useTransientOverlay(close, open);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  if (!view && !error) return null;
  if (view && !view.enabled && !view.available && !view.request) return null;
  const request = view?.request;
  const active = request && !["cancelled", "redeemed"].includes(request.status);
  const affordable = view?.offers.filter(offer => offer.points <= view.available) ?? [];
  const first = affordable[0];
  const picked: RewardOffer | undefined = selection === "request" && request ? { id: "request", title: request.title, points: request.points, valueCents: request.valueCents, minimumCents: 0 } : affordable.find(offer => offer.id === selection);
  const unlinked = /Link a personal account|does not belong/i.test(error);
  async function approve() { if (!picked) return; await act(selection === "request" ? "confirm" : "request", selection === "request" ? undefined : picked.id); setAllOpen(false); }
  return <section className={`${styles.panel} ${styles.checkoutPanel}`} style={{ backgroundImage: "url('/pos/reward-card-background.svg')" }} aria-label="Visit rewards" data-reward-visit data-reward-checkout aria-busy={!loaded}>
    <header className={styles.checkoutHeading}><h3>Rewards</h3>{view && <strong>{view.available} points available</strong>}</header>
    {!view ? <p className={styles.muted}>{unlinked ? "Connect your Reylumi account to this visit to use your points. Ask your cashier for help." : "Rewards could not be loaded. Your points have not been used."}<button type="button" disabled={busy} onClick={() => void retry()}>Retry rewards</button></p> : active ? <>
      <div className={styles.checkoutOffer}><div><strong>{request.title}</strong><small>{request.points} points{request.status === "confirmed" ? " held until payment" : request.quote ? " · review before using" : " · waiting for eligible services"}</small></div>{request.status === "confirmed" ? <button type="button" disabled={busy} onClick={() => void act("cancel")}>Remove</button> : request.quote ? <button type="button" className={styles.primary} disabled={busy || !!error} onClick={() => setSelection("request")}>Review</button> : <button type="button" disabled={busy} onClick={() => void act("cancel")}>Not now</button>}</div>
      <p className={styles.checkoutFoot}>{request.status === "confirmed" ? "Applied when this ticket is paid." : "Your cashier is preparing the reward for this ticket."}</p>
    </> : first ? <>
      <div className={styles.checkoutOffer}><div><strong>{first.title}</strong><small>{first.points} points · minimum {rewardMoney(first.minimumCents)} in services</small></div><button type="button" className={styles.primary} disabled={busy || !!error} onClick={() => setSelection(first.id)}>Use points</button></div>
      <div className={styles.checkoutFoot}><span>Use points only with your approval.</span>{affordable.length > 1 && <button type="button" onClick={() => setAllOpen(true)}>View all rewards ({affordable.length})</button>}</div>
    </> : <p className={styles.muted}>{view.pending ? `${view.pending} points pending completed, paid bookings.` : "Earn points on qualifying paid visits."}</p>}
    {view && error && <p role="alert" className={styles.error}>Reconnect to review the current reward.<button type="button" onClick={() => void retry()}>Retry rewards</button></p>}
    <dialog ref={dialog} className={styles.checkoutDialog} aria-label={picked ? "Use reward" : "All rewards"} onCancel={close} onClose={close}>
      <header><h2>{picked ? "Use your points?" : "Your rewards"}</h2><button type="button" aria-label="Close rewards" onClick={close}>×</button></header>
      {picked ? <><p>Choose a little reward for this visit.</p><dl><div><dt>Reward</dt><dd>{picked.title}</dd></div><div><dt>Points to use</dt><dd>{picked.points} points</dd></div>{picked.minimumCents > 0 && <div><dt>Minimum services</dt><dd>{rewardMoney(picked.minimumCents)}</dd></div>}</dl><p>Points are held for this visit and deducted when payment is complete. You can remove this reward before payment.</p><div className={styles.actions}><button type="button" onClick={close}>Not now</button><button type="button" className={styles.primary} disabled={busy || !!error || selection === "request" && !request?.quote} onClick={() => void approve()}>Use {picked.points} points</button></div></> : affordable.map(offer => <div className={styles.checkoutOffer} key={offer.id}><div><strong>{offer.title}</strong><small>{offer.points} points · minimum {rewardMoney(offer.minimumCents)}</small></div><button type="button" onClick={() => setSelection(offer.id)}>Review</button></div>)}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </dialog>
  </section>;
}
