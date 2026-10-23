import type { ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import styles from "./reports.module.css";

export function ReportIcon({ kind }: { kind: "chevron" | "cash" | "card" | "other" | "calendar" | "filter" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "filter" ? <><path d="M3 6h8m4 0h6M3 12h3m4 0h11M3 18h11m4 0h3" /><circle cx="13" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></> : kind === "chevron" ? <path d="m9 5 7 7-7 7" /> : kind === "calendar" ? <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></> : kind === "cash" ? <><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M5 9h1m12 6h1" /></> : kind === "card" ? <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20M6 15h4" /></> : <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
  </svg>;
}

/** Presentation only: contents remain mounted so expanding never reloads report data. */
export function ReportDetails({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return <details className={styles.details}>
    <summary><span><WorkspaceText text={title} />{meta ? <span className={styles.detailMeta}>{meta}</span> : null}</span><ReportIcon kind="chevron" /></summary>
    <div className={styles.detailBody}>{children}</div>
  </details>;
}
