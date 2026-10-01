"use client";
import { useEffect } from "react";
import { desktopDevice } from "@/lib/portable-device-storage";

// A working draft belongs to its current tab. Submitted and parked tickets
// already have durable records and must not trigger an exit warning.
export function usePortableCloseGuard(unfinished: boolean) {
  useEffect(() => {
    if (!unfinished) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (desktopDevice()) {
        const flush = new CustomEvent("kingpos:desktop-flush", { detail: { saved: false } });
        window.dispatchEvent(flush);
        if (flush.detail.saved) return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [unfinished]);
}
