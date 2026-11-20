"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { desktopDevice, type DesktopUpdateState } from "@/lib/portable-device-storage";
import "./desktop-update.css";

// Mounted only after an explicit Update click. A status panel leaves business
// dialogs and the legacy host's fail-closed installer check intact.
export function DesktopUpdate({ onClose }: { onClose: () => void }) {
  const t = useWorkspaceTranslation();
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const request = useRef<Promise<DesktopUpdateState> | null>(null);

  const start = useCallback(() => {
    if (request.current) return;
    const updates = desktopDevice()?.updates;
    if (!updates) { setError("Updates are unavailable for this edition."); setBusy(false); return; }
    setBusy(true); setError("");
    setState(value => value ? { ...value, phase: "checking", message: "", progress: 0 } : null);
    // Settings uses the browser top layer. Wait for its close/unmount before
    // invoking either host; never close a receipt or business dialog.
    request.current = new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      .then(() => {
        // Older hosts do not know the operationBusy flag. Protect an in-flight
        // Submit/Reset before entering their native updater too.
        const flush = new CustomEvent<{ saved: boolean; operationBusy?: boolean }>("kingpos:desktop-flush", { detail: { saved: false } });
        window.dispatchEvent(flush);
        if (flush.detail.operationBusy) throw Error("KINGPOS_OPERATION_BUSY");
        return updates.now();
      });
    void request.current.then(setState).catch(error => setError(error instanceof Error && error.message === "KINGPOS_OPERATION_BUSY"
      ? "Finish the current operation, then choose Retry update."
      : "Unable to update. Your current version has been kept. Please try again."))
      .finally(() => { request.current = null; setBusy(false); });
  }, []);
  useEffect(() => {
    let live = true;
    const read = () => { void desktopDevice()?.updates?.state().then(value => { if (live) setState(value); }).catch(() => {}); };
    read(); const timer = setInterval(read, 1000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  useEffect(() => { queueMicrotask(start); }, [start]);

  const active = !error && (busy || ["checking", "downloading", "preparing", "installing"].includes(state?.phase ?? ""));
  const progress = Math.max(0, Math.min(100, state?.progress ?? 0));
  const title = error ? "Update needs your attention" : state?.phase === "downloading" ? "Downloading update" : state?.phase === "preparing" ? "Saving your work" : state?.phase === "installing" ? "Installing and restarting" : active ? "Checking for updates" : state?.phase === "idle" ? "KingPOS is up to date" : "Update needs your attention";
  return createPortal(<aside className="desktop-update-status" role="status" aria-live="polite" aria-label={t("KingPOS update")}>
    <header><div className="desktop-update-symbol" aria-hidden="true">↻</div><div><h2><WorkspaceText text={title} /></h2><small>KingPOS {state?.version || state?.currentVersion || ""}</small></div>
      {!active && <button type="button" aria-label={t("Close update status")} onClick={onClose}>×</button>}
    </header>
    {state?.phase === "downloading" && <><div className="desktop-update-progress" role="progressbar" aria-label={t("Download progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div><p>{progress}% · <WorkspaceText text="KingPOS will install and reopen when the download is ready." /></p></>}
    {active && state?.phase !== "downloading" && <p><WorkspaceText text={state?.message || "Your saved tickets will be kept. KingPOS will reopen after updating."} /></p>}
    {!active && (error || state?.message) && <p><WorkspaceText text={error || state!.message} /></p>}
    {!active && <footer><button type="button" onClick={onClose}><WorkspaceText text="Close" /></button>{(error || state?.phase !== "idle") && <button type="button" className="desktop-update-primary" onClick={start}><WorkspaceText text="Retry update" /></button>}</footer>}
  </aside>, document.body);
}
