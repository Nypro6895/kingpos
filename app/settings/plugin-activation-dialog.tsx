"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./plugin-activation-dialog.module.css";

export function PluginActivationDialog({ open, onClose, pluginName, marketHref }: {
  open: boolean; onClose: () => void; pluginName: string; marketHref: string;
}) {
  const t = useWorkspaceTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
    return () => { if (element.open) element.close(); };
  }, [open]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={onClose} onClose={() => { if (!dialog.current?.open) onClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className={styles.header}><h2 id={titleId}>{t(pluginName === "Campaigns" ? "Advertising" : pluginName)}</h2><button type="button" aria-label={t("Close dialog")} onClick={onClose}>×</button></div>
    <p id={descriptionId}>{t("Activate this feature in Market.")}</p>
    <div className={styles.actions}><button type="button" onClick={onClose}>{t("Cancel")}</button><Link href={marketHref} prefetch={false} onClick={onClose}>{t("Open Market")}</Link></div>
  </dialog>;
}

export function PluginActivationPage({ pluginName, title, marketHref }: { pluginName: string; title: string; marketHref: string }) {
  const t = useWorkspaceTranslation();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // Reopen when a cached page becomes visible again through navigation.
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return <main className={styles.page}>
    <h1>{t(title)}</h1>
    <button className={styles.activate} type="button" onClick={() => setOpen(true)}>{t("Activate")}</button>
    <PluginActivationDialog open={open} onClose={() => setOpen(false)} pluginName={pluginName} marketHref={marketHref} />
  </main>;
}
