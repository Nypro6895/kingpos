import { WorkspaceText } from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import styles from "./personal-qr.module.css";

/** Public chrome only: never seed a code, customer, visit or camera before the
 * original identity and fresh QR readers have accepted this workspace. */
export function PersonalQrLoading({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return <main className={styles.page} data-personal-qr-pending aria-busy={!error}>
    <h1 data-personal-qr-title><WorkspaceText text="My QR" /></h1>
    {error ? <div role="alert" className={styles.notice}><WorkspaceText text={error} />{onRetry && <button type="button" onClick={onRetry}><WorkspaceText text="Refresh" /></button>}</div> :
      <section className={`${styles.card} ${styles.identity}`} aria-label="Personal identity QR">
        <p className={styles.empty} role="status"><WorkspaceText text="Loading your QR…" /></p>
        <h2><WorkspaceText text="Personal ID" /></h2>
        <p className={styles.muted}><WorkspaceText text="Show this QR to connect with a salon." /></p>
      </section>}
    <button type="button" className={styles.scan} disabled><WorkspaceNavigationIcon name="qr" /><WorkspaceText text="Scan salon QR" /></button>
  </main>;
}
