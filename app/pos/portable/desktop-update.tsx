"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { desktopDevice, type DesktopUpdateState } from "@/lib/portable-device-storage";

export function DesktopUpdate() {
  const __vt = useWorkspaceTranslation();

  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => { void desktopDevice()?.updates?.state().then(async value => {
      // Cancel appointments left by older hosts; updates now require an explicit click.
      if (value.scheduledAt) value = await desktopDevice()!.updates!.later();
      if (live) setState(value);
    }).catch(() => {}); };
    read(); const timer = setInterval(read, 2000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!state?.version) return null;
  const canDownload = !!desktopDevice()?.updates?.download;
  const button = "min-h-11 rounded-lg border border-zinc-300 px-4 font-semibold shadow-sm transition hover:bg-zinc-100 active:scale-95 disabled:opacity-50";
  return <>
    <button type="button" aria-label={__vt("Update available")} title={__vt("Update available")} onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg text-amber-700 hover:bg-amber-50">
      <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/></svg>
    </button>
    {open && createPortal(<div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <section onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={__vt("App update")} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold"><WorkspaceText text="A KingPOS update is available" /></h2>
        <p className="mt-3 text-sm text-zinc-600"><WorkspaceText text="Version" /> {state.version}<WorkspaceText text=". Your saved tickets will be kept. KingPOS will reopen after updating." /></p>
        {state.phase === "downloading" && <p className="mt-3 text-sm"><WorkspaceText text="Downloading in the background…" /> {state.progress === undefined ? '' : `${state.progress}%`}</p>}
        {state.message && <p className="mt-3 text-sm"><WorkspaceText text={state.message} /></p>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700"><WorkspaceText text={error} /></p>}
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" className={button} onClick={async () => { try { const next = await desktopDevice()?.updates?.later(); if (next) setState(next); setOpen(false); } catch { setError("Unable to save. Please try again."); } }}><WorkspaceText text="Later" /></button>
          {desktopDevice()?.updates?.download && ['available', 'error'].includes(state.phase) && <button type="button" disabled={busy} className={button} onClick={async () => {
            setBusy(true); setError('');
            try { const next = await desktopDevice()?.updates?.download?.(); if (next) setState(next); }
            catch { setError('Unable to download. Please try again.'); }
            finally { setBusy(false); }
          }}><WorkspaceText text="Download update" /></button>}
          <button type="button" disabled={busy || (state.phase !== 'ready' && !(canDownload && state.phase === 'available'))} className={button + " bg-orange-600 text-white hover:bg-orange-700"} onClick={() => {
            setBusy(true); setError('');
            setOpen(false);
            setTimeout(() => { void desktopDevice()?.updates?.now().then(next => { setState(next); if (next.message) setOpen(true); }).catch(() => { setError("Unable to update. Please try again."); setOpen(true); }).finally(() => setBusy(false)); }, 100);
          }}><WorkspaceText text={state.phase === 'ready' || !canDownload ? 'Update now' : 'Download and install'} /></button>
        </div>
      </section>
    </div>, document.body)}
  </>;
}
