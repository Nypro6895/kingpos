"use client";
import { NavigationForm, NavigationSubmitButton } from "@/components/navigation-form";


import Link from "@/components/feedback-link";
import { StartupReady } from "./startup-ready";
import styles from "./app-startup-shell.module.css";

function rememberExploreStartupDraft(query: string, focused: boolean) {
  const params = new URLSearchParams(window.location.search); params.sort();
  window.__reylumiStartupSearch = { query, focused, at: Date.now(), route: window.location.pathname + (params.size ? `?${params}` : "") };
}

/** Public, useful controls can paint before identity or optional services resolve. */
export function AppStartupShell({ retry }: { retry?: () => void }) {
  return <div className={styles.shell} data-startup-shell="public">
    <StartupReady />
    <header className={styles.header}>
      <Link href="/explore" prefetch={false} className={styles.brand} aria-label="Reylumi Explore">Reylumi<span aria-hidden="true">✦</span></Link>
      <NavigationForm action="/explore" method="get" role="search" className={styles.search}>
        <label htmlFor="startup-search" className="sr-only">Search salons, services, or locations</label>
        <input id="startup-search" name="q" type="search" maxLength={200} placeholder="Search salons, services, or locations" autoComplete="off" onChange={event => rememberExploreStartupDraft(event.currentTarget.value, true)} onFocus={event => rememberExploreStartupDraft(event.currentTarget.value, true)} onBlur={event => rememberExploreStartupDraft(event.currentTarget.value, false)} />
        <NavigationSubmitButton pendingLabel="Loading…" type="submit" aria-label="Search">⌕</NavigationSubmitButton>
      </NavigationForm>
    </header>
    <main className={styles.main}>
      <p className={styles.eyebrow}>YOUR NEXT BEAUTY MOMENT</p>
      <h1>Find a little inspiration.</h1>
      <p className={styles.intro}>Explore places, services and ideas for your next visit.</p>
      <nav aria-label="Discover Reylumi" className={styles.categories}>
        <Link href="/explore?category=Nails" prefetch={false}><span aria-hidden="true">✧</span>Nails</Link>
        <Link href="/explore?category=Hair" prefetch={false}><span aria-hidden="true">〰</span>Hair</Link>
        <Link href="/explore" prefetch={false}><span aria-hidden="true">⌖</span>Explore places</Link>
        <Link href="/market" prefetch={false}><span aria-hidden="true">＋</span>Market</Link>
      </nav>
      {retry ? <section role="status" className={styles.recovery}><p>We couldn’t connect. You can try again.</p><button onClick={retry} type="button">Try again</button></section>
        : <div aria-busy="true" aria-label="Loading places" className={styles.placeholders}><div /><div /></div>}
    </main>
    <nav className={styles.bottom} aria-label="Main navigation"><Link href="/explore" prefetch={false}>Explore</Link><Link href="/market" prefetch={false}>Market</Link><Link href="/legal" prefetch={false}>About Reylumi</Link></nav>
  </div>;
}
