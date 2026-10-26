"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { WorkspaceText } from "@/components/workspace-language";

/** Cached pages keep drafts; only explicitly local forms can submit offline. */
export function OfflineNetworkFormGuard() {
  const [blocked, setBlocked] = useState(false);
  const notice = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = notice.current;
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (navigator.onLine || !(form instanceof HTMLFormElement) || form.dataset.offlineLocalSubmit === "true") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setBlocked(true);
    };
    const clear = () => setBlocked(false);
    document.addEventListener("submit", submit, true);
    window.addEventListener("online", clear);
    window.addEventListener("reylumi:experience-reset", clear);
    return () => {
      document.removeEventListener("submit", submit, true);
      window.removeEventListener("online", clear);
      window.removeEventListener("reylumi:experience-reset", clear);
      if (element) element.hidden = true;
      setBlocked(false);
    };
  }, []);
  return <div ref={notice} hidden={!blocked} role="status" aria-live="polite" className="fixed inset-x-4 bottom-24 z-[100] mx-auto max-w-md rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg">
    <WorkspaceText text="You're offline. Your entries are kept. Reconnect to continue." />
  </div>;
}
