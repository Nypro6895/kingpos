import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText } from "@/components/workspace-language";
import styles from "./loading-feedback.module.css";
import { LumiLoadingStatus } from "./lumi-loading-status";

export function FeedLoadingSkeleton() {
  return <article className={styles.feed} aria-busy="true" aria-label="Loading posts">
    <div aria-hidden="true">
      <div className={styles.feedHeader}>
        <div className={`${styles.skeleton} ${styles.avatar}`} />
        <div className={styles.lines}><div className={`${styles.skeleton} ${styles.line}`} /><div className={`${styles.skeleton} ${styles.short}`} /></div>
      </div>
      <div className={`${styles.skeleton} ${styles.photo}`} />
      <div className={styles.feedFooter}><div className={`${styles.skeleton} ${styles.line}`} /><div className={`${styles.skeleton} ${styles.short}`} /></div>
    </div>
  </article>;
}

export function LoadingStatus({ text = "Finding a little inspiration…" }: { text?: string }) {
  return <p className={styles.status} role="status"><ReylumiIcon name="sparkle" /><WorkspaceText text={text} /></p>;
}

export function PageLoadingSkeleton() {
  return <LumiLoadingStatus text="Getting things ready…" />;
}
