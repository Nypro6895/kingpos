"use client";

import { useState } from "react";
import { StartupReady } from "@/components/startup-ready";
import { WorkspaceText } from "@/components/workspace-language";
import { useExperienceScope } from "@/components/experience-scope";
import { clearMarketStartupDraft, rememberMarketStartupDraft, MARKET_CATEGORIES, type MarketBrowse } from "./market-browse";
import styles from "./market.module.css";

/** Public browsing controls only; prices, access and checkout await the live Market. */
export function MarketStartupView({ initialBrowse, retry }: { initialBrowse?: MarketBrowse; retry?: () => void }) {
  const category = initialBrowse?.category ?? "All features";
  const [query, setQuery] = useState(initialBrowse?.query ?? "");
  const scope = useExperienceScope()?.context.scope;
  const remember = (input: HTMLInputElement, focused: boolean) => rememberMarketStartupDraft({ query: input.value, category }, {
    scope, focused, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd,
  });
  return <main className={styles.page} data-market-startup="">
    <StartupReady />
    <div className={styles.container}>
      <header className={styles.header}><div>
        <span className={styles.eyebrow}><WorkspaceText text="MORE FEATURES FOR REYLUMI" /></span>
        <h1>Market</h1><p><WorkspaceText text="Add the features your salon needs, right inside Reylumi." /></p>
      </div></header>
      <nav className="mb-5 flex gap-4 text-sm font-semibold text-brand-teal" aria-label="Market navigation">
        <a href="/explore"><WorkspaceText text="Explore" /></a><a href="/market"><WorkspaceText text="Browse all features" /></a>
      </nav>
      {retry ? <button type="button" className={`${styles.secondary} mb-4`} onClick={retry}><WorkspaceText text="Try again" /></button> : null}
      <form action="/market" method="get" role="search" aria-label="Search Market" className="mb-5 flex min-w-0 gap-2" onSubmit={clearMarketStartupDraft}>
        {category !== "All features" ? <input type="hidden" name="category" value={category} /> : null}
        <label className={`${styles.search} min-w-0 flex-1`}><span aria-hidden="true">⌕</span>
          <input name="q" aria-label="Search features" placeholder="Search features…" value={query} maxLength={200}
            onChange={event => { setQuery(event.target.value); remember(event.target, true); }}
            onFocus={event => remember(event.currentTarget, true)}
            onSelect={event => remember(event.currentTarget, document.activeElement === event.currentTarget)}
            onBlur={event => { if (event.relatedTarget) remember(event.currentTarget, false); }} />
        </label><button type="submit" className={styles.primary}><WorkspaceText text="Search" /></button>
      </form>
      <form action="/market" method="get" aria-label="Feature categories" className={styles.filters} onSubmit={clearMarketStartupDraft}>
        {query ? <input type="hidden" name="q" value={query} /> : null}
        {MARKET_CATEGORIES.map(item => <button key={item} type="submit" name="category" value={item} aria-pressed={category === item}>{item}</button>)}
      </form>
      <div className={`${styles.sectionHeading} my-6`}><h2><WorkspaceText text="Choose what to add to Reylumi" /></h2></div>
      <div className={styles.grid} aria-hidden="true">
        {[0, 1, 2].map(item => <div className={styles.card} key={item}>
          <div className="mb-5 h-12 w-12 rounded-xl bg-surface-muted" />
          <div className="mb-3 h-5 w-2/3 rounded bg-surface-muted" />
          <div className="mb-2 h-3 w-full rounded bg-surface-muted" />
          <div className="mb-8 h-3 w-4/5 rounded bg-surface-muted" />
          <div className="h-9 w-1/2 rounded bg-surface-muted" />
        </div>)}
      </div>
    </div>
  </main>;
}
