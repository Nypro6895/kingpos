"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicBookingPageData } from "@/lib/public-booking";
import { useCloseOnNavigation } from "@/components/overlay-dismissal";
import styles from "./quick-booking.module.css";
import { useExploreAuthenticated } from "@/components/explore-account-actions";

type BookingComponent = typeof import("@/app/book/[salonId]/public-booking-client").PublicBookingClient;
let modulePromise: Promise<BookingComponent> | undefined;
const loadWizard = () => modulePromise ??= import("@/app/book/[salonId]/public-booking-client").then(module => module.PublicBookingClient);

function bookingUrl(href: string) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || !/^\/(?:book|booking)\/[0-9a-f-]{36}\/?$/i.test(url.pathname)) return null;
  return url;
}

async function loadContext(url: URL, signal: AbortSignal) {
  const params = new URLSearchParams(url.search);
  params.set("salonId", url.pathname.split("/")[2]);
  const response = await fetch(`/api/public-booking/context?${params}`, { cache: "no-store", credentials: "same-origin", signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error("unavailable");
  return await response.json() as PublicBookingPageData;
}

export function QuickBooking() {
  const authenticated = useExploreAuthenticated();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const busy = useRef(false);
  const activeHref = useRef<string | null>(null);
  const warmContext = useRef<{ href: string; started: number; controller: AbortController; promise: Promise<PublicBookingPageData> } | null>(null);
  const [href, setHref] = useState<string | null>(null);
  const [data, setData] = useState<PublicBookingPageData | null>(null);
  const [Wizard, setWizard] = useState<BookingComponent | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const close = () => { if (busy.current) return; activeHref.current = null; setHref(null); setData(null); };
  useCloseOnNavigation(() => { busy.current = false; close(); });
  useEffect(() => {
    const open = (value: string) => {
      const url = bookingUrl(value);
      if (!url || busy.current || activeHref.current === url.href) return;
      if (!authenticated && location.pathname.startsWith('/explore')) {
        window.dispatchEvent(new CustomEvent('reylumi:booking-auth-required',{detail:{href:url.href,name:'this salon'}}));
        return;
      }
      activeHref.current = url.href;
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setData(null); setError(""); setHref(url.href);
    };
    const onIntent = (event: Event) => open((event as CustomEvent<{href:string}>).detail.href);
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target || link.hasAttribute("download") || link.dataset.bookingPage === "true" || !bookingUrl(link.href) || /^\/book\//.test(location.pathname)) return;
      event.preventDefault(); event.stopPropagation(); open(link.href);
    };
    const warm = (href: string) => {
      const url = bookingUrl(href);
      if (!url) return;
      void loadWizard().catch(() => { modulePromise = undefined; });
      // One short-lived, private request per popup. A click consumes it once.
      if (warmContext.current?.href === url.href && performance.now() - warmContext.current.started < 5000) return;
      warmContext.current?.controller.abort();
      const controller = new AbortController();
      const promise = loadContext(url, controller.signal);
      warmContext.current = { href: url.href, started: performance.now(), controller, promise };
      void promise.catch(() => { if (warmContext.current?.controller === controller) warmContext.current = null; });
    };
    let intentTimer: ReturnType<typeof setTimeout> | undefined;
    const preload = (event: Event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (event instanceof PointerEvent && event.relatedTarget instanceof Node && link?.contains(event.relatedTarget)) return;
      if (intentTimer) clearTimeout(intentTimer);
      if (!link) return;
      if (event.type !== "pointerover") { warm(link.href); return; }
      intentTimer = setTimeout(() => { if (link.matches(":hover")) warm(link.href); },180);
    };
    const onWarm = (event: Event) => warm((event as CustomEvent<{href:string}>).detail.href);
    window.addEventListener("reylumi:preload-book", onWarm);
    window.addEventListener("reylumi:quick-book", onIntent);
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerover", preload, { passive: true });
    document.addEventListener("focusin", preload);
    document.addEventListener("pointerdown", preload, { passive: true });
    return () => { if(intentTimer)clearTimeout(intentTimer); window.removeEventListener("reylumi:preload-book", onWarm); window.removeEventListener("reylumi:quick-book", onIntent); document.removeEventListener("click", onClick, true); document.removeEventListener("pointerover", preload); document.removeEventListener("focusin", preload); document.removeEventListener("pointerdown", preload); warmContext.current?.controller.abort(); warmContext.current = null; };
  }, [authenticated]);
  useEffect(() => {
    if (!href) return;
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const abort = new AbortController();
    const url = new URL(href);
    const warm = warmContext.current;
    warmContext.current = null;
    const usableWarm = warm?.href === url.href && performance.now() - warm.started < 5000;
    if (warm && !usableWarm) warm.controller.abort();
    const contextRequest = usableWarm ? warm.promise.catch(() => loadContext(url, abort.signal)) : loadContext(url, abort.signal);
    void Promise.all([loadWizard(), contextRequest]).then(([component, context]) => { if (!abort.signal.aborted) {
      if(location.pathname.startsWith('/explore') && (context.state==='booking_disabled' || context.state==='incomplete')) {
        close();
        window.dispatchEvent(new CustomEvent('reylumi:contact-salon',{detail:{href:null,name:context.salon?.name??'this salon',contactHref:`/explore/salons/${url.pathname.split('/')[2]}`,phoneHref:context.salon?.phone?`tel:${context.salon.phone}`:null}}));
        return;
      }
      setWizard(() => component); setData(context);
    } }).catch(() => { if (!abort.signal.aborted) { modulePromise = undefined; setError("Times could not be loaded. Please try again."); } });
    return () => { abort.abort(); if (usableWarm) warm.controller.abort(); element?.close(); document.body.style.overflow = previous; opener.current?.focus(); };
  }, [href, retry]);
  if (!href) return null;
  return <dialog ref={dialog} className={styles.dialog} aria-label="Quick booking" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    {data && Wizard ? <Wizard data={data} embedded onClose={close} onBusyChange={value => { busy.current = value; }} /> : <div className={styles.loading}><header><strong>Book an appointment</strong><button onClick={close} aria-label="Close booking">×</button></header>{error ? <><p role="alert">{error}</p><button className={styles.primary} onClick={() => { setError(""); setRetry(value => value + 1); }}>Try again</button></> : <><div className={styles.skeleton}/><div className={styles.skeleton}/><p role="status">Checking available times…</p></>}</div>}
  </dialog>;
}
