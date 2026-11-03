"use client";

import { useEffect, useRef } from "react";
import { isReylumiIOSClient } from "@/lib/ios-client";
import "./iphone-glass-nav.css";

/** Presentation only: the route and native details controls remain authoritative. */
export function useIPhoneGlassNav(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    if (!nav || !enabled || !/iPhone|iPod/.test(navigator.userAgent) || !isReylumiIOSClient(navigator.userAgent)) return;

    nav.dataset.iphoneGlass = "true";
    let frame = 0;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>(
        ':scope > details[open] > summary, :scope > [aria-current="page"], :scope > details > summary[aria-current="page"]',
      );
      // Open menus take visual precedence over the route underneath them.
      const target = nav.querySelector<HTMLElement>(":scope > details[open] > summary") ?? active;
      nav.dataset.glassSelected = target ? "true" : "false";
      if (!target) return;
      const bounds = nav.getBoundingClientRect();
      const item = target.getBoundingClientRect();
      nav.style.setProperty("--glass-x", `${item.left - bounds.left}px`);
      nav.style.setProperty("--glass-y", `${item.top - bounds.top}px`);
      nav.style.setProperty("--glass-width", `${item.width}px`);
      nav.style.setProperty("--glass-height", `${item.height}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        measure();
        nav.dataset.glassReady = "true";
      });
    };
    measure();
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current", "open"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(nav);
    const press = (event: PointerEvent) => {
      nav.style.setProperty("--glass-light-x", `${event.clientX - nav.getBoundingClientRect().left}px`);
    };
    nav.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      nav.removeEventListener("pointerdown", press);
      window.removeEventListener("resize", schedule);
      delete nav.dataset.iphoneGlass;
      delete nav.dataset.glassReady;
      delete nav.dataset.glassSelected;
    };
  }, [enabled]);

  return ref;
}
