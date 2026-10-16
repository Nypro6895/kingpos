"use client";

import NextLink, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { forwardRef, useLayoutEffect, useRef, useState, type ComponentProps } from "react";

function StartupProgress({ pending }: { pending: boolean }) {
  const indicator = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = indicator.current;
    if (element) element.hidden = false;
    return () => { if (element) element.hidden = true; };
  }, [pending]);
  if (!pending) return null;
  return createPortal(<div ref={indicator} role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647]"><span aria-hidden="true" className="block h-1 animate-pulse bg-brand-orange motion-reduce:animate-none" /><span className="sr-only">Opening…</span></div>, document.body);
}

function StartupLinkProgress() {
  const { pending } = useLinkStatus();
  return <StartupProgress pending={pending} />;
}

/** Public startup controls deliberately do not import workspace/plugin bundles. */
export const StartupLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function StartupLink({ children, ...props }, ref) {
  if (props.legacyBehavior) return <NextLink {...props} ref={ref}>{children}</NextLink>;
  return <NextLink {...props} ref={ref}>{children}<StartupLinkProgress /></NextLink>;
});

function rememberExploreStartupDraft(query: string, focused: boolean) {
  const params = new URLSearchParams(window.location.search); params.sort();
  window.__reylumiStartupSearch = { query, focused, at: Date.now(), route: window.location.pathname + (params.size ? `?${params}` : "") };
}

export function StartupSearchForm({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  useLayoutEffect(() => {
    const reset = () => { submitting.current = false; setPending(false); };
    window.addEventListener("pageshow", reset);
    return () => { window.removeEventListener("pageshow", reset); reset(); };
  }, []);
  return <form action="/explore" method="get" role="search" className={className} aria-busy={pending} onSubmit={event => {
    if (submitting.current) { event.preventDefault(); return; }
    submitting.current = true; setPending(true);
  }}>
    <label htmlFor="startup-search" className="sr-only">Search salons, services, or locations</label>
    <input id="startup-search" name="q" type="search" maxLength={200} placeholder="Search salons, services, or locations" autoComplete="off" onChange={event => rememberExploreStartupDraft(event.currentTarget.value, true)} onFocus={event => rememberExploreStartupDraft(event.currentTarget.value, true)} onBlur={event => rememberExploreStartupDraft(event.currentTarget.value, false)} />
    <button type="submit" aria-label="Search" aria-busy={pending} aria-disabled={pending} onClick={event => { if (pending) event.preventDefault(); }}>
      {pending ? <span aria-hidden="true" className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" /> : "⌕"}
    </button>
    <StartupProgress pending={pending} />
  </form>;
}

export function StartupRecovery({ retry }: { retry: () => void }) {
  return <><p>We couldn’t connect. You can try again.</p><button onClick={retry} type="button">Try again</button></>;
}
