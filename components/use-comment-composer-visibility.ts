"use client";

import { useEffect, type RefObject } from "react";
import { revealCommentComposer } from "@/lib/comment-composer-visibility";

export function useCommentComposerVisibility(ref: RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      // Overlay viewport fitting and textarea autosizing finish before measuring.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (document.activeElement === textarea) revealCommentComposer(textarea);
        });
      });
    };
    const viewport = window.visualViewport;
    textarea.addEventListener("focus", schedule);
    textarea.addEventListener("input", schedule);
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(textarea);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      textarea.removeEventListener("focus", schedule);
      textarea.removeEventListener("input", schedule);
      window.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
    };
  }, [ref, value]);
}
