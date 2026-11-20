"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUnusedRecordAction } from "./delete-unused-action";

export function DeleteUnusedButton({ kind, id, name, disabled = false, expectedSalonId, onDeleted }: {
  kind: "staff" | "services"; id: string; name: string; disabled?: boolean; expectedSalonId?: string; onDeleted?: () => void | Promise<void>;
}) {
  const __vt = useWorkspaceTranslation();

  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div className="p-2 text-xs">
    {confirming ? <div className="grid gap-2">
      <p><WorkspaceText text="Delete “" />{name}<WorkspaceText text="” permanently? Its setup will be removed. Financial records and bookings in use prevent deletion." /><WorkspaceText text={kind === "staff" ? " The linked person's login account will be kept." : ""} /></p>
      <button type="button" disabled={disabled || pending} className="text-red-700" onClick={() => startTransition(async () => {
        setMessage("");
        try {
          const result = await deleteUnusedRecordAction(kind, id, expectedSalonId);
          if (!result.ok) { setMessage(result.message); setConfirming(false); }
          else { setConfirming(false); if (onDeleted) await onDeleted(); else router.refresh(); }
        } catch { setMessage("Could not delete. Check your connection and try again."); }
      })}><WorkspaceText text={pending ? "Deleting…" : "Confirm delete"} /></button>
      <button type="button" disabled={pending} onClick={() => setConfirming(false)}><WorkspaceText text="Cancel" /></button>
    </div> : <button type="button" disabled={disabled || pending} className="text-red-700 disabled:opacity-50" aria-label={__vt(`Delete ${name}`)} onClick={() => { setMessage(""); setConfirming(true); }}><WorkspaceText text="Delete" /></button>}
    {message ? <p role="alert" className="mt-2 text-red-700"><WorkspaceText text={message} /></p> : null}
  </div>;
}
