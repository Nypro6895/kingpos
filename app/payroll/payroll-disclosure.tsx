"use client";

import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import styles from "./payroll-mobile.module.css";

/** One copy of each form; desktop expands the same accessible disclosure. */
export function PayrollDisclosure({ summary, children, initiallyOpen = false, expandOnDesktop = true, className = "" }: {
  summary: ReactNode; children: ReactNode; initiallyOpen?: boolean; expandOnDesktop?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => setOpen(expandOnDesktop && media.matches || initiallyOpen);
    sync(); media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [initiallyOpen, expandOnDesktop]);
  return <details className={`${styles.disclosure} ${className}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={styles.disclosureSummary}>{typeof summary === "string" ? <WorkspaceText text={summary} /> : summary}<span aria-hidden="true" className={styles.chevron}>⌄</span></summary>
    <div className={styles.disclosureBody}>{children}</div>
  </details>;
}
