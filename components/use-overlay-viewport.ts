"use client";

import { useLayoutEffect, type RefObject } from "react";

type ViewportMode = "frame" | "panel";
const ownedProperties = ["top", "bottom", "height", "max-height", "min-height", "overflow-y", "margin-top", "margin-bottom"] as const;

/** Opt one open overlay into keyboard sizing; leave its ordinary layout alone. */
export function useOverlayViewport(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  mode: ViewportMode = "frame",
  gap = 16,
) {
  useLayoutEffect(() => {
    const overlay = ref.current;
    if (!active || !overlay) return;
    const viewport = window.visualViewport;
    const original = ownedProperties.map(property => [property, overlay.style.getPropertyValue(property), overlay.style.getPropertyPriority(property)] as const);
    const originalAttribute = overlay.getAttribute("data-overlay-keyboard");
    let frame = 0, adjusted = false, disposed = false;
    const write = (property: string, value: string) => {
      if (overlay.style.getPropertyValue(property) !== value) overlay.style.setProperty(property, value);
    };
    const restore = () => {
      if (!adjusted) return;
      for (const [property, value, priority] of original) {
        if (value) overlay.style.setProperty(property, value, priority);
        else overlay.style.removeProperty(property);
      }
      if (originalAttribute === null) overlay.removeAttribute("data-overlay-keyboard");
      else overlay.setAttribute("data-overlay-keyboard", originalAttribute);
      adjusted = false;
    };
    const revealField = (top: number, bottom: number) => {
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !overlay.contains(field) || !field.matches('input,textarea,select,[contenteditable="true"]')) return;
      // Never scroll the document or the page retained behind this overlay.
      for (let panel: HTMLElement | null = field.parentElement; panel && overlay.contains(panel); panel = panel.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(panel).overflowY) && panel.scrollHeight > panel.clientHeight) {
          const edges = new Set([...Array.from(panel.children), ...Array.from(panel.querySelectorAll('[data-overlay-sticky-edge]'))]);
          // The first scroll can make a sticky footer enter the scrollport.
          // Re-measure once so that footer cannot cover the newly revealed field.
          for (let pass = 0; pass < 2; pass++) {
            const bounds = panel.getBoundingClientRect(), target = field.getBoundingClientRect();
            let visibleTop = Math.max(top, bounds.top) + 12;
            let visibleBottom = Math.min(bottom, bounds.bottom) - 12;
            for (const edge of edges) {
              if (!(edge instanceof HTMLElement) || edge.contains(field)) continue;
              if (edge.parentElement !== panel) {
                let owner: HTMLElement | null = edge.parentElement;
                while (owner && owner !== panel && !/(auto|scroll|hidden)/.test(getComputedStyle(owner).overflowY)) owner = owner.parentElement;
                if (owner !== panel) continue;
              }
              const style = getComputedStyle(edge), box = edge.getBoundingClientRect();
              if (style.position !== "sticky" && style.position !== "fixed") continue;
              const overlaps = box.left < target.right && box.right > target.left && box.top < target.bottom && box.bottom > target.top;
              if (!overlaps) continue;
              if (style.top !== "auto") visibleTop = Math.max(visibleTop, box.bottom + 8);
              if (style.bottom !== "auto") visibleBottom = Math.min(visibleBottom, box.top - 8);
            }
            const delta = target.bottom > visibleBottom ? target.bottom - visibleBottom : target.top < visibleTop ? target.top - visibleTop : 0;
            if (!delta || visibleBottom <= visibleTop) break;
            const before = panel.scrollTop;
            panel.scrollTop += delta;
            if (panel.scrollTop === before) break;
          }
        }
        if (panel === overlay) break;
      }
    };
    const fit = () => {
      if (disposed) return;
      const height = Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
      // Pinch zoom belongs to the browser. Resized layout viewports already
      // update dvh/fixed bounds and must not receive another keyboard inset.
      if (!viewport || Math.abs(viewport.scale - 1) > .01 || window.innerHeight - height <= 24) {
        restore();
        return;
      }
      const top = Math.max(0, viewport.offsetTop), bottom = top + height;
      adjusted = true;
      overlay.setAttribute("data-overlay-keyboard", "true");
      write("min-height", "0px");
      if (mode === "frame") {
        write("top", `${top}px`);
        write("bottom", "auto");
        write("height", `${height}px`);
        write("max-height", `${height}px`);
      } else {
        write("top", `${top + gap}px`);
        write("bottom", `${Math.max(0, window.innerHeight - bottom) + gap}px`);
        write("height", "fit-content");
        write("max-height", `${Math.max(0, height - gap * 2)}px`);
        write("overflow-y", "auto");
        write("margin-top", "auto");
        write("margin-bottom", "auto");
      }
      revealField(top, bottom);
    };
    const schedule = () => {
      if (disposed || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; fit(); });
    };
    fit();
    // A frame after layout also sees newly mounted/auto-focused form fields.
    schedule();
    viewport?.addEventListener("resize", schedule, { passive: true });
    viewport?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    overlay.addEventListener("focusin", schedule);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      overlay.removeEventListener("focusin", schedule);
      restore();
    };
  }, [ref, active, mode, gap]);
}
