"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { SalonPublicationStatus } from "@/components/salon-publication-status";
import { SubmitButton } from "@/components/submit-button";
import type { SalonProfileReadiness, SalonProfileSetting } from "@/types/salon-profile";

export function PublicationPanel({ publicHref, readiness, setting, action }: {
  publicHref: string | null;
  readiness: SalonProfileReadiness;
  setting: SalonProfileSetting;
  action: (form: FormData) => void | Promise<void>;
}) {
  const nextEnabled = !setting.public_discovery_enabled;
  return <div className="grid gap-5">
    <SalonPublicationStatus publicHref={publicHref} />
    <p className="text-sm text-zinc-600"><WorkspaceText text="Publishing makes this profile public and allows it to appear in Explore. Booking is configured separately." /></p>
    <p className="text-sm font-semibold"><WorkspaceText text="Required when publishing from this profile" /></p>
    <div>
      <p className="text-sm text-zinc-600">{readiness.completionPercent}<WorkspaceText text="% complete" /></p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${readiness.completionPercent}%` }} /></div>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      {readiness.items.map(item => <div className="border-zinc-200 bg-white p-3 rounded-none border-0 shadow-none" key={item.id}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-950"><WorkspaceText text={item.label} /></p>
          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${item.complete ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}><WorkspaceText text={item.complete ? "Done" : "Missing"} /></span>
        </div>
        <p className="mt-1 text-xs text-zinc-500"><WorkspaceText text={item.required ? "Required" : "Optional"} /></p>
      </div>)}
    </div>
    <form action={action} className="grid gap-2 border-t border-zinc-200 pt-4">
      <input name="salon_id" type="hidden" value={setting.salon_id} />
      <input name="public_discovery_enabled" type="hidden" value={nextEnabled ? "true" : "false"} />
      <SubmitButton className="min-h-11 rounded-md border border-zinc-300 bg-zinc-950 px-4 text-sm font-semibold text-white disabled:opacity-50" disabled={nextEnabled && !readiness.canPublish}>
        <WorkspaceText text={nextEnabled ? "Publish profile" : "Unpublish profile"} />
      </SubmitButton>
      {nextEnabled && !readiness.canPublish ? <p className="text-sm text-zinc-500"><WorkspaceText text="Complete the required items before publishing." /></p> : null}
    </form>
  </div>;
}
