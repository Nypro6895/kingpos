"use client";

import { useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { OwnerMarketplace, OwnerMarketState } from "@/types/market-platform-owner";
import { DeveloperAppCards, developerAppCount } from "./developer-apps";
import styles from "./market.module.css";
import recovery from "./market-developer-recovery.module.css";

// This view receives only independently read developer-app state. It must never
// manufacture billing, installed-native-feature or payment-return status.
export function recoveryState(initial: OwnerMarketState, observation: OwnerMarketplace | null): OwnerMarketState {
  return initial.status === "ready" && observation?.salonId === initial.data.salonId
    && Number.isFinite(Date.parse(observation.observedAt))
    && Date.parse(observation.observedAt) >= Date.parse(initial.data.observedAt)
    ? { status: "ready", data: observation } : initial;
}
export function MarketDeveloperRecovery({ initial, initialQuery = "" }: {
  initial: OwnerMarketState;
  initialQuery?: string;
}) {
  const [observation, setObservation] = useState<OwnerMarketplace | null>(null);
  const state = recoveryState(initial, observation);
  const translate = useWorkspaceTranslation();
  const [query, setQuery] = useState(initialQuery);
  const [view, setView] = useState<"discover" | "my-apps">("discover");
  const confirmed = (next: OwnerMarketplace) => {
    setObservation(current => {
      const latest = recoveryState(initial, current);
      const applied = recoveryState(latest, next);
      return applied.status === "ready" && applied.data === next ? next : current;
    });
  };
  return <main className={styles.page}>
    <div className={styles.container}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>REYLUMI MARKET</span><h1><WorkspaceText text="Market" /></h1></div>
        <button className={styles.secondary} type="button" onClick={() => window.location.reload()}><WorkspaceText text="Reload Market" /></button>
      </header>
      <p role="status" className={styles.previewNote}><WorkspaceText text="Some Reylumi features could not load. Reload Market to view them. Developer apps are checked separately for your current salon." /></p>
      <h2><WorkspaceText text="Developer apps" /></h2>
      {state.status === "ready" && <p><WorkspaceText text="Your current salon" />: <strong>{state.data.salonName}</strong></p>}
      {state.status === "disabled" ? <p><WorkspaceText text="Developer apps are not available in this environment." /></p> : <>
      <nav className={`${styles.tabs} ${recovery.views}`} aria-label={translate("Developer app views")}>
        <button type="button" aria-pressed={view === "discover"} onClick={() => setView("discover")}><WorkspaceText text="Available developer apps" /></button>
        <button type="button" aria-pressed={view === "my-apps"} onClick={() => setView("my-apps")}><WorkspaceText text="Installed developer apps" />{state.status === "ready" && <span>{developerAppCount(state, true)}</span>}</button>
      </nav>
      <label className={recovery.search}><WorkspaceText text="Find a developer app" /><input type="search" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} /></label>
      <div className={styles.grid}><DeveloperAppCards state={state} query={query} category="All features" view={view} onConfirmed={confirmed} /></div>
      {state.status === "ready" && developerAppCount(state, view === "my-apps", query) === 0
        && <p><WorkspaceText text="No developer apps match this view." /></p>}
      </>}
    </div>
  </main>;
}
