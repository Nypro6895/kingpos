"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Keep the existing form controls above an overlay keyboard in WKWebView. */
export function CustomerFormActions({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controls = element.current;
    if (!controls) return;
    const resetKeyboard = () => {
      controls.removeAttribute("data-keyboard-open");
      controls.style.removeProperty("--customer-keyboard-inset");
    };
    resetKeyboard();
    const viewport = window.visualViewport;
    if (!viewport) return resetKeyboard;
    let frame = 0;
    let active = true;
    const update = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active) return;
        let scrollport = controls.parentElement;
        while (scrollport && !/(auto|scroll|hidden)/.test(getComputedStyle(scrollport).overflowY)) scrollport = scrollport.parentElement;
        // WKWebView pans the visual viewport when moving between fields. Its
        // offset is already reflected in the sticky scrollport coordinates.
        const visibleBottom = viewport.height;
        const keyboardOpen = viewport.scale === 1 && window.innerHeight - viewport.height > 100;
        controls.dataset.keyboardOpen = String(keyboardOpen);
        const inset = keyboardOpen ? Math.max(0, (scrollport?.getBoundingClientRect().bottom ?? window.innerHeight) - visibleBottom) : 0;
        controls.style.setProperty("--customer-keyboard-inset", `${inset}px`);
        const focused = document.activeElement;
        if (keyboardOpen && focused instanceof HTMLElement && focused.matches("input,select,textarea") && controls.closest("form")?.contains(focused) && focused.getBoundingClientRect().bottom > controls.getBoundingClientRect().top - 12) focused.scrollIntoView({ block: "center", behavior: "auto" });
      });
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const form = element.current?.closest("form");
    form?.addEventListener("focusin", update);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      form?.removeEventListener("focusin", update);
      // Activity keeps hidden forms in the DOM. Release their global nav rule
      // even when the keyboard has not sent its closing resize event yet.
      resetKeyboard();
    };
  }, []);
  return <div className="customer-form-actions sm:col-span-2" ref={element}>{children}</div>;
}
