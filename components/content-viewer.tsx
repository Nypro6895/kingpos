"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTransientOverlay } from "@/components/overlay-dismissal";

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
  useTransientOverlay(onClose, open, true);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!mounted || !open || !overlay) return;
    const navigation = Array.from(document.querySelectorAll<HTMLElement>(".workspace-mobile-nav"));
    const viewport = window.visualViewport;
    let focusFrame = 0;
    const revealFocusedField = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (!(field instanceof HTMLElement) || !overlay.contains(field) || !field.matches('input, textarea, select, [contenteditable="true"]')) return;
        const bounds = overlay.getBoundingClientRect();
        // Scroll only this viewer's panel. Scrolling the document moves the
        // underlying feed and can leave the composer outside the resized panel.
        for (let panel = field.parentElement; panel && panel !== overlay; panel = panel.parentElement) {
          if (!/(auto|scroll)/.test(getComputedStyle(panel).overflowY) || panel.scrollHeight <= panel.clientHeight) continue;
          const box = panel.getBoundingClientRect(), target = field.getBoundingClientRect();
          const top = Math.max(bounds.top, box.top) + 12;
          const bottom = Math.min(bounds.bottom, box.bottom) - 12;
          const delta = target.bottom > bottom ? target.bottom - bottom : target.top < top ? target.top - top : 0;
          if (delta) panel.scrollTop += delta;
        }
      });
    };
    const fit = () => {
      const nav = navigation.find(element => element.getClientRects().length && element.getBoundingClientRect().height > 0);
      const top = viewport?.offsetTop ?? 0;
      const viewportBottom = top + (viewport?.height ?? innerHeight);
      // iOS pans the layout viewport while focusing an input. innerHeight is
      // not the bottom coordinate once offsetTop is nonzero.
      const bottom = Math.min(viewportBottom, nav?.getBoundingClientRect().top ?? viewportBottom);
      overlay.style.setProperty("--content-viewer-top", `${top}px`);
      overlay.style.setProperty("--content-viewer-height", `${Math.max(0, bottom - top)}px`);
      // Navigation is part of the usable page on mobile, so this is non-modal.
      overlay.setAttribute("aria-modal", nav ? "false" : "true");
      revealFocusedField();
    };
    const resize = new ResizeObserver(fit);
    navigation.forEach(element => resize.observe(element));
    const dismissFromNavigation = () => close();
    navigation.forEach(element => element.addEventListener("click", dismissFromNavigation));
    fit();
    overlay.addEventListener("focusin", revealFocusedField);
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(focusFrame);
      overlay.removeEventListener("focusin", revealFocusedField);
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
