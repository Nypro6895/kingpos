"use client";
import { WorkspaceText } from "@/components/workspace-language";
import Link from "next/link";

import { useRef, useState } from "react";

export function ContactSupportForm() {
  const requestId = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [conversationUrl,setConversationUrl]=useState("");
  if (reference) return <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6"><h2 className="text-xl font-semibold text-emerald-900"><WorkspaceText text="Message received" /></h2><p className="mt-3 text-sm text-emerald-800"><WorkspaceText text="Our support team will review your request. Open your conversation to see replies and add details." /></p>{conversationUrl?<Link href={conversationUrl} className="mt-4 inline-block font-semibold text-emerald-900 underline"><WorkspaceText text="Open your support conversation" /></Link>:null}<p className="mt-3 text-sm text-emerald-800"><WorkspaceText text="Reference:" /> <strong>{reference}</strong></p><button type="button" className="mt-5 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900" onClick={() => { requestId.current = null; setReference(""); }}><WorkspaceText text="Send another message" /></button></div>;
  return <form className="grid gap-5" onSubmit={async event => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    requestId.current ??= crypto.randomUUID();
    setPending(true); setError("");
    try {
      const response = await fetch("/api/contact-support", { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), email: form.get("email"), message: form.get("message"), website: form.get("website"), requestId: requestId.current }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to submit your message.");
      setReference(result.reference);setConversationUrl(result.conversationUrl||"");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to connect. Your message has not been confirmed; please try again."); }
    finally { setPending(false); }
  }}>
    <fieldset disabled={pending} className="grid gap-5">
      <label className="grid gap-2 text-sm font-medium"><WorkspaceText text="Your name" /> <span className="sr-only"><WorkspaceText text="(required)" /></span><input name="name" required maxLength={120} autoComplete="name" className="rounded-lg border border-zinc-300 bg-white px-3 py-3 font-normal" /></label>
      <label className="grid gap-2 text-sm font-medium"><WorkspaceText text="Email address" /> <span className="sr-only"><WorkspaceText text="(required)" /></span><input name="email" type="email" required maxLength={254} autoComplete="email" className="rounded-lg border border-zinc-300 bg-white px-3 py-3 font-normal" /><span className="text-xs font-normal text-zinc-500"><WorkspaceText text="We may use this address to contact you about your request." /></span></label>
      <label className="grid gap-2 text-sm font-medium"><WorkspaceText text="How can we help?" /> <span className="sr-only"><WorkspaceText text="(required)" /></span><textarea name="message" required maxLength={5000} rows={7} className="resize-y rounded-lg border border-zinc-300 bg-white px-3 py-3 font-normal" /><span className="text-xs font-normal text-zinc-500"><WorkspaceText text="Please do not include passwords or payment card details. Maximum 5,000 characters." /></span></label>
      <div style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }} aria-hidden="true"><label><WorkspaceText text="Website" /><input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <button className="rounded-lg bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-60" type="submit"><WorkspaceText text={pending ? "Sending…" : "Send to support"} /></button>
    </fieldset>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><WorkspaceText text={error} /></p>}
    <p className="text-xs leading-relaxed text-zinc-500"><WorkspaceText text="All fields are required. Your contact details and message are shared with the Reylumi support team to handle your request." /></p>
  </form>;
}
