"use client";
import { useEffect, useState } from "react";
import { giftMoney, type GiftReply } from "@/types/gift-card";
import styles from "./rewardlumi.module.css";
export function VisitGiftCards({ visitId }: { visitId: string }) {
  const [data, setData] = useState<GiftReply>(), [open, setOpen] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function send(op: string, cardId?: string) {
    const response = await fetch("/api/rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "personal", op, args: { visitId, cardId } }), cache: "no-store", signal: AbortSignal.timeout(10000) });
    const result = await response.json(); if (!response.ok) throw Error(result.error ?? "Gift cards are unavailable."); return result as GiftReply;
  }
  useEffect(() => {
    let alive = true, pending = false;
    const load = async () => { if (pending || document.hidden) return; pending = true; try { const result = await send("gift-load"); if (alive) setData(result); } catch { /* Gift Card is optional; never block check-in. */ } finally { pending = false; } };
    void load(); const timer = setInterval(() => void load(), 3000); return () => { alive = false; clearInterval(timer); };
    // Each mounted visit has its own authenticated wallet boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);
  async function approve(cardId: string) { setBusy(true); setError(""); try { setData(await send("gift-approve", cardId)); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  if (!data?.cards?.length) return null;
  return <section className={styles.panel} aria-label="Gift cards for this visit"><div className={styles.row}><strong>Gift cards at this salon</strong><button onClick={() => setOpen(!open)}>{open ? "Hide" : "Use gift card"}</button></div>
    {data.session?.approved && <p className={styles.status}>{giftMoney(data.session.amount)} gift card authorized for this ticket.</p>}
    {open && <>{!data.session?.total ? <p className={styles.muted}>Your cards are ready. Choose one once the salon has added your services total.</p> : <p>Ticket total after rewards: <strong>{giftMoney(data.session.total)}</strong></p>}{data.cards.map(card => <div className={styles.row} key={card.id}><span>•••• {card.last4} · {giftMoney(card.balance)}</span><button disabled={busy || !data.session?.total} onClick={() => void approve(card.id)}>Use up to {giftMoney(Math.min(card.balance, data.session?.total ?? 0))}</button></div>)}<p className={styles.muted}>Your check-in already identifies you. No second scan is needed for cards in your account.</p></>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
