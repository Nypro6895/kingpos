"use client";
import { ProfileLayoutThumbnail } from "./profile-layout-thumbnail";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useState } from "react";
import { SettingsFieldGroup } from "./direct-settings-ui";
import { SalonVerificationPanel } from "./salon-verification-panel";
import { loadSalonProfilePreferencesAction, saveSalonProfilePreferencesAction } from "./salon-profile-preferences-actions";
import { type SalonProfilePreferences } from "@/lib/salon-profile-preferences";
const groups = [
  { title: "Profile appearance", rows: [
    { key: "show_customer_reviews", label: "Show customer review highlights", detail: "Automatically highlight positive public reviews in the middle of your website. All feedback remains available in Experiences." },
    { key: "show_featured", label: "Show featured section", detail: "Show the introduction and featured photo when suitable. Hiding it moves services and visit information up; the photo feed stays available." },
    { key: "show_services", label: "Show Services tab", detail: "Hide the tab and homepage preview without changing your services or online booking." },
    { key: "show_team", label: "Show Team tab", detail: "Hide the team tab and preview without changing staff booking availability." },
  ] },
  { title: "Posts & interactions", rows: [
    { key: "allow_staff_posts", label: "Allow staff to post for the salon", detail: "Uses each staff member's posting permissions. Owners and salon managers can still post." },
    { key: "allow_sharing", label: "Show sharing actions", detail: "Show Share for your salon and its posts. Public links can still be copied." },
    { key: "allow_saves", label: "Allow likes / saves", detail: "The current heart action saves a look. Existing saved looks remain available." },
    { key: "allow_comments", label: "Allow comments", detail: "Allow new comments on salon content. Existing comments remain stored." },
  ] },
];
export function SalonProfilePreferencesPanel({ onSaved, expectedSalonId }: { expectedSalonId?: string; onSaved?: (preferences: SalonProfilePreferences) => void }) {
  const __vt = useWorkspaceTranslation();

  const [preferences, setPreferences] = useState<SalonProfilePreferences | null>(null);
  const [savedPreferences,setSavedPreferences]=useState<SalonProfilePreferences|null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [verificationVisited,setVerificationVisited]=useState(false);
  useEffect(() => { let active = true; loadSalonProfilePreferencesAction(expectedSalonId).then((result) => { if (active) { setPreferences(result.preferences); setSavedPreferences(result.preferences); setMessage(result.error ?? ""); } }).catch(() => { if (active) setMessage("Could not load profile settings. Please try again."); }); return () => { active = false; }; }, [expectedSalonId]);
  if (!preferences) return <p role="status" className="p-4 text-sm text-zinc-500"><WorkspaceText text={message || "Loading profile settings…"} /></p>;
  return <><details onToggle={e=>{if(e.currentTarget.open)setVerificationVisited(true);}}><summary><WorkspaceText text="Salon verification"/></summary><div>{verificationVisited?<SalonVerificationPanel expectedSalonId={expectedSalonId}/>:null}</div></details><form className="grid gap-5" onSubmit={async (event) => { event.preventDefault(); setSaving(true); setMessage(""); try { const result = await saveSalonProfilePreferencesAction(preferences, expectedSalonId); setMessage(result.error ?? "Profile settings saved."); if (!result.error&&result.preferences){setSavedPreferences(result.preferences);onSaved?.(result.preferences);} } catch { setMessage("Could not save profile settings. Please try again."); } finally { setSaving(false); } }}>
    <fieldset className="grid gap-3 rounded-2xl border border-zinc-200 p-4"><legend className="px-1 text-sm font-semibold">Customer website layout</legend><p className="text-xs text-zinc-500">Used on your public profile and owner preview. Staff keep their existing profile view.</p>{([
      ["booking", "A · Booking first", "Services, prices and booking, with a soft welcome background."],
      ["portfolio", "B · Visual portfolio", "An editorial introduction and featured photo, followed by selected work."],
      ["balanced", "C · Neighborhood homepage", "A welcoming introduction, services with photos and practical visit information."],
    ] as const).map(([value, label, description]) => <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${preferences.layout === value ? "border-brand-orange bg-brand-orange-soft" : "border-zinc-200"}`}><input type="radio" name="profile-layout" value={value} checked={preferences.layout === value} disabled={saving} onChange={() => setPreferences({ ...preferences, layout: value })} className="shrink-0 accent-brand-orange"/><ProfileLayoutThumbnail layout={value}/><span className="min-w-0"><strong className="block text-sm">{label}</strong><span className="mt-1 block text-xs text-zinc-500">{description}</span></span></label>)}<p className="text-xs text-zinc-500">Illustrative images keep your website welcoming until you add your own photos. Each upload replaces the default in its position.</p></fieldset>
    {groups.map(group=><SettingsFieldGroup key={group.title} title={group.title}>{group.rows.map(row=><label key={row.key} className="settings-check settings-toggle-field"><input type="checkbox" disabled={saving} checked={Boolean(preferences[row.key as keyof SalonProfilePreferences])} onChange={event=>setPreferences({...preferences,[row.key]:event.currentTarget.checked})}/><span className="settings-toggle-label" title={__vt(row.detail)}><WorkspaceText text={row.label}/></span><span className="settings-toggle-track" aria-hidden="true"><span/></span></label>)}</SettingsFieldGroup>)}
    {preferences.show_customer_reviews ? <fieldset className="rounded-2xl border border-zinc-200 p-4"><legend className="px-1 text-sm font-semibold"><WorkspaceText text="Number of review highlights" /></legend><div className="flex gap-5">{([2,3] as const).map(count=><label key={count} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="customer-review-count" checked={preferences.customer_review_count === count} disabled={saving} onChange={()=>setPreferences({...preferences,customer_review_count:count})} className="accent-brand-orange"/>{count} <WorkspaceText text="reviews" /></label>)}</div><p className="text-xs text-zinc-500"><WorkspaceText text="Higher ratings first, then verified and recent feedback. The section stays hidden when no positive written reviews are available." /></p></fieldset> : null}
    {message ? <p role="status" className="text-sm text-zinc-600"><WorkspaceText text={message} /></p> : null}
    <div className="settings-form-actions"><button type="button" className="settings-button settings-cancel-button" disabled={saving} onClick={()=>{if(savedPreferences)setPreferences({...savedPreferences});setMessage("");}}><WorkspaceText text="Cancel"/></button><button disabled={saving} className="settings-button settings-primary-button" type="submit"><WorkspaceText text={saving ? "Saving…" : "Save profile settings"} /></button></div>
  </form></>;
}
