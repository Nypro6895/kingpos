"use client";
import { useEffect, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { CampaignDay } from "@/types/owner-campaign";
import { loadCampaignResultsAction } from "./actions";
import styles from "./campaign-ui.module.css";
const names = { views: "Views", likes: "Likes", comments: "Comments", bookings: "Bookings" };
type Metric = keyof typeof names;
export function CampaignResults({ id, compact = false, revision = "" }: { id: string; compact?: boolean; revision?: string }) {
  const t = useWorkspaceTranslation(), [days, setDays] = useState(7), [metric, setMetric] = useState<Metric>("views"), [rows, setRows] = useState<CampaignDay[] | null>(null), [error, setError] = useState(""), [selected, setSelected] = useState("");
  useEffect(() => { let active = true; loadCampaignResultsAction(id, days).then(data => { if (active) { setRows(data); setError(""); } }).catch(() => { if (active) setError("Results could not load. Please retry."); }); return () => { active = false; }; }, [id, days, revision]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const end = new Date(`${today}T12:00:00Z`), series: CampaignDay[] = [];
  const bins = compact ? 7 : Math.min(days, 7);
  for (let i = 0; i < bins; i++) { const date = new Date(end); date.setUTCDate(date.getUTCDate() - days + 1 + Math.floor(i * days / bins)); const from = date.toISOString().slice(0, 10); const next = new Date(end); next.setUTCDate(next.getUTCDate() - days + 1 + Math.floor((i+1) * days / bins)); const until = next.toISOString().slice(0,10); const group = (rows ?? []).filter(r => r.day >= from && r.day < until); series.push({day:from, views:group.reduce((n,r)=>n+r.views,0),likes:group.reduce((n,r)=>n+r.likes,0),comments:group.reduce((n,r)=>n+r.comments,0),bookings:group.reduce((n,r)=>n+r.bookings,0)}); }
  const max = Math.max(1, ...series.map(r => r[metric]));
  return <div className={styles.chart}>
    <div className={styles.row}><span className={styles.muted}><WorkspaceText text={names[metric]} /> · {days} <WorkspaceText text="days" /></span>{!compact && <label className={styles.muted}><WorkspaceText text="Period" /><select aria-label={t("Result period")} value={days} onChange={e => { setRows(null); setDays(Number(e.target.value)); }}>{[7,30,90].map(d => <option key={d} value={d}>{d} {t("days")}</option>)}</select></label>}</div>
    {error ? <p className={styles.error} role="alert">{t(error)} <button className={styles.link} onClick={() => { setError(""); loadCampaignResultsAction(id,days).then(setRows).catch(()=>setError("Results could not load. Please retry.")); }}>{t("Try again")}</button></p> : rows === null ? <p className={styles.muted}>{t("Loading results…")}</p> : <>
      <div className={styles.plot} role="group" aria-label={t("Daily campaign results")}>{series.map(r => <button className={styles.bar} key={r.day} aria-label={`${r.day}: ${r[metric]} ${t(names[metric])}`} aria-pressed={selected === `${r.day}: ${r[metric]}`} onClick={()=>setSelected(`${r.day}: ${r[metric]}`)}><span className={styles.barValue}>{r[metric].toLocaleString()}</span><span className={styles.barMark} style={{height:`${r[metric]/max*80}px`}} /><span className={styles.barDay}>{r.day.slice(5).replace("-","/")}</span></button>)}</div>
      <small className={styles.muted} aria-live="polite">{selected || t("Select a day to see its results.")}</small>
    </>}
    {!compact && <div className={styles.chartChoice}>{Object.entries(names).map(([key,name]) => <button key={key} aria-pressed={metric===key} onClick={()=>{setMetric(key as Metric);setSelected("");}}><WorkspaceText text={name} /></button>)}</div>}
  </div>;
}
