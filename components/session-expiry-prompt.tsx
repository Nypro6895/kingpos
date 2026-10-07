"use client";

import { LoginForm } from "@/app/login/login-form";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function SessionExpiryPrompt({ authenticated }: { authenticated: boolean }) {
  const [expired, setExpired] = useState(false);
  const hadSession = useRef(authenticated);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (authenticated) hadSession.current = true;
  }, [authenticated]);

  useEffect(() => {
    const originalFetch = window.fetch;
    let disposed = false;
    let pending: Promise<void> | null = null;

    function checkSession() {
      if (!hadSession.current || disposed || !navigator.onLine) return Promise.resolve();
      pending ??= originalFetch("/api/auth/session", { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const result = await response.json();
          if (!disposed && result.authenticated === false) setExpired(true);
        })
        .catch(() => { /* A connection failure does not prove the session expired. */ })
        .finally(() => { pending = null; });
      return pending;
    }

    const monitoredFetch: typeof fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (url.origin === window.location.origin && url.pathname === "/api/auth/logout" && response.ok) {
        hadSession.current = false;
        setExpired(false);
      }
      // Authentication requests must keep their own validation and MFA errors.
      if (url.origin === window.location.origin && !url.pathname.startsWith("/api/auth/") &&
          (response.status === 401 || headers.has("Next-Action") ||
           (response.redirected && new URL(response.url).pathname === "/login"))) {
        await checkSession();
      }
      return response;
    };
    window.fetch = monitoredFetch;
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    const interval = window.setInterval(onVisible, 60_000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    void checkSession();
    return () => {
      disposed = true;
      if (window.fetch === monitoredFetch) window.fetch = originalFetch;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!expired) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [expired]);

  if (!expired) return null;
  const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return createPortal(
    <dialog ref={dialog} aria-labelledby="session-expiry-title" aria-describedby="session-expiry-description"
      onCancel={(event) => event.preventDefault()}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-3xl bg-white p-6 text-text-primary shadow-2xl backdrop:bg-zinc-950/50">
      <h2 id="session-expiry-title" className="text-xl font-bold">Session expired</h2>
      <p id="session-expiry-description" className="mt-2 text-sm text-text-secondary">
        Your session has expired. Please log in to continue.
      </p>
      <LoginForm nextPath={nextPath} onAuthenticated={() => setExpired(false)} />
    </dialog>, document.body,
  );
}
