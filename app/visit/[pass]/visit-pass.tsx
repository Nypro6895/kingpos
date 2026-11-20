"use client";
import { useEffect, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import type { RelayTicket } from "@/types/service-relay";
import styles from "@/app/service-relay/service-relay.module.css";
export function CustomerVisitPass({ pass }: { pass: string }) {
  const [ticket, setTicket] = useState<RelayTicket | null>(null), [error, setError] = useState(""), [origin, setOrigin] = useState("");
  useEffect(() => {
    let alive = true, running = false;
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try { const response = await fetch(`/api/service-relay/pass/${pass}`, { cache: "no-store" }); if (!response.ok) throw new Error("Your check-in link has expired. Please ask the front desk."); const data = await response.json(); if (alive) { setOrigin(location.origin); setTicket(data); setError(""); } }
      catch (err) { if (alive) setError(err instanceof Error ? err.message : "Reconnect to update your check-in."); }
      finally { running = false; }
    }
    void refresh(); const timer = setInterval(refresh, 10000); document.addEventListener("visibilitychange", refresh); window.addEventListener("online", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("online", refresh); };
  }, [pass]);
  return <main className={`${styles.panel} ${styles.pass}`}><h1>Your check-in</h1>{ticket && <><h2>{ticket.customerName}</h2><p className={styles.number}>#{ticket.queueNumber}</p><p role="status">{ticket.status === "completed" ? "Payment completed" : ticket.status === "checkout" ? "Please visit the cashier" : ticket.status === "in_service" ? "Receiving services" : ticket.status === "cancelled" ? "Check-in cancelled" : "Waiting for your staff"}</p>{ticket.offers.filter(o => o.status === "working").map(o => <article className={styles.card} key={o.id}><strong>{o.staffName}</strong><p>{o.serviceName} · Working</p></article>)}<QrCodeTile ariaLabel="Your check-in QR" valueToEncode={`${origin}/visit/${pass}`} fallbackMessage="Tell staff your check-in number." className="mx-auto h-40 w-40" /></>}{error && <p role="alert">{error}</p>}{!ticket && !error && <p>Loading your check-in…</p>}</main>;
}
