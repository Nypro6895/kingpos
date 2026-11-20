import { WorkspaceText } from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import styles from "./scan.module.css";

/** Public frame only: no camera, customer rows or workspace capability. */
export function StaffScanLoading() {
  return <main className={styles.page} data-staff-scan aria-busy="true">
    <h1 data-scan-title><WorkspaceText text="Scan" /></h1>
    <button type="button" className={styles.scanButton} disabled><WorkspaceNavigationIcon name="qr" /><WorkspaceText text="Scan QR" /></button>
    <p className={styles.muted} role="status"><WorkspaceText text="Loading…" /></p>
  </main>;
}
