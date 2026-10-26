"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { setSupplementalKeyboard, useSupplementalKeyboard } from "@/lib/portable-keyboard-preference";
import { desktopDevice } from "@/lib/portable-device-storage";

const subscribeDesktop = () => () => {};
const readDesktop = () => Boolean(desktopDevice());
const serverDesktop = () => false;

export function DeviceInputSettings() {
  const enabled = useSupplementalKeyboard();
  const [error, setError] = useState(false);
  return <div className="settings-style mt-3 grid gap-2" data-touch-keyboard="off">
    <label className="flex min-h-10 cursor-pointer items-start gap-2 py-2 text-sm">
      <input className="mt-1 size-4 shrink-0" type="checkbox" checked={enabled} onChange={event => {
        try { setSupplementalKeyboard(event.target.checked); setError(false); }
        catch { setError(true); }
      }} />
      <WorkspaceText text="Enable supplemental app keyboard" />
    </label>
    <p className="text-sm leading-6 text-zinc-500"><WorkspaceText text="Saved automatically on this device only. Off by default; use your physical or Windows touch keyboard. Built-in POS, staff PIN and customer keypads stay available." /></p>
    {error && <p role="alert" className="text-sm text-red-700"><WorkspaceText text="Unable to save this device setting. Please try again." /></p>}
  </div>;
}

export function DeviceInputSettingsButton({ desktopOnly = false }: { desktopOnly?: boolean }) {
  const t = useWorkspaceTranslation();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, serverDesktop);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  if (desktopOnly && !desktop) return null;
  return <>
    <button type="button" aria-label={t("Device settings")} title={t("Device settings")} onClick={() => setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-orange-500">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/></svg>
    </button>
    {open && createPortal(<dialog ref={dialog} aria-label={t("Device settings")} onClose={() => setOpen(false)} className="settings-style fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-xl backdrop:bg-black/40">
      <h2 className="text-lg font-semibold"><WorkspaceText text="Device settings" /></h2>
      <DeviceInputSettings />
      <form method="dialog" className="mt-4 flex justify-end"><button className="min-h-11 rounded-xl border border-zinc-300 bg-white px-5 text-sm font-semibold"><WorkspaceText text="Done" /></button></form>
    </dialog>, document.body)}
  </>;
}
