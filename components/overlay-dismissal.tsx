"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { installPopoverDismissal, closePopovers } from "@/lib/dismissible-popovers";
export const OVERLAY_NAVIGATION_EVENT = "reylumi:overlay-navigation";
export function OverlayDismissal() {
  const pathname = usePathname();
  const previous = useRef(pathname);
  useEffect(() => installPopoverDismissal(document), []);
  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      closePopovers(document);
      document.dispatchEvent(new Event(OVERLAY_NAVIGATION_EVENT));
    }
  }, [pathname]);
  return null;
}
export function useCloseOnNavigation(onClose: () => void, enabled = true) {
  const latest = useRef(onClose);
  useEffect(() => { latest.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!enabled) return;
    function dismiss() { latest.current(); }
    document.addEventListener(OVERLAY_NAVIGATION_EVENT, dismiss);
    return () => document.removeEventListener(OVERLAY_NAVIGATION_EVENT, dismiss);
  }, [enabled]);
}
