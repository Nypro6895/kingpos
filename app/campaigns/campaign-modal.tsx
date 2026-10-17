"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./campaign-ui.module.css";
export function CampaignModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId(), t = useWorkspaceTranslation();
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); }; }, []);
  return createPortal(<dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}><WorkspaceText text={title} /></h2><button type="button" className={styles.close} disabled={busy} aria-label={t("Close dialog")} onClick={onClose}>×</button></header>{children}
  </dialog>, document.body);
}
