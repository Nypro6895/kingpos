"use client";
import { lazy, Suspense, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { loadDeviceDisplayAppearance, savePosSettingsGroup } from "./actions";
import { notifyCustomerAppearanceChanged } from "@/lib/customer-display-preferences";
import { SettingsGroupForm } from "./settings-group-form";
const OwnerLogin = lazy(() => import("@/app/login/login-form").then(module => ({default:module.LoginForm})));

export function DeviceAppearance({ salonId }: { salonId?: string }) {
  const t = useWorkspaceTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadDeviceDisplayAppearance>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const section = useRef<HTMLDetailsElement>(null);
  function load() { setBusy(true); return loadDeviceDisplayAppearance(salonId).then(setData).catch(() => setData({error:'Unable to load salon appearance.'})).finally(() => setBusy(false)); }
  async function save(form: FormData) {
    const result = await savePosSettingsGroup(form);
    if (result.ok) {
      notifyCustomerAppearanceChanged();
      for (const input of section.current?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? []) input.value = '';
      try { const updated = await loadDeviceDisplayAppearance(salonId); if (updated.settings) setData(updated); } catch { /* Keep the committed save and current inputs. */ }
    }
    return result;
  }
  return <details ref={section} className="device-setting-section" onToggle={event => {
    if (!event.currentTarget.open || busy || data) return;
    void load();
  }}><summary><WorkspaceText text="Salon images & promotions" /></summary>
    {busy && <p role="status"><WorkspaceText text="Loading" /></p>}
    {data?.error && <p role="status"><WorkspaceText text={data.error} /></p>}
    {data?.error?.startsWith('Sign in') && !signIn && <button type="button" className="device-setting-action" onClick={() => setSignIn(true)}><WorkspaceText text="Owner sign-in" /></button>}
    {signIn && <Suspense fallback={<p><WorkspaceText text="Loading" /></p>}><OwnerLogin onAuthenticated={() => {setSignIn(false);void load();}} /></Suspense>}
    {data?.settings && <SettingsGroupForm group="appearance" snapshot={data.snapshot ?? {}} saveAction={save}>
      <input type="hidden" name="salon_id" value={data.salonId} />
      {([
        ['background','customer_background_image','Check-in background',data.settings.customerBackgroundImageUrl],
        ['left-ad','customer_left_ad_image','Promotion image',data.settings.customerLeftAdImageUrl],
        ['right-ad','customer_right_ad_image','Second promotion image',data.settings.customerRightAdImageUrl],
      ] as const).map(([kind,name,label,url]) => <div className="device-media-field" key={kind}>
        <label><WorkspaceText text={label} /><input type="file" name={`appearance_${kind}`} accept="image/jpeg,image/png,image/webp" /></label>
        {url && <img src={url} alt={t(label)} />}
        {url && <label className="device-setting-check"><input type="checkbox" name={`remove_${name}`} /><WorkspaceText text="Use default image" /></label>}
      </div>)}
      <label><WorkspaceText text="Promotion title" /><input name="customer_left_ad_text" maxLength={160} defaultValue={data.settings.customerLeftAdText} /></label>
      <label><WorkspaceText text="Promotion text" /><textarea name="customer_right_ad_text" rows={3} maxLength={500} defaultValue={data.settings.customerRightAdText} /></label>
    </SettingsGroupForm>}
  </details>;
}
