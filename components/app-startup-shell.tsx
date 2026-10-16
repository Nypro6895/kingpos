import { StartupLink as Link, StartupRecovery, StartupSearchForm } from "./startup-controls";
import { LumiLoadingMark } from "./lumi-loading-mark";
import { StartupReady } from "./startup-ready";
import styles from "./app-startup-shell.module.css";

/** Public, useful controls can paint before identity or optional services resolve. */
export function AppStartupShell({ retry }: { retry?: () => void }) {
  return <div className={styles.shell} data-startup-shell="public">
    <StartupReady />
    <header className={styles.header}>
      <Link href="/explore" prefetch={false} className={styles.brand} aria-label="Reylumi Explore">Reylumi<span aria-hidden="true">✦</span></Link>
      <StartupSearchForm className={styles.search} />
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
      {retry ? <section role="status" className={styles.recovery}><StartupRecovery retry={retry} /></section>
        : <><div className={styles.loading} role="status" aria-label="Opening Reylumi"><LumiLoadingMark compact /></div><div aria-busy="true" aria-label="Loading places" className={styles.placeholders}><div /><div /></div></>}
    </main>
    <nav className={styles.bottom} aria-label="Main navigation"><Link href="/explore" prefetch={false}>Explore</Link><Link href="/market" prefetch={false}>Market</Link><Link href="/legal" prefetch={false}>About Reylumi</Link></nav>
  </div>;
}
