"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createOwnerCampaignAction } from "@/app/campaigns/actions";
import { campaignQuote, money } from "@/lib/owner-campaign-rules";
import type { CampaignArea, OwnerCampaignSettings } from "@/types/owner-campaign";
import type { CampaignCreativeTarget } from "@/types/owner-campaign";
import styles from "./owner-campaign.module.css";

export function OwnerCampaignDialog({ target, settings, initialLocation, onClose, onSaved, availableCredits = 0, initialStep = "intro" }: {
  target: CampaignCreativeTarget; availableCredits?: number; initialStep?: "intro" | "setup"; settings: OwnerCampaignSettings;
  initialLocation?: { city: string; state: string; country: string };
  onClose: () => void; onSaved?: () => void;
}) {
  const __vt = useWorkspaceTranslation();

  const [step, setStep] = useState<"intro" | "setup" | "payment" | "saved">(initialStep);
  const [id] = useState(() => crypto.randomUUID());
  const [area, setArea] = useState<CampaignArea>("city");
  const [location, setLocation] = useState(initialLocation?.city ?? "");
  const [country, setCountry] = useState(initialLocation?.country ?? "United States");
  const [region, setRegion] = useState(initialLocation?.state ?? "");
  const [city, setCity] = useState(initialLocation?.city ?? "");
  const [days, setDays] = useState(Math.min(3, settings.maxDays));
  const baseViews = Math.min(settings.maxDailyViews, Math.max(100, Math.floor(settings.dailyPriceCents * settings.viewsPerDollar / 100)));
  const [views, setViews] = useState(baseViews);
  const [keepRunning,setKeepRunning] = useState(false);
  const [savedMessage,setSavedMessage] = useState("Your campaign is saved.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const exampleViews = baseViews * Math.min(7, settings.maxDays);
  const quote = campaignQuote(settings, views, days, area);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    const element = ref.current;
    element?.showModal();
    return () => { element?.close(); opener.current?.focus(); };
  }, []);
  async function save() {
    setBusy(true); setError("");
    try {
      const result = await createOwnerCampaignAction({ id, target, area, location, country: area === "country" ? location : country, state: region, city, dailyViews: views, days, keepRunning });
      if (!result.ok) setError(result.message);
      else { setSavedMessage(result.message); setStep("saved"); onSaved?.(); }
    } catch { setError("Please try again. Your choices are still here."); }
    finally { setBusy(false); }
  }
  return createPortal(<dialog ref={ref} className={styles.dialog} aria-labelledby="campaign-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={styles.modal}>
      <header className={styles.modalHeader}><span className={styles.eyebrow}><WorkspaceText text="REYLUMI · GROW YOUR BUSINESS" /></span><button className={styles.close} aria-label={__vt("Close campaign")} disabled={busy} onClick={onClose}>×</button></header>
      {step === "intro" ? <>
        <div className={styles.spark}>↗</div><h2 id="campaign-title"><WorkspaceText text="Your next customer" /><br /><WorkspaceText text="could love this post." /></h2>
        <p className={styles.muted}><WorkspaceText text="Bring “" /><WorkspaceText text={target.title || "Your new post"} /><WorkspaceText text="” to more people near you." /></p>
        <div className={styles.example}><span className={styles.eyebrow}><WorkspaceText text="WHAT MORE ATTENTION COULD LOOK LIKE" /></span><div className={styles.metrics}>{[["Views", exampleViews.toLocaleString()], ["Likes", Math.round(exampleViews * settings.exampleLikesPerThousand / 1000).toLocaleString()], ["Comments", Math.round(exampleViews * settings.exampleCommentsPerThousand / 1000).toLocaleString()], ["Bookings", Math.round(exampleViews * settings.exampleBookingsPerThousand / 1000).toLocaleString()]].map(([label, value]) => <div key={label}><strong>{value}</strong><span><WorkspaceText text={label} /></span></div>)}</div><small><WorkspaceText text="Illustration only. These are not your post’s results or a promise of bookings." /></small></div>
        <p className={styles.pitch}><WorkspaceText text="Reach more people from" /> <strong>{money(quote.dailyCents)} <WorkspaceText text="a day." /></strong></p>
        <div className={styles.actions}><button className={styles.secondary} onClick={onClose}><WorkspaceText text="Not now" /></button><button className={styles.primary} disabled={!settings.enabled} onClick={() => setStep("setup")}><WorkspaceText text="Get more people" /> <span>→</span></button></div>
      </> : step === "setup" ? <>
        <span className={styles.step}><WorkspaceText text="1 of 2 · Your audience" /></span><h2 id="campaign-title"><WorkspaceText text="Reach the right people." /></h2>
        <form onSubmit={event => { event.preventDefault(); setError(""); setStep("payment"); }}>
          <label className={styles.label}><WorkspaceText text="Where should people see your post?" /><select value={area} onChange={event => { const next = event.target.value as CampaignArea; setArea(next); setLocation(next === "country" ? country : next === "state" ? region : next === "city" ? city : ""); }}><option value="city"><WorkspaceText text="City" /></option><option value="neighborhood"><WorkspaceText text="Neighborhood" /></option><option value="zipcode"><WorkspaceText text="ZIP / postal code" /></option><option value="state"><WorkspaceText text="State / region" /></option><option value="country"><WorkspaceText text="Country" /></option></select></label>
          <label className={styles.label}><WorkspaceText text={area === "zipcode" ? "ZIP / postal code" : area.charAt(0).toUpperCase() + area.slice(1)} /><input required maxLength={120} value={location} placeholder={__vt(area === "city" ? "e.g. Chicago" : "Enter your area")} onChange={event => setLocation(event.target.value)} /></label>
          {area !== "country" ? <div className={styles.twoColumns}><label className={styles.label}><WorkspaceText text="Country" /><input required maxLength={80} value={country} onChange={event => setCountry(event.target.value)} /></label>{area !== "state" ? <label className={styles.label}><WorkspaceText text="State / region" /><input required maxLength={120} value={region} placeholder={__vt("e.g. Illinois")} onChange={event => setRegion(event.target.value)} /></label> : null}</div> : null}
          {area === "neighborhood" ? <label className={styles.label}><WorkspaceText text="City" /><input required maxLength={120} value={city} onChange={event => setCity(event.target.value)} /></label> : null}
          <fieldset className={styles.fieldset}><legend><WorkspaceText text="Daily view limit" /></legend><div className={styles.choices}>{[...new Set([baseViews, Math.min(baseViews * 3, settings.maxDailyViews), Math.min(baseViews * 6, settings.maxDailyViews)])].map(value => <button type="button" key={value} aria-pressed={views === value} onClick={() => setViews(value)}><strong>{value.toLocaleString()}</strong><small>{campaignQuote(settings, value, days, area).dailyCents.toLocaleString()} <WorkspaceText text="credits / day" /></small></button>)}</div><details className={styles.customChoice}><summary><WorkspaceText text="Choose a different daily limit" /></summary><label className={styles.label}><WorkspaceText text="Daily view limit" /><input type="number" required min={100} max={settings.maxDailyViews} step={1} value={views} onChange={event => setViews(Math.max(100, Math.min(settings.maxDailyViews, Math.round(Number(event.target.value)) || 100)))} /></label></details><small className={styles.muted}><WorkspaceText text="A maximum, not a guarantee. A smaller area may get fewer views." /></small></fieldset>
          <fieldset className={styles.fieldset}><legend><WorkspaceText text="How many days?" /></legend><div className={styles.choices}>{[...new Set([Math.min(3, settings.maxDays), Math.min(7, settings.maxDays), Math.min(14, settings.maxDays)])].map(value => <button type="button" key={value} aria-pressed={days === value} onClick={() => setDays(value)}>{value} <WorkspaceText text="days" /></button>)}</div><details className={styles.customChoice}><summary><WorkspaceText text="Choose a different duration" /></summary><label className={styles.label}><WorkspaceText text="Number of days" /><input type="number" required min={1} max={settings.maxDays} value={days} onChange={event => setDays(Math.max(1, Math.min(settings.maxDays, Math.round(Number(event.target.value)) || 1)))} /></label></details></fieldset>
          <div className={styles.total}><span><WorkspaceText text="Total limit ·" /> {days} <WorkspaceText text="days" /></span><strong>{quote.totalCents.toLocaleString()} <WorkspaceText text="credits" /></strong></div><p className={styles.note}><WorkspaceText text="Use credits only for delivered views. Cancel anytime; unused credits return to your balance." /></p>
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => setStep("intro")}><WorkspaceText text="Back" /></button><button className={styles.primary}><WorkspaceText text="Continue →" /></button></div>
        </form>
      </> : step === "payment" ? <>
        <span className={styles.step}><WorkspaceText text="2 of 2 · Review your ad" /></span><h2 id="campaign-title"><WorkspaceText text="Ready when you are." /></h2><div className={styles.summary}><p><span><WorkspaceText text="Post" /></span><strong><WorkspaceText text={target.title || "Your post"} /></strong></p><p><span><WorkspaceText text="Audience" /></span><strong>{location}{area !== "country" ? `, ${country}` : ""}</strong></p><p><span><WorkspaceText text="Daily limit" /></span><strong>{views.toLocaleString()} <WorkspaceText text="views" /></strong></p><p><span><WorkspaceText text="Duration" /></span><strong>{days} <WorkspaceText text="days" /></strong></p><p><span><WorkspaceText text="Total limit" /></span><strong>{quote.totalCents.toLocaleString()} <WorkspaceText text="credits" /></strong></p></div>
        <div className={styles.paymentNotice}><strong>{availableCredits.toLocaleString()} <WorkspaceText text="credits available" /></strong><p><WorkspaceText text={availableCredits >= quote.totalCents ? "Your credits cover this ad. We’ll set them aside and review your ad before it starts." : `You need ${Math.max(0,quote.totalCents-availableCredits).toLocaleString()} more credits. Save your ad now and add credits in Campaigns.`} /></p></div><label className={styles.note} style={{display:"block",marginTop:18}}><input type="checkbox" checked={keepRunning} onChange={event=>setKeepRunning(event.target.checked)}/> <WorkspaceText text="Keep this ad running in" /> {days}<WorkspaceText text="-day blocks at" /> {quote.totalCents.toLocaleString()} <WorkspaceText text="credits each. Stop anytime." /></label><p className={styles.note}><WorkspaceText text="Continued ads need enough credits. Automatic credit purchases require a saved card and your separate permission in Credits." /></p>
        {error ? <p role="alert" className={styles.error}><WorkspaceText text={error} /></p> : null}<div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={() => setStep("setup")}><WorkspaceText text="Back" /></button><button className={styles.primary} disabled={busy} onClick={() => void save()}><WorkspaceText text={busy ? "Saving…" : "Save campaign"} /></button></div>
      </> : <><div className={styles.spark}>✓</div><h2 id="campaign-title"><WorkspaceText text="Your campaign is saved." /></h2><p className={styles.muted}><WorkspaceText text={savedMessage} /></p><div className={styles.actions}><button className={styles.secondary} onClick={onClose}><WorkspaceText text="Done" /></button><Link className={styles.primary} href="/campaigns" onClick={onClose}><WorkspaceText text="View campaign →" /></Link></div></>}
    </div>
  </dialog>, document.body);
}
