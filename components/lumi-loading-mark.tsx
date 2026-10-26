import styles from "./lumi-loading-mark.module.css";

/** A CSS orbit is available with the loading HTML; it never holds content back. */
export function LumiLoadingMark({ compact = false }: { compact?: boolean }) {
  return <span className={`${styles.mark} ${compact ? styles.compact : ""}`} data-lumi-loading-mark aria-hidden="true">
    <svg viewBox="0 0 112 112" className={styles.track} focusable="false">
      <circle cx="56" cy="56" r="50" fill="none" stroke="currentColor" strokeOpacity="0.12" />
      <g className={styles.comet}>
        {Array.from({ length: 20 }, (_, index) => <circle key={index} cx="56" cy="56" r="50" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 310" strokeOpacity={(index + 1) / 20} transform={`rotate(${-190 + index * 5} 56 56)`} />)}
        <path d="m56 0 2.5 3.5L62 6l-3.5 2.5L56 12l-2.5-3.5L50 6l3.5-2.5Z" fill="currentColor" />
      </g>
    </svg>
    {/* Reuse the shipped mark, including the browser's existing favicon cache. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/brand/reylumi-favicon.png" width="44" height="44" alt="" decoding="async" className={styles.logo} />
  </span>;
}
