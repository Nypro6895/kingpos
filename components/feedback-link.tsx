"use client";

import NextLink, { useLinkStatus } from "next/link";
import { forwardRef, useLayoutEffect, useRef, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { WorkspaceText } from "@/components/workspace-language";

export function NavigationProgress({ pending }: { pending: boolean }) {
  const indicator = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = indicator.current;
    if (element) element.hidden = false;
    // Activity disconnects effects while retaining the portal's DOM. Hide its
    // viewport indicator too, including while hidden state updates are paused.
    return () => { if (element) element.hidden = true; };
  }, [pending]);
  if (!pending) return null;

  // A portal keeps the hint out of link/grid layout and transformed menus.
  return createPortal(
    <div ref={indicator} role="status" className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647]">
      <span aria-hidden="true" className="block h-1 animate-pulse bg-brand-orange motion-reduce:animate-none" />
      <span className="sr-only"><WorkspaceText text="Opening…" /></span>
    </div>,
    document.body,
  );
}

function NavigationFeedback() {
  const { pending } = useLinkStatus();
  return <NavigationProgress pending={pending} />;
}

/** Keep Next's own cancellation, prefetch, modifier-click and ref semantics. */
const FeedbackLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(
  function FeedbackLink({ children, ...props }, ref) {
    if (props.legacyBehavior) return <NextLink {...props} ref={ref}>{children}</NextLink>;
    return (
      <NextLink {...props} ref={ref}>
        {children}
        <NavigationFeedback />
      </NextLink>
    );
  },
);

export default FeedbackLink;
