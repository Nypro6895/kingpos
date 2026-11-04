import { WorkspaceText } from "@/components/workspace-language";
import type { OwnerAppStatus } from "@/lib/market-platform/owner-app-status";
import styles from "./developer-apps.module.css";

export function AppStatus({status}: {status: OwnerAppStatus}) {
  return <div className={styles.appStatus} data-app-status={status.kind}>
    <strong><WorkspaceText text={status.label} /></strong>
    <p><WorkspaceText text={status.detail} /></p>
  </div>;
}
