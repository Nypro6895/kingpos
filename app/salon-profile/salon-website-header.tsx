"use client";
/* eslint-disable @next/next/no-img-element -- Salon logo public URL. */
import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { PublicSalonProfile } from "@/types/salon-profile";
import styles from "./salon-website-header.module.css";

type WebsiteTab = { id: string; label: string };
export function SalonWebsiteHeader({ profile, layout, tabs, extraTabs, selectedTab, introVisible = true, onTab, onTabKeyDown, tools, trust, verified, priceHint, canBook, onBook, canFollow, following, followPending, onFollow, onHours, canShare, onShare }: {
  profile: PublicSalonProfile;
  layout: "booking" | "portfolio" | "balanced";
  tabs: WebsiteTab[];
  extraTabs: WebsiteTab[];
  selectedTab: string;
  introVisible?: boolean;
  onTab: (id: string) => void;
  onTabKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  tools?: ReactNode;
  trust?: ReactNode;
  verified?: ReactNode;
  priceHint?: string | null;
  canBook: boolean;
  onBook: () => void;
  canFollow: boolean;
  following: boolean;
  followPending: boolean;
  onFollow: () => void;
  onHours: () => void;
  canShare: boolean;
  onShare: () => void;
}) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const initials = profile.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join("");
  const locality = [profile.city, profile.state].filter(Boolean).join(", ");
  const status = profile.operatingStatus;
  return <section className={styles.header} data-website-header data-layout={layout} data-home={selectedTab === "discover" && introVisible}>
    <div className={styles.top}>
      <div className={styles.identity}>
        <div className={styles.logo}>{profile.logoImageUrl && failedLogo !== profile.logoImageUrl
          ? <img src={profile.logoImageUrl} alt={`${profile.name} logo`} onError={() => setFailedLogo(profile.logoImageUrl)}/>
          : <span aria-hidden="true">{initials}</span>}</div>
        <div className={styles.name}><div><h2>{profile.name}</h2>{verified}</div>{locality ? <p>{locality}</p> : null}</div>
      </div>
      <div className={styles.tools}>{tools}</div>
      <div className={styles.actions}>
        {canFollow ? <button type="button" className={styles.follow} aria-pressed={following} disabled={followPending} onClick={onFollow}>{following ? "✓ Following" : "+ Follow salon"}</button> : null}
        {canBook ? <button type="button" className={styles.book} onClick={onBook}>Book appointment <span aria-hidden="true">→</span></button> : null}
      </div>
    </div>
    {trust || priceHint || (status && status.kind !== "hours_unset") ? <div className={styles.meta}>
      {trust ? <div className={styles.trust}>{trust}</div> : null}
      {priceHint ? <span className={styles.priceHint}>{priceHint}</span> : null}
      {status && status.kind !== "hours_unset" ? <button type="button" className={styles.status} data-open={status.isOpen} aria-label="View salon operating hours" aria-haspopup="dialog" onClick={onHours}>
        <span aria-hidden="true" className={styles.dot}/><strong>{status.label}</strong>{status.detail ? <><span aria-hidden="true">·</span><span>{status.detail}</span></> : null}
      </button> : null}
    </div> : null}
    <div className={styles.navigation}>
      <div role="tablist" aria-label="Salon profile sections" className={styles.tabs} onKeyDown={onTabKeyDown}>
        {tabs.map(tab => <button type="button" key={tab.id} id={`salon-profile-tab-${tab.id}`} role="tab" aria-controls={`salon-profile-${tab.id}`} aria-selected={selectedTab === tab.id} tabIndex={selectedTab === tab.id ? 0 : -1} onClick={() => onTab(tab.id)}>{tab.id === "discover" ? "Overview" : tab.label}</button>)}
      </div>
      {extraTabs.length || canShare ? <details className={styles.more} data-dismissible-popover>
        <summary aria-label="More profile sections and actions">•••</summary>
        <div>{extraTabs.map(tab => <button key={tab.id} id={`salon-profile-tab-${tab.id}`} type="button" onClick={event => { onTab(tab.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}>{tab.label}</button>)}
          {canShare ? <button type="button" onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); onShare(); }}>Share profile</button> : null}
        </div>
      </details> : null}
    </div>
  </section>;
}
