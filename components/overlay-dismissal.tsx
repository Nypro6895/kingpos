"use client";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { installPopoverDismissal, closePopovers } from "@/lib/dismissible-popovers";
export const OVERLAY_NAVIGATION_EVENT = "reylumi:overlay-navigation";
const LOCATION_EVENT = "reylumi:overlay-location";
const subscribePortalHost = () => () => {};
const getPortalHost = () => document.body;
const getServerPortalHost = () => null;
// Keep server rendering and hydration identical before moving a drawer outside
// transformed page containers that can clip it or trap it below navigation.
export function useOverlayPortalHost() {
  return useSyncExternalStore(subscribePortalHost, getPortalHost, getServerPortalHost);
}
export function OverlayDismissal() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const locationKey = pathname + (search ? `?${search}` : "");
  const previousLocation = useRef(locationKey);
  const previous = useRef(pathname);
  useEffect(() => installPopoverDismissal(document), []);
  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      closePopovers(document);
    }
  }, [pathname]);
  useEffect(() => {
    if (previousLocation.current !== locationKey) {
      previousLocation.current = locationKey;
      closePopovers(document);
      document.dispatchEvent(new Event(LOCATION_EVENT));
    }
  }, [locationKey]);
  useEffect(() => {
    const changed = () => {
      closePopovers(document);
      document.dispatchEvent(new Event(LOCATION_EVENT));
    };
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("popstate", changed);
    };
  }, []);
  return null;
}

/** For local UI state only: reset must not navigate, submit, or discard stored work.
 * URL-driven drawers keep their own URL lifecycle and must not use this hook.
 */
export function useTransientOverlay(reset: () => void, enabled = true, includeSearchAndHash = false) {
  const latest = useRef(reset);
  const generation = useRef(0);
  useLayoutEffect(() => { latest.current = reset; });
  useLayoutEffect(() => {
    const current = ++generation.current;
    if (!enabled) return;
    const locationKey = () => includeSearchAndHash ? window.location.href : window.location.pathname;
    const openedAt = locationKey();
    const dismiss = (event: Event) => {
      // A dialog mounted by the destination route already belongs to that URL.
      // Explicit dismissal events (without route metadata) still close it.
      if ((event.type === OVERLAY_NAVIGATION_EVENT && !(event as CustomEvent).detail) || locationKey() !== openedAt) latest.current();
    };
    document.addEventListener(LOCATION_EVENT, dismiss);
    document.addEventListener(OVERLAY_NAVIGATION_EVENT, dismiss);
    const resetAfterDisconnect = () => queueMicrotask(() => {
      if (generation.current === current) latest.current();
    });
    return () => {
      document.removeEventListener(LOCATION_EVENT, dismiss);
      document.removeEventListener(OVERLAY_NAVIGATION_EVENT, dismiss);
      // Activity disconnects effects while retaining state. Do not resurrect an
      // old popup on Back. A microtask lets StrictMode's immediate setup cancel it.
      resetAfterDisconnect();
    };
  }, [enabled, includeSearchAndHash]);
}
export function useCloseOnNavigation(onClose: () => void, enabled = true) {
  const pathname = usePathname();
  const previous = useRef(pathname);
  const latest = useRef(onClose);
  useLayoutEffect(() => { latest.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const changed = previous.current !== pathname;
    previous.current = pathname;
    if (enabled && changed) latest.current();
  }, [pathname, enabled]);
  useEffect(() => {
    if (!enabled) return;
    function dismiss() { latest.current(); }
    document.addEventListener(OVERLAY_NAVIGATION_EVENT, dismiss);
    return () => document.removeEventListener(OVERLAY_NAVIGATION_EVENT, dismiss);
  }, [enabled]);
}

/** Ref-only dialogs must leave the browser top layer even when Activity detaches refs. */
export function useNativeDialogNavigation(ref: RefObject<HTMLDialogElement | null>) {
  useTransientOverlay(() => ref.current?.close());
  const lastDialog = useRef<HTMLDialogElement | null>(null);
  const generation = useRef(0);
  useLayoutEffect(() => { lastDialog.current = ref.current; });
  useLayoutEffect(() => {
    const current = ++generation.current;
    const closeAfterDisconnect = (dialog: HTMLDialogElement | null) => queueMicrotask(() => {
      if (generation.current === current && dialog?.open) dialog.close();
    });
    return () => closeAfterDisconnect(lastDialog.current);
  }, [ref]);
}
