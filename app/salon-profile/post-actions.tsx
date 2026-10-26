"use client";

import { ReylumiIcon } from "@/components/reylumi-icons";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { SalonReportDialog } from "@/components/salon-report-dialog";
import type { SalonReportTarget } from "@/lib/salon-report";
import { PostSafetyDialog } from "@/components/post-safety";
import { announcePostChange } from "@/components/post-change-state";
import { postModerationAction } from "@/app/post-moderation/actions";
import type { PostCommentTarget } from "@/types/post-comments";
import type { PostChange } from "@/types/post-actions";

type ExtraAction = { label: string; action: () => void | Promise<unknown>; icon?: ReactNode };
type Permissions = { key: string; canBlock: boolean; canManage: boolean; canFeature: boolean; canPromote: boolean; caption?: string | null; isPinned?: boolean };

export function PostActions({ plain = false, extraActions = [], onOpen, onShare, isFeatured = false, disabled = false, target, salon, viewerId, onHidden, onChanged }: {
  plain?: boolean; extraActions?: ExtraAction[]; onOpen?: () => void; onShare?: () => void;
  isFeatured?: boolean; disabled?: boolean; target?: PostCommentTarget; salon?: SalonReportTarget;
  viewerId?: string | null; onHidden?: () => void; onChanged?: (change?: PostChange) => void;
}) {
  const t = useWorkspaceTranslation();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<"report" | "edit" | "archive" | "delete" | "block" | null>(null);
  const [salonReportOpen, setSalonReportOpen] = useState(false);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [message, setMessage] = useState("");
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const acting = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const permissionKey = [viewerId ?? "guest", target?.sourceType ?? "", target?.sourceId ?? ""].join(":");
  const permitted = open && permissions?.key === permissionKey ? permissions : null;

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && !menuRef.current?.contains(event.target)) ref.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); ref.current?.removeAttribute("open"); summaryRef.current?.focus(); }
    };
    const navigation = () => ref.current?.removeAttribute("open");
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("focusin", close, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("reylumi:overlay-navigation", navigation);
    return () => {
      document.removeEventListener("pointerdown", close, true); document.removeEventListener("focusin", close, true);
      document.removeEventListener("keydown", escape, true); document.removeEventListener("reylumi:overlay-navigation", navigation);
    };
  }, [open]);
  useEffect(() => {
    if (!open || !target) return;
    let active = true;
    void postModerationAction(target, "permissions").then(result => {
      if (active) setPermissions({ key: permissionKey, canBlock: Boolean(result.data?.canBlock), canManage: Boolean(result.data?.canManage), canFeature: Boolean(result.data?.canFeature), canPromote: Boolean(result.data?.canPromote), ...(result.data && "caption" in result.data ? { caption: result.data.caption as string | null } : {}), ...(typeof result.data?.isPinned === "boolean" ? { isPinned: result.data.isPinned } : {}) });
    }).catch(() => { if (active) setPermissions(null); });
    return () => { active = false; };
  }, [open, permissionKey, target]);

  function changed(change?: PostChange) {
    if (onChanged) onChanged(change);
    else startTransition(() => router.refresh());
  }
  async function feature() {
    if (!target) return;
    const result = await postModerationAction(target, "feature");
    if (result.error) { setMessage(result.error); return; }
    const change: PostChange = { target, action: "feature", ...(typeof result.data?.isPinned === "boolean" ? { isPinned: result.data.isPinned } : {}), ...(result.data?.coverImageUrl ? { coverImageUrl: result.data.coverImageUrl, coverMediaPath: result.data.coverMediaPath } : {}) };
    announcePostChange(change, viewerId); changed(change);
  }
  const owner = Boolean(permitted?.canManage);
  const actions: Array<{ label: string; action?: () => void | Promise<unknown>; icon?: ReactNode }> = [
    ...extraActions,
    { label: "Report salon", action: salon ? () => setSalonReportOpen(true) : undefined },
    { label: "Report post", action: target ? () => setMode("report") : undefined },
    { label: "Block user", action: target && viewerId && permitted?.canBlock ? () => setMode("block") : undefined },
    { label: "Edit post", action: target && owner ? () => setMode("edit") : undefined },
    { label: "View post", action: onOpen },
    { label: (permitted?.isPinned ?? isFeatured) ? "Remove featured selection" : "Use as featured photo", action: target && permitted?.canFeature ? feature : undefined },
    { label: "Let more people see it", action: target && permitted?.canPromote ? () => { window.dispatchEvent(new CustomEvent("reylumi:promote-post", { detail: target })); } : undefined },
    { label: "Share post", action: onShare },
    { label: "Archive post", action: target && owner ? () => setMode("archive") : undefined },
    { label: "Delete post", action: target && owner ? () => setMode("delete") : undefined },
  ].filter(item => item.action);
  // Permission results can add owner actions after the menu first opens.
  const menuTop = open ? Math.max(8, Math.min(position.top, window.innerHeight - actions.length * 44 - 28)) : position.top;
  return <>
    <details ref={ref} onToggle={event => {
      const expanded = event.currentTarget.open;
      if (expanded) {
        const box = event.currentTarget.querySelector("summary")!.getBoundingClientRect();
        setPermissions(null); setMessage("");
        setPosition({ left: Math.max(8, Math.min(box.right - 208, window.innerWidth - 216)), top: Math.max(8, Math.min(box.bottom + 4, window.innerHeight - Math.max(4, actions.length) * 44 - 28)) });
      }
      setOpen(expanded);
    }} className="relative" style={{ position: "relative", zIndex: open ? 45 : 2 }}>
      <summary ref={summaryRef} aria-label={t(salon && !target ? "Salon actions" : "Post actions")} aria-haspopup="menu" aria-expanded={open} aria-disabled={disabled || busy} onClick={event => { if (disabled || busy) event.preventDefault(); }}
        className={`${plain ? "!bg-transparent !shadow-none " : ""}grid size-9 cursor-pointer list-none place-items-center rounded-full bg-white/95 text-zinc-700 shadow-sm hover:bg-white [&::-webkit-details-marker]:hidden`}
        style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 18, background: plain ? "transparent" : "rgba(255,255,255,.95)", cursor: "pointer", listStyle: "none" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
      </summary>
      {open ? createPortal(<div ref={menuRef} role="menu" className="grid w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg" style={{ position: "fixed", left: position.left, top: menuTop, zIndex: 100, width: 208, maxHeight: `min(80dvh, calc(100dvh - ${menuTop + 8}px))`, overflowY: "auto", background: "white", padding: 6, borderRadius: 12, boxShadow: "0 8px 24px #0002", border: "1px solid #e7e5e4" }}>
        {actions.map(item => <button key={item.label} role="menuitem" type="button" disabled={disabled || busy} className="min-h-11 rounded-lg px-3 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50" style={{ display: "block", width: "100%", minHeight: 44, textAlign: "left", padding: "8px 12px", fontSize: 13, color: item.label.startsWith("Report") ? "#b42318" : undefined }} onClick={async () => {
          if (acting.current) return;
          acting.current = true; ref.current?.removeAttribute("open"); setBusy(true);
          try { await item.action?.(); } catch { setMessage("Could not complete the request. Please try again."); }
          finally { acting.current = false; setBusy(false); }
        }}><span className="flex items-center gap-3">{item.icon ?? (item.label.startsWith("Report") ? <ReylumiIcon name="flag"/> : null)}<WorkspaceText text={item.label}/></span></button>)}
      </div>, document.body) : null}
    </details>
    {message ? <span role="alert" className="text-xs text-red-600"><WorkspaceText text={message}/></span> : null}
    {target && mode ? <PostSafetyDialog key={permissionKey + ":" + mode} target={target} mode={mode} initialCaption={permissions?.key === permissionKey ? permissions.caption : undefined} viewerId={viewerId} onClose={() => setMode(null)} onHidden={onHidden} onChanged={changed}/> : null}
    {salon && salonReportOpen ? <SalonReportDialog salon={salon} returnFocusRef={summaryRef} onClose={() => setSalonReportOpen(false)}/> : null}
  </>;
}
