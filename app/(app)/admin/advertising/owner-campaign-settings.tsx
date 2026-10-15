"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import type { OwnerCampaign, OwnerCampaignSettings } from "@/types/owner-campaign";
import { saveOwnerCampaignSettingsAction, reviewOwnerCampaignAction, previewOwnerCampaignAction } from "./owner-settings-actions";
import { money } from "@/lib/owner-campaign-rules";
import styles from "@/components/owner-campaign.module.css";

export function OwnerCampaignSettingsPanel({ initial, campaigns, error }: { initial: OwnerCampaignSettings; campaigns: OwnerCampaign[]; error: string }) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState(error);
  const [preview,setPreview]=useState<{id:string;caption:string;image:string|null;href:string|null}|null>(null);
  const [busy, startTransition] = useTransition();
  const fields = [
    ["welcomeCredits", "One-time welcome credits", 0, 100000],
    ["neighborhoodPricePercent", "Neighborhood price (%)", 10, 1000],
    ["zipcodePricePercent", "ZIP / postal code price (%)", 10, 1000],
    ["cityPricePercent", "City price (%)", 10, 1000],
    ["statePricePercent", "State / region price (%)", 10, 1000],
    ["countryPricePercent", "Country price (%)", 10, 1000],
    ["dailyPriceCents", "Starting price per day (cents)", 100, 100000],
    ["viewsPerDollar", "Suggested views per $1", 1, 10000],
    ["maxDays", "Maximum days", 1, 90], ["maxCampaigns", "Open campaigns per salon", 1, 20],
    ["promptCooldownHours", "Hours between suggestions", 1, 168],
    ["dailyFrequency", "Daily views per person, per campaign", 1, 5],
    ["maxDailyViews", "Maximum daily view limit", 100, 100000],
    ["maxAdsPerDay", "All campaign views per person / day", 1, 30],
    ["exampleLikesPerThousand", "Example likes per 1,000 views", 0, 1000],
    ["exampleCommentsPerThousand", "Example comments per 1,000 views", 0, 1000],
    ["exampleBookingsPerThousand", "Example bookings per 1,000 views", 0, 1000],
  ] as const;
  return <section className={styles.card} style={{margin:24}}><div className={styles.cardHeader}><div><span className={styles.eyebrow}>OWNER CAMPAIGNS</span><h3 style={{marginTop:8}}>Help businesses reach more people</h3></div><span className={styles.badge}>From {money(settings.dailyPriceCents)} / day</span></div><p className={styles.muted}>These settings apply to new owner campaigns. Existing campaign prices and limits stay as agreed. 100 credits = $1. Welcome credits are granted only once; existing balances stay unchanged. Payment requires a connected provider.</p>
    <form onSubmit={event => { event.preventDefault(); startTransition(async () => { try { const result = await saveOwnerCampaignSettingsAction(settings); setMessage(result.message); } catch { setMessage("Settings could not be saved. Please try again."); } }); }}>
      <div className={styles.actions}><label><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({...settings,enabled:event.target.checked})} /> Allow owner campaigns</label><label><input type="checkbox" checked={settings.promptsEnabled} onChange={event => setSettings({...settings,promptsEnabled:event.target.checked})} /> Suggest after posting</label></div>
      <div className={styles.adminGrid}>{fields.map(([key,label,min,max]) => <label className={styles.label} key={key}>{label}<input type="number" required min={min} max={max} step={1} value={settings[key]} onChange={event => setSettings({...settings,[key]:Number(event.target.value)})} /></label>)}</div>
      <p className={styles.note}>Turning off owner campaigns stops delivery immediately. Re-enabling does not extend end dates. Suggested numbers are estimates; reporting always uses actual activity.</p>
      <button className={styles.primary} style={{maxWidth:240}} disabled={busy}>{busy ? "Saving…" : "Save owner settings"}</button>
    </form>{message ? <p role="status" className={styles.notice} style={{marginTop:18}}>{message}</p> : null}
    <h3 style={{marginTop:28}}>Owner campaigns</h3>{!campaigns.length ? <p className={styles.muted}>No owner campaigns yet.</p> : campaigns.map(c => <article className={styles.card} style={{marginTop:14}} key={c.id}><div className={styles.cardHeader}><h3>{c.title}</h3><span className={styles.badge}>{c.status.replaceAll("_", " ")}</span></div><p className={styles.muted}>{c.location}, {c.country} · {c.views.toLocaleString()} views · {money(c.spent_cents)} / {money(c.total_price_cents)}</p><button className={styles.secondary} disabled={busy} onClick={()=>startTransition(async()=>{try{setPreview({id:c.id,...await previewOwnerCampaignAction(c.id)});}catch{setMessage("Ad preview could not load.");}})}>View ad</button>{preview?.id===c.id?<div>{preview.image?<Image unoptimized src={preview.image} alt={c.title} width={600} height={400} style={{width:"100%",height:"auto",maxWidth:600}}/>:null}<p style={{whiteSpace:"pre-wrap"}}>{preview.caption}</p>{preview.href?<a href={preview.href} target="_blank" rel="noopener noreferrer">Open post</a>:null}</div>:null}{c.status === "pending_review" ? <div className={styles.actions}>{[true,false].map(approve => <button key={String(approve)} className={approve ? styles.primary : styles.secondary} disabled={busy} onClick={() => startTransition(async () => { try { const result = await reviewOwnerCampaignAction(c.id, approve); setMessage(result.message); } catch { setMessage("Review could not be saved. Please try again."); } })}>{approve ? "Approve & run" : "Decline"}</button>)}</div> : null}</article>)}
  </section>;
}
