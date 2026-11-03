"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A writing task owns the top layer, including above the workspace navigation. */
export function BeautyComposerDialog({ children, busy, onClose }: {
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const viewport = window.visualViewport;
    const fit = () => {
      dialog.style.top = `${viewport?.offsetTop ?? 0}px`;
      dialog.style.height = `${viewport?.height ?? window.innerHeight}px`;
    };
    fit();
    dialog.showModal();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog ref={ref} aria-labelledby="beauty-composer-title" aria-describedby="beauty-composer-description"
      className="fixed left-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 outline-none bg-transparent p-0 text-text-primary backdrop:bg-zinc-950/45 backdrop:backdrop-blur-sm"
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
      <div className="flex h-full min-h-0 items-end justify-center pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-6"
        onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        {children}
      </div>
    </dialog>, document.body,
  );
}
