"use client";
import { useLayoutEffect, type RefObject } from "react";

/** Keep this modal's scroll area above the iOS keyboard without moving the page. */
export function useDialogViewport(ref: RefObject<HTMLDialogElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!enabled || !dialog) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const fit = () => {
      dialog.style.top = `${viewport?.offsetTop ?? 0}px`;
      dialog.style.bottom = "auto";
      dialog.style.height = `${viewport?.height ?? window.innerHeight}px`;
      dialog.style.maxHeight = dialog.style.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const input = document.activeElement;
        if (!(input instanceof HTMLElement) || !dialog.contains(input) || !input.matches("textarea,input,select")) return;
        const field = input.getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
        const headerHeight = dialog.querySelector("header")?.getBoundingClientRect().height ?? 0;
        const top = bounds.top + headerHeight + 12, bottom = bounds.bottom - 16;
        if (field.top < top || field.bottom > bottom) dialog.scrollTop += field.top - top - Math.max(0, (bottom - top - field.height) / 2);
      });
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    dialog.addEventListener("focusin", fit);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      dialog.removeEventListener("focusin", fit);
    };
  }, [enabled, ref]);
}
