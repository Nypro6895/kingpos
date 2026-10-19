"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getAppLocalHost } from "@/lib/app-local-host";
import { WorkspaceText } from "./workspace-language";
import { nextExperienceTraceOperation, recordExperienceTrace } from "@/lib/experience-trace";

/** The installed application signs in on the original HTTPS origin, where its
 * cookie, CAPTCHA and MFA controls already run. No auth form runs on its scheme. */
export function AppLocalSessionExpiryPrompt({ authenticated, scope, enabled = true }: { authenticated: boolean | null; scope?: string; enabled?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const openingRef = useRef(false);
  const [session, setSession] = useState({ authenticated, scope, hadSession: authenticated === true, expired: false });
  const [opening, setOpening] = useState(false), [error, setError] = useState("");
  if (session.authenticated !== authenticated || session.scope !== scope) {
    setSession({ authenticated, scope, hadSession: session.hadSession || authenticated === true, expired: authenticated === true ? false : authenticated === false && session.hadSession ? true : session.expired });
    if (authenticated === true) { setOpening(false); setError(""); }
  }
  const expired = session.expired;
  useEffect(() => { if (authenticated === true) openingRef.current = false; }, [authenticated, scope]);
  useEffect(() => {
    if (!enabled || authenticated !== true || !scope) return;
    let alive = true, pending = false;
    const controller = new AbortController();
    const check = async () => {
      if (!alive || pending || !navigator.onLine || document.visibilityState !== "visible") return;
      pending = true;
      const operation = nextExperienceTraceOperation(), began = operation ? performance.now() : 0;
      recordExperienceTrace("auth.start", { source: "app-local", trigger: "interval", operation });
      try {
        const value = await getAppLocalHost().context(location.pathname + location.search, { signal: controller.signal, fresh: true });
        if (!alive || controller.signal.aborted || value.offline) return;
        window.dispatchEvent(new CustomEvent("reylumi:app-local-context", { detail: value }));
        if (!value.context.authenticated) setSession(previous => ({ ...previous, expired: true }));
      } catch { /* Unavailable authentication is not a confirmed expiry. */ }
      finally { recordExperienceTrace("auth.end", { source: "app-local", trigger: "interval", operation, durationMs: operation ? performance.now() - began : 0 }); pending = false; }
    };
    // The entry already validates on mount/focus/foreground. Preserve the web
    // shell's minute check without issuing a second initial context request.
    recordExperienceTrace("timer.schedule", { source: "app-local", trigger: "interval", durationMs: 60_000 });
    const timer = setInterval(() => { recordExperienceTrace("timer.fire", { source: "app-local", trigger: "interval" }); void check(); }, 60_000);
    return () => { recordExperienceTrace("timer.cancel", { source: "app-local", trigger: "interval" }); alive = false; controller.abort(); clearInterval(timer); };
  }, [authenticated, scope, enabled]);
  useEffect(() => {
    if (!expired) return;
    const element = dialog.current, previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [expired]);
  if (!expired) return null;
  return createPortal(<dialog ref={dialog} onCancel={event => event.preventDefault()} aria-labelledby="app-local-session-expired-title" className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-3xl bg-white p-6 backdrop:bg-zinc-950/50">
    <h2 id="app-local-session-expired-title" className="text-xl font-bold"><WorkspaceText text="Session expired" /></h2>
    <p className="mt-3"><WorkspaceText text="Your session has expired. Please log in to continue." /></p>
    {error ? <p role="alert" className="mt-3"><WorkspaceText text={error} /></p> : null}
    <button type="button" disabled={opening} className="mt-5 min-h-11 rounded-full bg-brand-orange px-5 py-3 font-semibold text-white" onClick={() => {
      if (openingRef.current) return;
      openingRef.current = true;
      setOpening(true); setError("");
      void getAppLocalHost().openOnline(`/login?${new URLSearchParams({ next: location.pathname + location.search })}`).catch(() => { openingRef.current = false; setOpening(false); setError("Sign-in could not be opened. Please try again."); });
    }}><WorkspaceText text={opening ? "Opening sign-in…" : "Sign in"} /></button>
  </dialog>, document.body);
}
