"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";
import { setSupplementalKeyboard, useSupplementalKeyboard } from "@/lib/portable-keyboard-preference";
import { saveCustomerDisplayPreferences, useCustomerDisplayPreferences } from "@/lib/customer-display-preferences";
import { prepareLocalPromotionImages, saveLocalPromotionImages, useLocalPromotionImages } from "@/lib/customer-display-local-images";
import { DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL } from "@/lib/pos-display-default-assets";
import { desktopDevice, type DesktopUpdateState } from "@/lib/portable-device-storage";
import { dialogOutsideClick, dialogOutsidePointerDown } from "@/lib/dialog-outside-dismiss";
import "./device-input-settings.css";

const subscribeDesktop = () => () => {};
const readDesktop = () => Boolean(desktopDevice());
const serverDesktop = () => false;

function ExternalIcon() { return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 3h7v7m0-7L10 14M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></svg>; }

export function DeviceInputSettings() {
  const t = useWorkspaceTranslation(); const enabled = useSupplementalKeyboard(); const [error, setError] = useState(false);
  return <div data-touch-keyboard="off">
    <div className="device-list-row"><span><WorkspaceText text="Keyboard" /></span><button type="button" aria-pressed={enabled} onClick={() => {
      try { setSupplementalKeyboard(!enabled); setError(false); } catch { setError(true); }
    }}>{t(enabled ? "Turn off keyboard" : "Turn on keyboard")}</button></div>
    {error && <p role="alert"><WorkspaceText text="Unable to save this device setting. Please try again." /></p>}
  </div>;
}

export function CustomerDisplayPreferencesEditor() {
  const t = useWorkspaceTranslation(); const preferences = useCustomerDisplayPreferences(); const images = useLocalPromotionImages();
  const picker = useRef<HTMLInputElement>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  function save(patch: Partial<typeof preferences>) { try { saveCustomerDisplayPreferences({...preferences,...patch}); setError(""); } catch { setError("Unable to save this device setting. Please try again."); } }
  const preview = images[0] ?? DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL;
  return <>
    <div className="device-list-row"><span><WorkspaceText text="Promotion" /></span><button type="button" aria-pressed={preferences.adsEnabled} onClick={() => save({adsEnabled:!preferences.adsEnabled})}><WorkspaceText text={preferences.adsEnabled ? "Turn off" : "Turn on"} /></button></div>
    <div className="device-list-row device-layout-row"><span><WorkspaceText text="Layout" /></span><div className="device-layout-options" role="group" aria-label={t("Promotion layout")}>
      {(["split", "full"] as const).map(layout => <button key={layout} type="button" aria-pressed={preferences.layout===layout} aria-label={t(layout === "split" ? "Beside check-in" : "Full screen promotion")} onClick={() => save({layout})}>
        <span className={`device-layout-thumbnail device-layout-${layout}`} aria-hidden="true"><img src={preview} alt="" />{layout === "split" && <span><i /><i /><i /><i /><i /><i /></span>}</span>
        <span><WorkspaceText text={layout === "split" ? "Split" : "Full"} /></span>
      </button>)}
    </div></div>
    <div className="device-list-row"><span><WorkspaceText text="Promotion images" /></span><div className="device-image-controls"><div className="device-image-previews">{(images.length ? images : [DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL]).map((image,index)=><img key={index} src={image} alt={t(images.length ? `Promotion image ${index+1}` : "Default promotion image")} />)}</div><button type="button" disabled={busy} onClick={() => picker.current?.click()}><WorkspaceText text={busy ? "Saving…" : "Upload"} /></button></div></div>
    <input ref={picker} className="device-image-picker" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple aria-label={t("Upload promotion images")} onChange={async event => {
      const files=Array.from(event.currentTarget.files ?? []); event.currentTarget.value=""; if (!files.length) return;
      setBusy(true);setError("");try { const images = await prepareLocalPromotionImages(files); try { saveLocalPromotionImages(images); } catch { throw new Error("Unable to save images on this device. Choose smaller images and try again."); } } catch(error) { setError(error instanceof Error ? error.message : "Unable to save images on this device."); } finally { setBusy(false); }
    }} />
    {images.length>0 && <div className="device-list-row"><span><WorkspaceText text="Default image" /></span><button type="button" disabled={busy} onClick={()=>{try{saveLocalPromotionImages([]);setError("");}catch{setError("Unable to save images on this device.");}}}><WorkspaceText text="Restore" /></button></div>}
    <p className="device-local-caption"><WorkspaceText text="Images are saved on this device. Up to 4 images." /></p>
    {error && <p role="alert"><WorkspaceText text={error} /></p>}
  </>;
}

function ApplicationSettings() {
  const t=useWorkspaceTranslation();const [state,setState]=useState<DesktopUpdateState|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{let live=true;const read=()=>{void desktopDevice()?.updates?.state().then(value=>{if(live)setState(value);}).catch(()=>{});};read();const timer=setInterval(read,2000);return()=>{live=false;clearInterval(timer);};},[]);
  async function update(){setBusy(true);setError("");try{await desktopDevice()?.windowControls?.action?.("updates");const next=await desktopDevice()?.updates?.state();if(next)setState(next);}catch{setError("Unable to check for updates. Please try again.");}finally{setBusy(false);}}
  const available=Boolean(state?.version && ["available","ready","downloading"].includes(state.phase));
  const label=busy||state?.phase==="checking"?"Checking…":state?.phase==="downloading"?"Downloading…":available?"Update":state?.phase==="idle"?"Up to date":"Check";
  return <section className="device-setting-section" aria-label={t("Application")}><h3><WorkspaceText text="Application" /></h3>
    <div className="device-list-row"><span><WorkspaceText text="Check for updates" /></span><button type="button" disabled={busy||state?.phase==="checking"||state?.phase==="downloading"||!desktopDevice()?.windowControls?.action} onClick={()=>void update()}><WorkspaceText text={label} /></button></div>
    <div className="device-list-row"><span><WorkspaceText text="About" /></span><span className="device-version">{state?.currentVersion ? `KingPOS ${state.currentVersion}` : "—"}</span></div>
    <div className="device-list-row"><span><WorkspaceText text="Help" /></span><a href="https://reylumi.com/help/windows-portable" target="_blank" rel="noreferrer" aria-label={t("Open help website")} onClick={event=>{const action=desktopDevice()?.windowControls?.action;if(action){event.preventDefault();void action("help").catch(()=>setError("Unable to open Help. Please try again."));}}}><ExternalIcon /></a></div>
    {state?.message && <p role="status"><WorkspaceText text={state.message} /></p>}{error&&<p role="alert"><WorkspaceText text={error} /></p>}
  </section>;
}

export function DeviceInputSettingsButton({ desktopOnly=false }: {desktopOnly?:boolean}) {
  const t=useWorkspaceTranslation();const [open,setOpen]=useState(false);const [error,setError]=useState("");const dialog=useRef<HTMLDialogElement>(null);const desktop=useSyncExternalStore(subscribeDesktop,readDesktop,serverDesktop);
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);if(desktopOnly&&!desktop)return null;
  return <><button type="button" aria-label={t("Device settings")} title={t("Device settings")} onClick={()=>setOpen(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-600 transition hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-orange-500"><WorkspaceNavigationIcon name="gear" className="h-5 w-5" /></button>
    {open&&createPortal(<dialog ref={dialog} onPointerDown={dialogOutsidePointerDown} onClick={dialogOutsideClick} aria-label={t("Device settings")} onClose={()=>setOpen(false)} className="portable-device-settings" data-touch-keyboard="off"><header><h2><WorkspaceText text="Settings" /></h2><button type="button" aria-label={t("Close settings")} onClick={()=>dialog.current?.close()}>×</button></header>
      <DeviceInputSettings />
      <section className="device-setting-section" aria-label={t("Customer display")}><h3><WorkspaceText text="Customer display" /></h3>
        {desktop&&<div className="device-list-row"><span><WorkspaceText text="Customer screen" /></span><button type="button" onClick={()=>{setError("");void desktopDevice()?.display?.open().catch(()=>setError("Open the POS tab first, then try again."));}}><WorkspaceText text="Open" /></button></div>}
        <CustomerDisplayPreferencesEditor />
      </section>
      {desktop&&<ApplicationSettings />}{error&&<p role="alert"><WorkspaceText text={error}/></p>}
    </dialog>,document.body)}
  </>;
}
