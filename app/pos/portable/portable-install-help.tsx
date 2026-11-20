"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useNativeDialogNavigation, useTransientOverlay } from "@/components/overlay-dismissal";
import { dialogOutsideClick, dialogOutsidePointerDown } from "@/lib/dialog-outside-dismiss";
import { portableInstallEnvironment } from "@/lib/portable-install-environment";
import { desktopDevice } from "@/lib/portable-device-storage";
import styles from "./portable-install-help.module.css";

type InstallPrompt = Event & {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const subscribeEnvironment = (changed: () => void) => {
  const display = window.matchMedia("(display-mode: standalone)");
  display.addEventListener("change", changed);
  return () => display.removeEventListener("change", changed);
};
const readEnvironment = () => portableInstallEnvironment({
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
  standalone: window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true,
  native: Boolean(desktopDevice()) || window.location.protocol === "reylumi-app:",
});
const serverEnvironment = () => "hidden" as const;

/** Optional install help; the browser owns the actual Home Screen permission. */
export function PortableInstallHelp({ compact = false }: { compact?: boolean }) {
  const t = useWorkspaceTranslation();
  const environment = useSyncExternalStore(subscribeEnvironment, readEnvironment, serverEnvironment);
  const [open, setOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useTransientOverlay(() => setOpen(false), open);
  useNativeDialogNavigation(dialog);

  useEffect(() => {
    if (environment === "hidden") return;
    const ready = (event: Event) => {
      if (typeof (event as InstallPrompt).prompt !== "function") return;
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const done = () => { setInstalled(true); setPrompt(null); setOpen(false); };
    window.addEventListener("beforeinstallprompt", ready);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", ready);
      window.removeEventListener("appinstalled", done);
    };
  }, [environment]);

  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    // Each browser prompt can be used only once, even after dismissal or failure.
    setPrompt(null);
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") {
        setInstalled(true);
        setOpen(false);
      }
    } catch {
      setError("Use the browser menu to install Reylumi POS, then open its new icon.");
    } finally { setBusy(false); }
  }

  if (environment === "hidden" || installed) return null;

  return <>
    <button type="button" className={`${styles.trigger} ${compact ? styles.compact : styles.login}`}
      aria-label={t("Install Reylumi POS")} title={t("Install Reylumi POS")}
      onClick={() => { setError(""); setOpen(true); }}>
      <svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M12 7v7m-3-3 3 3 3-3M10 18h4" /></svg>
      {!compact && <WorkspaceText text="Install Reylumi POS" />}
    </button>
    {open && createPortal(<dialog ref={dialog} className={styles.dialog} aria-label={t("Install Reylumi POS")}
      onPointerDown={dialogOutsidePointerDown} onClick={dialogOutsideClick} onClose={() => setOpen(false)} data-touch-keyboard="off">
      <div className={styles.header}><h2><WorkspaceText text="Reylumi POS on this device" /></h2>
        <button type="button" className={styles.close} aria-label={t("Close install help")} onClick={() => dialog.current?.close()}>×</button>
      </div>
      <p className={styles.intro}><WorkspaceText text="Add a separate POS icon. It opens directly to Portable in its own window." /></p>
      {environment === "ios" ? <ol className={styles.steps}>
        <li><WorkspaceText text="Open this Portable page in Safari." /></li>
        <li><WorkspaceText text="Tap Share, then Add to Home Screen. Tap More or View More first if needed." /></li>
        <li><WorkspaceText text="Keep the name Reylumi POS and turn on Open as Web App if shown. Tap Add." /></li>
      </ol> : prompt ? <button type="button" className={styles.install} disabled={busy} onClick={() => void install()}><WorkspaceText text={busy ? "Opening…" : "Install POS app"} /></button> : <ol className={styles.steps}>
        <li><WorkspaceText text="Open this Portable page in Chrome or Edge." /></li>
        <li><WorkspaceText text="Choose Install app or Add to Home screen from the browser menu, then confirm." /></li>
      </ol>}
      {error && <p role="alert" className={styles.error}><WorkspaceText text={error} /></p>}
      <p className={styles.note}><WorkspaceText text="Open the new POS icon and sign in with your POS ID. An existing Reylumi icon keeps its original destination; add this new POS icon separately." /></p>
    </dialog>, document.body)}
  </>;
}
