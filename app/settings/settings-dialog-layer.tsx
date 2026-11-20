"use client";

import { useOverlayPortalHost, useTransientOverlay } from "@/components/overlay-dismissal";
import { useOverlayViewport } from "@/components/use-overlay-viewport";
import { createContext, useContext, useEffectEvent, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SettingsDialogContext = createContext(false);
export function useSettingsDialogActions() {
  return useContext(SettingsDialogContext);
}

/** Keep nested Settings dialogs outside the page's paint containment. */
export function SettingsDialogLayer({ children, onClose, zIndex = 110 }: {
  children: ReactNode;
  onClose: () => void;
  zIndex?: number;
}) {
  const host = useOverlayPortalHost();
  const layerRef = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(onClose);
  useTransientOverlay(onClose, Boolean(host), true);
  useOverlayViewport(layerRef, Boolean(host));

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!host || !layer) return;
    const dialog = layer.querySelector<HTMLElement>('[role="dialog"]');
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openedAt = window.location.href;
    layer.hidden = false;
    dialog?.focus({ preventScroll: true });
    const keyDown = (event: KeyboardEvent) => {
      // A nested phone/email verification portal owns its own focus and Escape.
      if (event.defaultPrevented || !layer.contains(document.activeElement)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab" && dialog) {
        const targets = Array.from(dialog.querySelectorAll<HTMLElement>(
          'a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        )).filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
        const first = targets[0], last = targets.at(-1);
        if (!first || !last) {
          event.preventDefault();
          dialog.focus({ preventScroll: true });
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyDown);
    return () => {
      const restore = layer.contains(document.activeElement) || document.activeElement === document.body;
      layer.hidden = true;
      document.removeEventListener("keydown", keyDown);
      if (restore && window.location.href === openedAt && opener?.isConnected && opener.getClientRects().length) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [host]);

  return host ? createPortal(
    <div ref={layerRef} className="fixed inset-0" style={{ zIndex }} data-settings-dialog-layer hidden>
      <SettingsDialogContext.Provider value>{children}</SettingsDialogContext.Provider>
    </div>, host,
  ) : null;
}
