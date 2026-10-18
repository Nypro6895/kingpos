"use client";
import { useState, useTransition } from "react";
import type { OwnerCampaignSettings } from "@/types/owner-campaign";
import { saveOwnerCampaignSettingsAction } from "./owner-settings-actions";
import { campaignQuote } from "@/lib/owner-campaign-rules";
import { formatCredits, displayCredits, creditUnits } from "@/lib/campaign-credit-display";
import Link from "next/link";
import styles from "@/components/owner-campaign.module.css";

export function OwnerCampaignSettingsPanel({ initial, error }: { initial: OwnerCampaignSettings; error: string }) {
  const [settings, setSettings] = useState(initial);
  const [message, setMessage] = useState(error);
  const [busy, startTransition] = useTransition();
  const fields = [
    ["welcomeCredits", "One-time welcome credits", 0, 100000],
    ["neighborhoodPricePercent", "Neighborhood price (%)", 10, 1000],
    ["zipcodePricePercent", "ZIP / postal code price (%)", 10, 1000],
    ["cityPricePercent", "City price (%)", 10, 1000],
    ["statePricePercent", "State / region price (%)", 10, 1000],
    ["countryPricePercent", "Country price (%)", 10, 1000],
    ["dailyPriceCents", "Minimum credits per day (before location adjustment)", 100, 100000],
    ["viewsPerDollar", "Daily views per 120 credits (maximum, not guaranteed)", 1, 10000],
    ["maxDays", "Maximum days", 1, 90], ["maxCampaigns", "Open campaigns per salon", 1, 20],
    ["promptCooldownHours", "Hours between suggestions", 1, 168],
    ["dailyFrequency", "Daily views per person, per campaign", 1, 5],
    ["maxDailyViews", "Maximum daily view limit", 100, 100000],
    ["maxAdsPerDay", "All campaign views per person / day", 1, 30],
    ["exampleLikesPerThousand", "Example likes per 1,000 views", 0, 1000],
    ["exampleCommentsPerThousand", "Example comments per 1,000 views", 0, 1000],
    ["exampleBookingsPerThousand", "Example bookings per 1,000 views", 0, 1000],
  ] as const;
  const groups=[
   {title:"Credits & daily views",keys:["dailyPriceCents","viewsPerDollar","maxDailyViews"]},
   {title:"Advertising location",keys:["neighborhoodPricePercent","zipcodePricePercent","cityPricePercent","statePricePercent","countryPricePercent"]},
   {title:"Duration & display limits",keys:["maxDays","maxCampaigns","dailyFrequency","maxAdsPerDay"]},
   {title:"Welcome credits & suggestions",keys:["welcomeCredits","promptCooldownHours"]},
   {title:"Illustration only · never guaranteed or charged",keys:["exampleLikesPerThousand","exampleCommentsPerThousand","exampleBookingsPerThousand"]},
  ];
  return <section className={styles.card} style={{margin:24}}><div className={styles.cardHeader}><div><span className={styles.eyebrow}>OWNER CAMPAIGNS</span><h3 style={{marginTop:8}}>Help businesses reach more people</h3></div><span className={styles.badge}>From {formatCredits(settings.dailyPriceCents)} credits / day</span></div><p className={styles.muted}>These settings apply to new owner campaigns. Existing campaigns, including their continued periods, keep their agreed prices and delivery limits. 120 credits = $1. Welcome credits are granted only once; existing balances stay unchanged. Payment requires a connected provider.</p>
    <p className={styles.note}>At the current settings, 500 daily views for 7 days in a city have a limit of {formatCredits(campaignQuote(settings,Math.min(500,settings.maxDailyViews),Math.min(7,settings.maxDays),"city").totalCents)} credits. Likes, comments and bookings are measured results, never paid guarantees. Example engagement fields below only affect the illustration.</p>
    <form onSubmit={event => { event.preventDefault(); startTransition(async () => { try { const result = await saveOwnerCampaignSettingsAction(settings); setMessage(result.message); if(result.ok)setSettings(current=>({...current,version:result.version})); } catch { setMessage("Settings could not be saved. Please try again."); } }); }}>
      <div className={styles.actions}><label><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({...settings,enabled:event.target.checked})} /> Allow campaign creation & delivery (global switch)</label><label><input type="checkbox" checked={settings.promptsEnabled} onChange={event => setSettings({...settings,promptsEnabled:event.target.checked})} /> Suggest after posting</label></div>
      {groups.map(group=><fieldset key={group.title} disabled={busy||!settings.version} style={{border:0,padding:0,margin:"20px 0"}}><legend>{group.title}</legend><div className={styles.adminGrid}>{fields.filter(([key])=>group.keys.includes(key)).map(([key,label,min,max]) => <label className={styles.label} key={key}>{label}<input type="number" required min={key==="welcomeCredits"||key==="dailyPriceCents"?displayCredits(min):min} max={key==="welcomeCredits"||key==="dailyPriceCents"?displayCredits(max):max} step={key==="welcomeCredits"||key==="dailyPriceCents"?1.2:1} value={key==="welcomeCredits"||key==="dailyPriceCents"?displayCredits(settings[key]):settings[key]} onChange={event => {const value=Number(event.target.value);try{setSettings({...settings,[key]:key==="welcomeCredits"||key==="dailyPriceCents"?creditUnits(value):value});}catch{setMessage("Choose credits in steps of 1.2.");}}} /></label>)}</div></fieldset>)}
      <p className={styles.note}>Emergency pause stops delivery for all campaigns immediately. Re-enabling does not extend end dates. Suggested numbers are estimates; reporting always uses actual activity.</p>
      <button className={styles.primary} style={{maxWidth:240}} disabled={busy||!settings.version}>{busy ? "Saving…" : "Save owner settings"}</button>
    </form>{message ? <p role="status" className={styles.notice} style={{marginTop:18}}>{message}</p> : null}
    <Link href="/admin/advertising/reviews">Open ad review queue →</Link>
  </section>;
}
