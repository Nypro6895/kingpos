"use client";
import { useCallback, useEffect, useState } from "react";
import { rewardMoney, type RewardReport } from "@/types/rewardlumi";
import styles from "./rewardlumi.module.css";

export function RewardActivity({ transport }: { transport?: (day?: string) => Promise<RewardReport> }) {
  const [report, setReport] = useState<RewardReport>(), [day, setDay] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async (selected?: string) => {
    setBusy(true); setError("");
    try {
      let value: RewardReport;
      if (transport) value = await transport(selected);
      else {
        const response = await fetch("/api/rewards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "owner", op: "report", args: { day: selected || null } }), cache: "no-store", signal: AbortSignal.timeout(10000) });
        const data = await response.json(); if (!response.ok) throw Error(data.error ?? "Could not load reward activity."); value = data;
      }
      setReport(value); setDay(value.day);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load reward activity."); }
    finally { setBusy(false); }
  }, [transport]);
  useEffect(() => { void load(); }, [load]);
  return <section className={styles.panel} aria-label="Reward activity"><h2>Reward activity</h2>
    <p className={styles.muted}>Rewards used are included in your ticket discounts. This history shows their separate reward source, including returns.</p>
    <div className={styles.actions}><label>Business date<input aria-label="Reward activity date" type="date" value={day} disabled={busy} onChange={e => setDay(e.target.value)} /></label><button disabled={busy || !day} onClick={() => void load(day)}>{busy ? "Loading…" : "View activity"}</button></div>
    {report && <><p className={styles.muted}>Salon timezone: {report.timezone}</p><div className={styles.summary}>
      <span><strong>{rewardMoney(report.summary.netValueCents)}</strong>Reward discounts</span><span><strong>{report.summary.activeUses}</strong>Used</span><span><strong>{rewardMoney(report.summary.reversedValueCents)}</strong>Returned</span><span><strong>{report.summary.pointsSpent}</strong>Points used</span>
    </div>{report.entries.length === 0 && <p>No reward use on this business date.</p>}
      {report.entries.map(entry => <div className={styles.row} key={entry.requestId}><span><strong>{entry.ticketNumber} · {entry.title}</strong><br /><small className={styles.muted}>{entry.netPoints ? `${entry.netPoints} points used` : "Returned"} · {entry.ticketStatus}</small></span><strong>{rewardMoney(entry.netValueCents)}</strong></div>)}
      {report.hasMore && <p className={styles.muted}>Showing the most recent 100 records. Totals include every record on this date.</p>}</>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
