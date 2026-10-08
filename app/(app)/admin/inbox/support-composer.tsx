"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSupportNoteAction, sendSupportReplyAction } from "./actions";
import type { AdminActionResult } from "../_components/action-form";

export function SupportComposer({ threadId, recipient, from, emailReady, canReply, canManage, blocked, onComplete }: { threadId: string; recipient: string; from: string; emailReady: boolean; canReply: boolean; canManage: boolean; blocked: boolean; onComplete?: (result: AdminActionResult) => void }) {
  const router = useRouter();
  const requestId = useRef<string | null>(null);
  const [kind, setKind] = useState("note");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const selectedKind = canReply && emailReady && !blocked && kind === "email_reply" ? "email_reply" : canManage ? kind === "manual_reply" ? "manual_reply" : "note" : "email_reply";
  const disabled = pending || !body.trim() || selectedKind === "email_reply" && (!emailReady || blocked || !preview);
  return <form className="grid gap-4" onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    const form = new FormData();
    requestId.current ??= crypto.randomUUID();
    form.set("request_id", requestId.current); form.set("thread_id", threadId); form.set("body", body); form.set("kind", selectedKind);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = selectedKind === "email_reply" ? await sendSupportReplyAction(form) : await addSupportNoteAction(form);
        setNotice(result);
        onComplete?.(result);
        if (result.ok) { setBody(""); setPreview(false); requestId.current = null; }
        else if (result.rotateRequest) requestId.current = null;
        router.refresh();
      } catch { setNotice({ ok: false, message: "The result could not be confirmed. Refresh the conversation before trying again." }); router.refresh(); }
    });
  }}>
    <fieldset disabled={pending} className="grid gap-4">
      <label className="grid gap-1.5 text-sm font-medium">Action<select className="rounded-lg border border-zinc-300 bg-white px-3 py-2" value={selectedKind} onChange={event => { setKind(event.target.value); setPreview(false); requestId.current = null; }}>
        {canManage && <><option value="note">Internal note — not sent to the customer</option><option value="manual_reply">Record a reply sent outside Reylumi</option></>}
        {canReply && <option value="email_reply" disabled={!emailReady || blocked}>Email reply{!emailReady ? " — email not connected" : blocked ? " — delivery needs review or message is spam" : ""}</option>}
      </select></label>
      {selectedKind === "email_reply" && <p className="text-xs text-zinc-500">From {from} · To {recipient}. Customer replies go to the support mailbox.</p>}
      {selectedKind === "manual_reply" && <p className="text-xs text-zinc-500">Record what you already sent using your email app. Saving this entry does not send an email.</p>}
      <label className="grid gap-1.5 text-sm font-medium">{selectedKind === "email_reply" ? "Reply to customer" : selectedKind === "manual_reply" ? "Reply already sent" : "Internal note"}<textarea value={body} required maxLength={5000} rows={6} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-normal" onChange={event => { setBody(event.target.value); setPreview(false); setNotice(null); requestId.current = null; }} /></label>
      {selectedKind === "email_reply" && <><button type="button" onClick={() => setPreview(true)} disabled={!body.trim()} className="justify-self-start rounded-lg border border-zinc-200 px-3 py-2 text-sm">Preview reply</button>{preview && <div className="rounded-xl border border-orange-200 bg-orange-50 p-4"><p className="text-xs font-semibold text-orange-800">Email preview · {recipient}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{body}</p><p className="mt-3 text-xs text-zinc-500">Reylumi Support · {from}</p></div>}</>}
      <button type="submit" disabled={disabled} className="justify-self-start rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Processing…" : selectedKind === "email_reply" ? "Send email reply" : "Save entry"}</button>
    </fieldset>
    {notice && <p role={notice.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{notice.message}</p>}
  </form>;
}
