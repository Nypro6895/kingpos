"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { OwnerPosIcon, type OwnerPosIconName } from "./owner-pos-icon";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import "./owner-windows-compact-menu.css";

const pages: { id: string; label: string; icon: OwnerPosIconName; href?: string }[] = [
  { id: "settings", label: "Settings", icon: "settings", href: "/pos/settings" },
  { id: "report", label: "Report", icon: "report", href: "/pos/report" },
  { id: "checkIn", label: "Check In", icon: "checkin", href: "/pos/check-in" },
  { id: "book", label: "Book", icon: "booking", href: "/pos/book" },
  { id: "ticket", label: "Ticket", icon: "ticket", href: "/pos/ticket" },
  { id: "pos", label: "POS", icon: "pos", href: "/pos" },
  { id: "more", label: "More", icon: "more" },
];

function isMorePopupEvent(target: EventTarget | null) {
  return target instanceof Element && target.closest("[data-owner-more-popover]") !== null;
}

export function OwnerWindowsCompactMenu({ active, more }: { active: string; more: ReactNode }) {
  const translate = useWorkspaceTranslation();
  const root = useRef<HTMLElement>(null);
  const gesture = useRef<{ id: number; y: number; wasOpen: boolean; dragging: boolean } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const clearHold = () => { if (hold.current) clearTimeout(hold.current); hold.current = null; };

  useEffect(() => {
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setOpen(false); setFocus(null); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); setFocus(null); root.current?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); clearHold(); };
  }, []);

  // Keep hit testing anchored to the unscaled row centers while tabs magnify.
  function indexAt(y: number) {
    const rows = root.current?.querySelectorAll<HTMLElement>("[data-notebook-row]");
    if (!rows?.length) return null;
    let closest = 0, distance = Infinity;
    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect();
      const next = Math.abs(y - (rect.top + rect.height / 2));
      if (next < distance) { distance = next; closest = index; }
    });
    const bounds = root.current!.getBoundingClientRect();
    return y < bounds.top - 24 || y > bounds.bottom + 24 ? null : closest;
  }
  function choose(index: number) {
    const page = pages[index];
    setOpen(false); setFocus(null); setDragging(false);
    // Use the same links as desktop so OwnerWorkspaceFrame can retain the
    // checkout draft, local panels and offline navigation authority.
    if (page.href) root.current?.querySelector<HTMLAnchorElement>(`a[data-owner-tab="${page.id}"]`)?.click();
    else root.current?.querySelector<HTMLButtonElement>(".owner-more-button")?.click();
  }
  function down(event: PointerEvent<HTMLElement>) {
    // React portal events still bubble through this nav although the popup is
    // outside its DOM. Its links must keep their ordinary click/navigation.
    if (isMorePopupEvent(event.target)) return;
    if (!event.isPrimary || event.button !== 0) return;
    // The existing More trigger retains its own accessible popover behavior.
    const index = indexAt(event.clientY);
    gesture.current = { id: event.pointerId, y: event.clientY, wasOpen: open, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    setOpen(true);
    hold.current = setTimeout(() => {
      if (!gesture.current) return;
      gesture.current.dragging = true; setDragging(true); setFocus(index);
    }, 180);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (Math.abs(event.clientY - current.y) > 6) { current.dragging = true; clearHold(); setDragging(true); }
    if (current.dragging) setFocus(indexAt(event.clientY));
  }
  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    clearHold(); gesture.current = null; setDragging(false); setFocus(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const bounds = root.current!.getBoundingClientRect();
    const index = indexAt(event.clientY);
    if (cancelled || event.clientX < bounds.left - 32 || event.clientX > bounds.right + 24 || index === null) { setOpen(false); return; }
    if (current.dragging || current.wasOpen) choose(index);
  }

  return <nav ref={root} className="owner-windows-compact" aria-label={translate("Owner POS")} tabIndex={-1}
    data-open={open} data-dragging={dragging} onPointerDown={down} onPointerMove={move}
    onClickCapture={event => { if (!isMorePopupEvent(event.target) && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={() => { if (gesture.current) { clearHold(); gesture.current = null; setDragging(false); setFocus(null); setOpen(false); } }}
    onContextMenu={event => event.preventDefault()}
    onFocusCapture={event => { if (!isMorePopupEvent(event.target) && event.target !== event.currentTarget) setOpen(true); }}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setFocus(null); } }}>
    {pages.map((page, index) => {
      const distance = focus === null ? 99 : Math.abs(index - focus);
      return <div key={page.id} data-notebook-row style={{ "--page-index": index, "--page-width": focus === null ? "104px" : distance === 0 ? "136px" : distance === 1 ? "76px" : "20px", zIndex: focus === index ? 20 : 10 - index } as CSSProperties}>
        <div className="owner-windows-compact-page" data-active={active === page.id} data-focused={focus === index}>
          {page.id === "more" ? more : <Link href={page.href!} draggable={false} data-owner-tab={page.id} aria-label={translate(page.label)} aria-current={active === page.id ? "page" : undefined}
            onClick={() => { setOpen(false); setFocus(null); }}>
            <OwnerPosIcon name={page.icon} /><span>{translate(page.label)}</span>
          </Link>}
        </div>
      </div>;
    })}
  </nav>;
}
