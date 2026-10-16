"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { WorkspaceText } from "@/components/workspace-language";
import { confirmStaffAccountAccess } from "./offline-binding-actions";

export function StaffOfflineBindingControl({ staffId, viewerId, scope, initialRevision }: { staffId: string; viewerId: string; scope: string; initialRevision: string | null }) {
  const [state, action] = useActionState(confirmStaffAccountAccess, { status: "idle" as const, message: "", approved: Boolean(initialRevision), revision: initialRevision });
  return <form action={action} className="mt-4 grid gap-3 rounded-lg border border-zinc-200 p-4">
    <h4 className="text-sm font-semibold"><WorkspaceText text="Staff account access" /></h4>
    <p className="text-sm text-zinc-600"><WorkspaceText text={state.approved ? "This account is confirmed for this staff member." : "Review the connected account above before confirming it."} /></p>
    <p className="text-sm text-zinc-600"><WorkspaceText text="This staff member can view their previously loaded work and pay without connecting for up to 24 hours. Removing access takes effect when they reconnect or that time expires. Payments and other changes still need their usual confirmation." /></p>
    <input type="hidden" name="staff_id" value={staffId} /><input type="hidden" name="viewer_id" value={viewerId} /><input type="hidden" name="scope" value={scope} /><input type="hidden" name="revision" value={state.revision ?? ""} />
    {!state.approved ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmed" value="yes" required className="mt-1 h-4 w-4" /><WorkspaceText text="I confirm this account belongs to this staff member." /></label> : null}
    <SubmitButton name="decision" value={state.approved ? "revoke" : "approve"} pendingLabel="Updating…" className="min-h-11 w-fit rounded-md border border-zinc-300 px-4 text-sm font-medium"><WorkspaceText text={state.approved ? "Remove device access" : "Confirm account"} /></SubmitButton>
    {state.message ? <p role={state.status === "error" ? "alert" : "status"} className="text-sm"><WorkspaceText text={state.message} /></p> : null}
  </form>;
}
