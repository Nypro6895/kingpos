"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { setSupplementalKeyboard, useSupplementalKeyboard } from "@/lib/portable-keyboard-preference";
import { saveCustomerDisplayPreferences, useCustomerDisplayPreferences } from "@/lib/customer-display-preferences";
import { desktopDevice } from "@/lib/portable-device-storage";
import { usePortableWorkspaceState } from "./portable-workspace-state";
import { DeviceAppearance } from "@/app/pos/settings/device-appearance";
import { DesktopUpdate } from "./desktop-update";
import "./device-input-settings.css";

const subscribeDesktop = () => () => {};
const readDesktop = () => Boolean(desktopDevice());
const serverDesktop = () => false;

export function DeviceInputSettings() {
  const t = useWorkspaceTranslation();
  const enabled = useSupplementalKeyboard();
  const [error, setError] = useState(false);
  return <div data-touch-keyboard="off">
    <label className="device-setting-check"><span><WorkspaceText text="Keyboard" /></span><input aria-label={t("Keyboard")} type="checkbox" checked={enabled} onChange={event => {
      try { setSupplementalKeyboard(event.target.checked); setError(false); } catch { setError(true); }
    }} /><span className="device-setting-value">{enabled ? 'On' : 'Off'}</span></label>
    {error && <p role="alert"><WorkspaceText text="Unable to save this device setting. Please try again." /></p>}
  </div>;
}

export function CustomerDisplayPreferencesEditor() {
  const preferences = useCustomerDisplayPreferences();
  const [error, setError] = useState(false);
  function save(patch: Partial<typeof preferences>) { try { saveCustomerDisplayPreferences({...preferences,...patch}); setError(false); } catch { setError(true); } }
  return <div className="device-setting-fields">
    <label className="device-setting-check"><span><WorkspaceText text="Idle promotions" /></span><input type="checkbox" checked={preferences.adsEnabled} onChange={event => save({adsEnabled:event.target.checked})} /></label>
    <label><WorkspaceText text="Layout" /><select value={preferences.layout} onChange={event => save({layout:event.target.value==='full'?'full':'split'})}><option value="split"><WorkspaceText text="Promotion beside check-in" /></option><option value="full"><WorkspaceText text="Full promotion" /></option></select></label>
    <div className="device-setting-columns"><label><WorkspaceText text="Start after" /><select value={preferences.idleSeconds} onChange={event => save({idleSeconds:Number(event.target.value)})}>{[0,30,60,90].map(value=><option value={value} key={value}>{value}s</option>)}</select></label>
    <label><WorkspaceText text="Change image after" /><select value={preferences.slideSeconds} onChange={event => save({slideSeconds:Number(event.target.value)})}>{[8,12,15].map(value=><option value={value} key={value}>{value}s</option>)}</select></label></div>
    {error && <p role="alert"><WorkspaceText text="Unable to save this device setting. Please try again." /></p>}
  </div>;
}

export function DeviceInputSettingsButton({ desktopOnly = false }: { desktopOnly?: boolean }) {
  const t = useWorkspaceTranslation();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, serverDesktop);
  const workspace = usePortableWorkspaceState();
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  if (desktopOnly && !desktop) return null;
  return <>
    <button type="button" aria-label={t("Device settings")} title={t("Device settings")} onClick={() => setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-orange-500"><WorkspaceNavigationIcon name="gear" className="h-5 w-5" /></button>
    {open && createPortal(<dialog ref={dialog} aria-label={t("Device settings")} onClose={() => setOpen(false)} className="portable-device-settings" data-touch-keyboard="off">
      <header><h2><WorkspaceText text="Settings" /></h2><button type="button" aria-label={t("Close settings")} onClick={() => dialog.current?.close()}>×</button></header>
      <DeviceInputSettings />
      <details className="device-setting-section"><summary><WorkspaceText text="Customer display" /></summary><CustomerDisplayPreferencesEditor /><DeviceAppearance salonId={workspace?.scope.split(':')[0]} /></details>
      {desktop && <details className="device-setting-section"><summary><WorkspaceText text="Application" /></summary><button type="button" className="device-setting-action" onClick={() => desktopDevice()?.windowControls?.menu()}><WorkspaceText text="Windows app menu" /></button><DesktopUpdate /></details>}
    </dialog>, document.body)}
  </>;
}
