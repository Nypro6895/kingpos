"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { ActionFeedback } from "@/components/action-feedback";
import { NavigationProgress } from "@/components/feedback-link";
import { APP_LOCAL_SEARCH_NAVIGATION_EVENT, appLocalSearchNavigationDetail } from "@/lib/app-local-search-navigation";

const NavigationPendingContext = createContext(false);

/** Ordinary document navigation: retain the server's workspace/auth handoff. */
export function NavigationForm({ children, onSubmit, ...props }: ComponentProps<"form">) {
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const searchListener = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const reset = () => {
      searchListener.current?.();
      searchListener.current = null;
      submitting.current = false;
      setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
      reset();
    };
  }, []);

  return (
    <form {...props} aria-busy={pending} onSubmit={(event) => {
      onSubmit?.(event);
      if (event.defaultPrevented) return;
      if (submitting.current) {
        event.preventDefault();
        return;
      }
      const form = event.currentTarget;
      if (form.getAttribute("role") === "search" || form.matches('[data-app-local-read-filter="payroll-tax-period"],[data-app-local-read-filter="portable-report-date"]')) {
        // Only the installed helper acknowledges its approved Explore search or
        // explicitly marked read filters. Hosted document handoffs stay native.
        let active: { attempt: string; destination: string } | null = null;
        const receive = (event: Event) => {
          if (event.target !== form) return;
          const detail = appLocalSearchNavigationDetail(event);
          if (!detail) return;
          if (detail.phase === "start") { active = detail; return; }
          if (!active || active.attempt !== detail.attempt || active.destination !== detail.destination) return;
          searchListener.current?.(); searchListener.current = null;
          submitting.current = false; setPending(false);
        };
        form.addEventListener(APP_LOCAL_SEARCH_NAVIGATION_EVENT, receive);
        searchListener.current = () => form.removeEventListener(APP_LOCAL_SEARCH_NAVIGATION_EVENT, receive);
      }
      submitting.current = true;
      setPending(true);
    }}>
      <NavigationPendingContext.Provider value={pending}>{children}</NavigationPendingContext.Provider>
      <NavigationProgress pending={pending} />
    </form>
  );
}

export function NavigationSubmitButton({ children, disabled, onClick, pendingLabel = "Opening…", ...props }: ComponentProps<"button"> & { pendingLabel?: string }) {
  const pending = useContext(NavigationPendingContext);
  return (
    <button {...props} type="submit" disabled={disabled} aria-disabled={disabled || pending} aria-busy={pending} onClick={(event) => {
      // Native GET serializes the submitter after this event; disabling it here
      // would silently discard its name/value. Guard later clicks instead.
      if (pending) {
        event.preventDefault();
        return;
      }
      onClick?.(event);
    }}>
      <ActionFeedback pending={pending} pendingLabel={pendingLabel}>{children}</ActionFeedback>
    </button>
  );
}
