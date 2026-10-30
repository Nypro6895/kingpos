/* eslint-disable @next/next/no-img-element -- Small local layout illustrations. */
import type { SalonProfilePreferences } from "@/lib/salon-profile-preferences";
import styles from "./profile-layout-thumbnail.module.css";

// A miniature of the same mobile section order; decorative, not a second radio.
export function ProfileLayoutThumbnail({ layout }: { layout: SalonProfilePreferences["layout"] }) {
  return <span className={styles.thumbnail} data-layout={layout} aria-hidden="true">
    <span className={styles.identity}><i/><span/></span>
    <span className={styles.tabs}><i/><i/><i/><i/></span>
    <span className={styles.welcome}>
      <img src="/images/profile-defaults/botanical-welcome.webp" alt="" loading="lazy"/>
      <span className={styles.title}/><span className={styles.copy}/><span className={styles.cta}/>
    </span>
    {layout === "portfolio" ? <>
      <img className={styles.featured} src="/images/profile-defaults/thumbnail-nails-01.webp" alt="" loading="lazy"/>
      <span className={styles.work}><img src="/images/profile-defaults/thumbnail-nails-02.webp" alt="" loading="lazy"/><img src="/images/profile-defaults/thumbnail-nails-03.webp" alt="" loading="lazy"/><img src="/images/profile-defaults/thumbnail-nails-04.webp" alt="" loading="lazy"/></span>
    </> : <span className={styles.services}>{[1,2,3].map(row=><span key={row}><i/><b/><em/></span>)}</span>}
    <span className={styles.visit}/>
  </span>;
}
