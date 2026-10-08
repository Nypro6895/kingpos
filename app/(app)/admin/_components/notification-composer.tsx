"use client";
import { useState } from "react";
import { AdminActionForm } from "./action-form";
import { sendAdminNotificationAction } from "../workflow-actions";
import { EntityPicker } from "./entity-picker";

export function NotificationComposer({ userId }: { userId?: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState(false);
  return <AdminActionForm action={async form => {
    const result = await sendAdminNotificationAction(form);
    if (result.ok) { setRequestId(crypto.randomUUID()); setPreview(false); setTitle(""); setBody(""); }
    return result;
  }} resetOnSuccess className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-5" confirmMessage="Send this notification to the selected user's in-app inbox?">
    <p className="text-sm text-zinc-500">In-app delivery. Recipient preferences are respected. Internal notes are never included.</p>
    {userId ? <input name="user_id" type="hidden" value={userId} /> : <EntityPicker kind="user" name="user_id" label="Recipient" required />}
    <input name="request_id" type="hidden" value={requestId} />
    <label className="grid gap-1 text-sm font-medium">Title<input name="title" value={title} onChange={e => { setTitle(e.target.value); setPreview(false); }} maxLength={120} required className="rounded-lg border border-zinc-300 px-3 py-2" /></label>
    <label className="grid gap-1 text-sm font-medium">Message<textarea name="body" value={body} onChange={e => { setBody(e.target.value); setPreview(false); }} maxLength={2000} rows={4} required className="rounded-lg border border-zinc-300 px-3 py-2" /></label>
    <label className="grid gap-1 text-sm font-medium">Internal send reason<textarea name="reason" required minLength={3} maxLength={1000} rows={2} className="rounded-lg border border-zinc-300 px-3 py-2" /></label>
    {preview && <div aria-label="Notification preview" className="rounded-lg border border-orange-200 bg-orange-50 p-4"><p className="mb-2 text-xs text-orange-700">Recipient preview</p><p className="font-semibold">{title}</p><p className="mt-1 whitespace-pre-wrap text-sm">{body}</p></div>}
    <div className="flex gap-2"><button type="button" onClick={() => setPreview(true)} className="rounded-lg border px-4 py-2 text-sm font-semibold">Preview</button><button type="submit" disabled={!preview || !title.trim() || !body.trim()} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white">Send notification</button></div>
  </AdminActionForm>;
}
