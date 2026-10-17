"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RoleMoreContent } from "@/components/role-more-content";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { OwnerPosIcon, type OwnerPosIconName } from "./owner-pos-icon";
import { PortableSyncIndicator } from "./portable/portable-sync-indicator";
import "./owner-pos.css";

const shortcuts: { id: string; href: string; label: string; icon: OwnerPosIconName }[] = [
  { id: "pos", href: "/pos", label: "POS", icon: "pos" },
  { id: "ticket", href: "/pos/ticket", label: "Ticket", icon: "ticket" },
  { id: "book", href: "/pos/book", label: "Book", icon: "booking" },
  { id: "checkIn", href: "/pos/check-in", label: "Check In", icon: "checkin" },
  { id: "report", href: "/pos/report", label: "Report", icon: "report" },
  { id: "settings", href: "/pos/settings", label: "Settings", icon: "settings" },
];

function OwnerMoreMenu() {
  const translate = useWorkspaceTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const open = placement !== null;

  function placeMenu() {
    const button = trigger.current;
    if (!button || button.getClientRects().length === 0) { setPlacement(null); return; }
    const rect = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const offsetLeft = viewport?.offsetLeft ?? 0;
    const offsetTop = viewport?.offsetTop ?? 0;
    const panelWidth = Math.min(384, width - 24);
    const top = Math.max(offsetTop + 8, Math.min(rect.bottom + 8, offsetTop + height - 144));
    setPlacement({ top, left: Math.max(offsetLeft + 12, Math.min(rect.left, offsetLeft + width - panelWidth - 12)), width: panelWidth, maxHeight: Math.min(560, offsetTop + height - top - 12) });
  }

  useEffect(() => {
    if (!open) return;
    const focus = requestAnimationFrame(() => panel.current?.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true }));
    function dismiss(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) setPlacement(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setPlacement(null);
      trigger.current?.focus({ preventScroll: true });
    }
    function onFocus(event: FocusEvent) {
      const target = event.target;
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) setPlacement(null);
    }
    function onScroll(event: Event) {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      placeMenu();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", placeMenu);
    return () => {
      cancelAnimationFrame(focus);
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", placeMenu);
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className="owner-nav-item owner-more-button" aria-label={translate("More")} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => open ? setPlacement(null) : placeMenu()}>
      <OwnerPosIcon name="more" /><span><WorkspaceText text="More" /></span>
    </button>
    {placement ? createPortal(
      <div id={id} ref={panel} className="owner-more-popover" style={placement} role="region" aria-label={translate("More")} data-owner-more-popover>
        <RoleMoreContent roleKind="owner" activeItemIds={["owner-pos"]} workspace="pos" onNavigate={() => setPlacement(null)} />
      </div>, document.body,
    ) : null}
  </>;
}

type OwnerTab = "pos" | "ticket" | "book" | "checkIn" | "report" | "settings" | "more";

/** The installed host keeps this outside the retained, CSS-hidden checkout. */
export function OwnerPosNavigation({ active, syncScope }: { active: OwnerTab; syncScope?: string }) {
  return <div className="owner-navigation" data-owner-navigation>
    <OwnerPosTabs active={active} />
    {syncScope ? <div className="owner-sync-status"><PortableSyncIndicator scope={syncScope} /></div> : null}
  </div>;
}

export function OwnerPosTabs({ active }: { active: OwnerTab }) {
  const translate = useWorkspaceTranslation();
  const pathname = usePathname();
  return <nav className="owner-top-nav" aria-label={translate("Owner POS")}>
    <OwnerMoreMenu key={pathname ?? active} />
    {shortcuts.map(item => <Link className="owner-nav-item" data-owner-tab={item.id} href={item.href} key={item.href} aria-label={translate(item.label)} aria-current={item.id === active ? "page" : undefined}><OwnerPosIcon name={item.icon} /><span><WorkspaceText text={item.label} /></span></Link>)}
  </nav>;
}
