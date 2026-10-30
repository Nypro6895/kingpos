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
import { PortableFullscreenButton } from "./portable-fullscreen-button";
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
  const [applicationError, setApplicationError] = useState("");
  async function runApplicationAction(action: "help" | "reopen" | "offline" | "updates" | "about" | "minimize" | "zoomIn" | "zoomOut" | "resetZoom") {
    setApplicationError("");
    try { await desktopDevice()?.windowControls?.action?.(action); }
    catch { setApplicationError("Unable to open this application control. Please try again."); }
  }
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  if (desktopOnly && !desktop) return null;
  return <>
    <button type="button" aria-label={t("Device settings")} title={t("Device settings")} onClick={() => setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-orange-500"><WorkspaceNavigationIcon name="gear" className="h-5 w-5" /></button>
    {open && createPortal(<dialog ref={dialog} aria-label={t("Device settings")} onClose={() => setOpen(false)} className="portable-device-settings" data-touch-keyboard="off">
      <header><h2><WorkspaceText text="Settings" /></h2><button type="button" aria-label={t("Close settings")} onClick={() => dialog.current?.close()}>×</button></header>
      <DeviceInputSettings />
      <section className="device-setting-section" aria-label={t("Customer display")}>
        <h3><WorkspaceText text="Customer display" /></h3>
        {desktop && <button type="button" className="device-setting-action" onClick={() => { void desktopDevice()?.display?.open().catch(() => setApplicationError("Connect once to prepare the customer screen, then try again.")); }}><WorkspaceText text="Open customer display" /></button>}
        <details><summary><WorkspaceText text="Display settings" /></summary><CustomerDisplayPreferencesEditor /><DeviceAppearance salonId={workspace?.scope.split(':')[0]} /></details>
      </section>
      {desktop && <>
        <section className="device-setting-section" aria-label={t("Window")}>
          <h3><WorkspaceText text="Window" /></h3>
          <div className="device-setting-window"><PortableFullscreenButton />
            {desktopDevice()?.windowControls?.action && <button type="button" className="device-setting-action" onClick={() => runApplicationAction("minimize")}><WorkspaceText text="Minimize" /></button>}
          </div>
          {desktopDevice()?.windowControls?.action && <div className="device-setting-actions"><button type="button" className="device-setting-action" onClick={() => runApplicationAction("zoomOut")}><WorkspaceText text="Zoom out" /></button><button type="button" className="device-setting-action" onClick={() => runApplicationAction("zoomIn")}><WorkspaceText text="Zoom in" /></button><button type="button" className="device-setting-action" onClick={() => runApplicationAction("resetZoom")}><WorkspaceText text="Reset zoom" /></button></div>}
        </section>
        <section className="device-setting-section" aria-label={t("Application")}>
          <h3><WorkspaceText text="Application" /></h3>
          {desktopDevice()?.windowControls?.action ? <div className="device-setting-actions">
            <button type="button" className="device-setting-action" onClick={() => runApplicationAction("updates")}><WorkspaceText text="Check for updates" /></button>
            <button type="button" className="device-setting-action" onClick={() => runApplicationAction("about")}><WorkspaceText text="About KingPOS" /></button>
            <button type="button" className="device-setting-action" onClick={() => runApplicationAction("help")}><WorkspaceText text="Help" /></button>
            <button type="button" className="device-setting-action" onClick={() => runApplicationAction("offline")}><WorkspaceText text="Offline readiness" /></button>
            <button type="button" className="device-setting-action" onClick={() => runApplicationAction("reopen")}><WorkspaceText text="Open POS again" /></button>
          </div> : <button type="button" className="device-setting-action" onClick={() => desktopDevice()?.windowControls?.menu()}><WorkspaceText text="Application tools" /></button>}
          <DesktopUpdate />
        </section>
      </>}
      {applicationError && <p role="alert"><WorkspaceText text={applicationError} /></p>}
    </dialog>, document.body)}
  </>;
}
