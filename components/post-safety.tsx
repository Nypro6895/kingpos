"use client";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadHiddenPostIdentitiesAction, postModerationAction } from "@/app/post-moderation/actions";
import type { PostCommentTarget } from "@/types/post-comments";

export const REPORT_REASONS = [
  ["minor_safety", "Problem involving someone under 18"],
  ["harassment", "Bullying, harassment or abuse"],
  ["self_harm", "Suicide or self-harm"],
  ["violence", "Violent, hateful or disturbing content"],
  ["restricted_items", "Selling or promoting restricted items"],
  ["sexual", "Adult content"],
  ["scam", "Scam, fraud or false information"],
  ["intellectual_property", "Intellectual property"],
  ["unwanted", "I don’t want to see this"],
] as const;

function storageKey(viewerId?: string | null) { return `reylumi-hidden-posts:${viewerId ?? "guest"}`; }
const hiddenRequests = new Map<string, Promise<string[]>>();
export function notifyUserBlocksChanged() {
  hiddenRequests.clear();
  window.dispatchEvent(new Event("reylumi:user-blocks-changed"));
  try { localStorage.setItem("reylumi:block-change", String(Date.now())); } catch { /* Optional cross-tab refresh. */ }
}
export function postIdentity(target: PostCommentTarget) { return `${target.sourceType}:${target.sourceId}`; }
export function useHiddenPosts(viewerId?: string | null) {
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const key = storageKey(viewerId);
    const local = () => { try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []; } catch { return []; } };
    let remote: string[] = [];
    let requestVersion = 0;
    const read = () => setHidden([...new Set([...local(), ...remote])]);
    const sync = () => {
      const version=++requestVersion;
      if (!hiddenRequests.has(key)) hiddenRequests.set(key, loadHiddenPostIdentitiesAction());
      void hiddenRequests.get(key)?.then(value => {
        if (!active || version!==requestVersion) return;
        remote=value; read();
      }).catch(() => { hiddenRequests.delete(key); });
    };
    const changed = () => { hiddenRequests.delete(key); read(); sync(); };
    read(); sync();
    window.addEventListener("reylumi:post-hidden", changed); window.addEventListener("storage", changed);
    window.addEventListener("reylumi:user-blocks-changed", changed); window.addEventListener("focus", changed);
    return () => { active=false; window.removeEventListener("reylumi:post-hidden", changed); window.removeEventListener("storage", changed); window.removeEventListener("reylumi:user-blocks-changed", changed); window.removeEventListener("focus", changed); };
  }, [viewerId]);
  return hidden;
}

export function PostSafetyDialog({ target, mode, viewerId, onClose, onHidden, onChanged }: {
  target: PostCommentTarget; mode: "report" | "edit" | "archive" | "delete" | "promote" | "block";
  viewerId?: string | null; onClose: () => void; onHidden?: () => void; onChanged?: () => void;
}) {
  const __vt = useWorkspaceTranslation();

  const [reason, setReason] = useState("");
  const [body, setBody] = useState(target.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [supportHref,setSupportHref]=useState<string|null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const closeDialog = useCallback(() => {
    if (submitted) {
      hiddenRequests.delete(storageKey(viewerId));
      window.dispatchEvent(new CustomEvent("reylumi:post-hidden", {detail: {key: storageKey(viewerId), identity: postIdentity(target)}}));
      onHidden?.();
    }
    onClose();
  }, [submitted, viewerId, target, onHidden, onClose]);
  useEffect(() => {
    if (!submitted) return;
    const timer = window.setTimeout(closeDialog, 2000);
    return () => window.clearTimeout(timer);
  }, [submitted, closeDialog]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); if (!busy) closeDialog(); }
      if (event.key === "Tab") {
        const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,a[href]') ?? []);
        const first = nodes[0], last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown, true); previous?.focus(); };
  }, [busy, closeDialog]);
  async function submit() {
    setBusy(true); setError("");
    try {
      const result = await postModerationAction(target, mode, { reason, caption: body });
      if (result.error) { setError(result.error); return; }
      if (mode === "block") { notifyUserBlocksChanged(); onHidden?.(); onChanged?.(); onClose(); return; }
      if (mode === "report" || mode === "archive" || mode === "delete") {
        const key = storageKey(viewerId);
        try {
          const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as string[];
          localStorage.setItem(key, JSON.stringify([...new Set([...stored, postIdentity(target)])]));
        } catch { /* Server hiding still persists if browser storage is unavailable. */ }
        hiddenRequests.delete(key);
        if (mode !== "report") { window.dispatchEvent(new CustomEvent("reylumi:post-hidden", {detail: {key: storageKey(viewerId), identity: postIdentity(target)}})); onHidden?.(); }
      }
      if (mode === "report") { setSupportHref(result.data?.supportHref??null);setSubmitted(true); return; }
      onChanged?.(); onClose();
    } catch { setError("Could not complete the request. Please try again."); }
    finally { setBusy(false); }
  }
  const title = { block: "Block user", report: "Report", edit: "Edit post", archive: "Archive post", delete: "Delete post", promote: "Let more people see it" }[mode];
  return createPortal(<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-3" onClick={event => { if (event.target === event.currentTarget && !busy) closeDialog(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={__vt(title)} className="max-h-[90dvh] w-full max-w-lg overflow-auto rounded-2xl bg-white shadow-xl">
      <div className="flex items-center justify-between border-b p-4"><h2 className="text-lg font-semibold"><WorkspaceText text={title} /></h2><button aria-label={__vt("Close")} disabled={busy} onClick={closeDialog} className="grid size-10 place-items-center rounded-full bg-zinc-100 text-2xl">×</button></div>
      <div className="grid gap-3 p-4">
        {mode === "report" ? submitted ? <div role="status" className="grid gap-3 py-4 text-center"><p className="font-semibold"><WorkspaceText text="Thank you. Your report has been received." /></p>{viewerId?<><p className="text-sm"><WorkspaceText text="We will notify you when the review is complete or more information is needed." /></p><Link className="text-sm underline" href={supportHref??"/support"}><WorkspaceText text="View report & conversation" /></Link></>:<><p className="text-sm"><WorkspaceText text="This report was submitted without an account, so we cannot send you inbox updates. Contact support if you need a follow-up." /></p><Link className="text-sm underline" href="/contact-support"><WorkspaceText text="Contact support" /></Link></>}</div> : <><p className="font-semibold"><WorkspaceText text={reason ? "Are you sure?" : "Why are you reporting this post?"} /></p>{reason ? <><p>{REPORT_REASONS.find(item => item[0] === reason)?.[1]}</p><button disabled={busy} className="text-left text-sm underline" onClick={() => setReason("")}><WorkspaceText text="Choose another reason" /></button></> : <><p className="text-sm text-zinc-500"><WorkspaceText text="If someone is in immediate danger, contact local emergency services." /></p>{REPORT_REASONS.map(([value, label]) => <button key={value} className="flex min-h-12 items-center justify-between rounded-lg p-3 text-left hover:bg-zinc-100" onClick={() => setReason(value)}><WorkspaceText text={label} /><span aria-hidden="true">›</span></button>)}</>}</> : null}
        {mode === "block" ? <p><WorkspaceText text="Block this user? You will not see each other’s social posts or comments, or be able to follow or reply to each other while signed in. Existing follows will be removed. You can unblock them in Settings → Blocked users. Salon bookings are not affected." /></p> : null}
        {mode === "edit" ? <textarea aria-label={__vt("Post caption")} className="min-h-32 rounded-xl border p-3" maxLength={2200} value={body} onChange={event => setBody(event.target.value)} /> : null}
        {mode === "archive" ? <p><WorkspaceText text="Hide this post from public view and keep it in your posts." /></p> : null}
        {mode === "delete" ? <p><WorkspaceText text="Delete this post? This cannot be undone." /></p> : null}
        {mode === "promote" ? <p><WorkspaceText text="Promotion is coming soon. Campaigns are not available yet." /></p> : null}
        {error ? <p role="alert" className="text-sm text-red-600"><WorkspaceText text={error} /> {error.includes("/security-check") ? <Link href="/security-check" className="underline"><WorkspaceText text="Open security check" /></Link> : null}</p> : null}
        {!submitted && mode !== "promote" && (mode !== "report" || reason) ? <button disabled={busy} onClick={() => void submit()} className="min-h-11 rounded-xl bg-zinc-950 px-4 py-2 font-semibold text-white disabled:opacity-50"><WorkspaceText text={busy ? "Please wait…" : mode === "report" ? "Send" : mode === "edit" ? "Save changes" : title} /></button> : null}
      </div>
    </div>
  </div>, document.body);
}
