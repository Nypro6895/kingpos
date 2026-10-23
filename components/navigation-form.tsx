"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { ActionFeedback } from "@/components/action-feedback";
import { NavigationProgress } from "@/components/feedback-link";

const NavigationPendingContext = createContext(false);

/** Ordinary document navigation: retain the server's workspace/auth handoff. */
export function NavigationForm({ children, onSubmit, ...props }: ComponentProps<"form">) {
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  useLayoutEffect(() => {
    const reset = () => {
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
