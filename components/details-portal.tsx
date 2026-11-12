"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { registerPopoverPortal } from "@/lib/dismissible-popovers";

/** Preserve the details trigger while escaping navigation stacking contexts. */
export function DetailsPortal({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const details = hostRef.current?.closest("details");
    if (!details) return;
    const syncOpen = () => {
      // A breakpoint may hide this navigation while its details is still open.
      if (details.open && details.getClientRects().length === 0) details.open = false;
      setOpen(details.open);
      setPortalHost(details.ownerDocument.body);
    };
    syncOpen();
    details.addEventListener("toggle", syncOpen);
    window.addEventListener("resize", syncOpen);
    return () => {
      details.removeEventListener("toggle", syncOpen);
      window.removeEventListener("resize", syncOpen);
      // Activity can hide navigation without unmounting its body portal.
      details.open = false;
      setOpen(false);
      if (regionRef.current) {
        regionRef.current.hidden = true;
        regionRef.current.style.display = "none";
      }
    };
  }, []);

  return <>
    <span hidden ref={hostRef} />
    {portalHost ? createPortal(<div hidden={!open} style={{ display: open ? "contents" : "none" }} ref={region => {
      regionRef.current = region;
      unregisterRef.current?.();
      unregisterRef.current = null;
      const details = hostRef.current?.closest("details");
      if (region && details) unregisterRef.current = registerPopoverPortal(details, region);
    }}>{children}</div>, portalHost) : null}
  </>;
}
