"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCloseOnNavigation } from "@/components/overlay-dismissal";

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;
const focusable = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]';

/** Browsing a post keeps the current workspace's mobile navigation available. */
export function ContentViewer({ children, onClose, open = true, className = "", ...label }: {
  children: ReactNode;
  onClose: () => void;
  open?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const mounted = useSyncExternalStore(subscribe, onClient, onServer);
  const overlayRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  useCloseOnNavigation(onClose, open);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!mounted || !open || !overlay) return;
    const navigation = Array.from(document.querySelectorAll<HTMLElement>(".workspace-mobile-nav"));
    const viewport = window.visualViewport;
    const fit = () => {
      const nav = navigation.find(element => element.getClientRects().length && element.getBoundingClientRect().height > 0);
      const top = viewport?.offsetTop ?? 0;
      const bottom = Math.min(top + (viewport?.height ?? innerHeight), nav?.getBoundingClientRect().top ?? innerHeight);
      overlay.style.setProperty("--content-viewer-top", `${top}px`);
      overlay.style.setProperty("--content-viewer-height", `${Math.max(0, bottom - top)}px`);
      // Navigation is part of the usable page on mobile, so this is non-modal.
      overlay.setAttribute("aria-modal", nav ? "false" : "true");
    };
    const resize = new ResizeObserver(fit);
    navigation.forEach(element => resize.observe(element));
    const dismissFromNavigation = () => close();
    navigation.forEach(element => element.addEventListener("click", dismissFromNavigation));
    fit();
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    return () => {
      resize.disconnect();
      navigation.forEach(element => element.removeEventListener("click", dismissFromNavigation));
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }, [mounted, open]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!mounted || !open || !overlay) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    overlay.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      // A report, login or booking dialog opened from the post owns its keys.
      if (Array.from(document.querySelectorAll('dialog[open], [data-lumi-trust-panel], [role="dialog"][aria-modal="true"]:not(.content-viewer)')).some(element => element.getClientRects().length)) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab" || overlay.getAttribute("aria-modal") !== "true") return;
      const targets = Array.from(overlay.querySelectorAll<HTMLElement>(focusable)).filter(element => element.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === overlay)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      if (opener?.isConnected && !document.activeElement?.closest(".workspace-mobile-nav")) opener.focus({ preventScroll: true });
    };
  }, [mounted, open]);

  if (!mounted) return null;
  return createPortal(
    <div {...label} ref={overlayRef} hidden={!open} role={open ? "dialog" : undefined} aria-modal={open ? "true" : undefined} tabIndex={-1}
      className={`content-viewer fixed inset-0 z-[100] grid bg-zinc-950/45 p-0 sm:p-6 ${className}`}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      {children}
    </div>, document.body,
  );
}
