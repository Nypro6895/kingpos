import type { ReactNode } from "react";
import styles from "./registry.module.css";

export function RegistryHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <header className={styles.pageHeader}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h1>{title}</h1>
    <div className={styles.intro}>{children}</div>
  </header>;
}

export function RegistryLoading() {
  return <section className={styles.emptyState} aria-busy="true" role="status">
    <span className={styles.loadingDot} aria-hidden="true" />
    <h1>Loading your workspace</h1>
    <p>Checking access and loading the latest details.</p>
  </section>;
}

export function RegistryUnavailable({ message }: { message?: string }) {
  return <section className={styles.emptyState}>
    <p className={styles.eyebrow}>Private Market workspace</p>
    <h1>This workspace is unavailable</h1>
    <p>{message ?? "The private app submission workspace is not available for this account right now."}</p>
    <p className={styles.muted}>App submissions and reviews here do not publish or install apps in Reylumi.</p>
  </section>;
}

export function MetadataNotice() {
  return <aside className={styles.notice}>
    <strong>Prepare and review app details</strong>
    <p>Approval applies to the submitted details only. It does not publish an app, enable access to salon data, or make it available for installation or purchase.</p>
  </aside>;
}
