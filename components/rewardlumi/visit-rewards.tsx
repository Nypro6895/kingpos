"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rewardTransport } from "@/lib/rewardlumi-client";
import { rewardMoney, type RewardTransport, type RewardView } from "@/types/rewardlumi";
import styles from "./rewardlumi.module.css";

export function VisitRewards({ scope, token, visitId, transport, receipt, onChange }: {
  scope: "personal" | "display" | "pos"; token?: string; visitId?: string;
  transport?: RewardTransport; receipt?: unknown; onChange?: (view: RewardView | null) => void;
}) {
  const send = useMemo(() => transport ?? rewardTransport(scope, token), [transport, scope, token]);
  const [view, setView] = useState<RewardView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const epoch = useRef(0), pending = useRef(false), acting = useRef(false), change = useRef(onChange);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const receiptKey = JSON.stringify(receipt);
  const load = useCallback(async () => {
    if (pending.current || acting.current || (typeof navigator !== "undefined" && !navigator.onLine)) return;
    pending.current = true; const generation = epoch.current;
    try {
      const result = await send(scope === "pos" ? "quote" : "load", { visitId, token, ...(receiptKey ? { receipt: JSON.parse(receiptKey) } : {}) });
      if (generation !== epoch.current) return;
      setView(result.view ?? null); change.current?.(result.view ?? null); setError(""); setLoaded(true);
    } catch (e) { if (generation === epoch.current) { setError(e instanceof Error ? e.message : "Reconnect to load rewards."); setLoaded(true); } }
    finally { pending.current = false; }
  }, [send, scope, visitId, token, receiptKey]);
  useEffect(() => {
    epoch.current++; setView(null); change.current?.(null); setLoaded(false);
    void load();
    const tick = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2500);
    const reset = () => { epoch.current++; setView(null); change.current?.(null); };
    window.addEventListener("reylumi:experience-reset", reset);
    return () => { epoch.current++; clearInterval(tick); window.removeEventListener("reylumi:experience-reset", reset); };
  }, [load]);
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
  if (!view && !error) return null;
  if (!view) return <section className={styles.panel} aria-label="Rewards"><p className={styles.muted}>{loaded ? error : "Loading rewards…"}</p><button onClick={() => void load()}>Retry rewards</button></section>;
  if (!view.enabled && !view.available && !view.request) return null;
  const request = view.request;
  const active = request && !["cancelled", "redeemed"].includes(request.status);
  const customer = scope !== "pos";
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
      {view.offers.filter(o => o.points <= view.available).slice(0, 3).map(offer => customer && selection === offer.id ? <div className={styles.notice} key={offer.id}>
        <p>Use <strong>{offer.points} points</strong> for <strong>{offer.title}</strong> on this visit?</p><p className={styles.muted}>Applies when eligible services reach {rewardMoney(offer.minimumCents)}. You can remove it before payment.</p><div className={styles.actions}><button className={styles.primary} disabled={busy || !!error} onClick={() => void act("request", offer.id)}>Confirm {offer.points} points</button><button disabled={busy} onClick={() => setSelection(null)}>Back</button></div>
      </div> : <div className={styles.row} key={offer.id}>
        <span><strong>{offer.title}</strong><br /><span className={styles.muted}>{offer.points} pts · minimum {rewardMoney(offer.minimumCents)}</span></span>
        <button className={styles.primary} disabled={busy || !!error} onClick={() => customer ? setSelection(offer.id) : void act("suggest", offer.id)}>{customer ? "Use reward" : "Ask customer"}</button>
      </div>)}
      {!view.offers.some(o => o.points <= view.available) && <p className={styles.muted}>{view.pending ? `${view.pending} points pending completed, paid bookings.` : "Earn points on qualifying paid visits."}</p>}
    </>}
    {error && <p role="alert" className={styles.error}>{error} <button onClick={() => void load()}>Refresh</button></p>}
  </section>;
}
