"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { LoginForm } from "@/app/login/login-form";
import { useEffect, useRef, useState } from "react";
import { resetExperienceCaches } from "@/lib/reset-experience-cache";
import { invalidateExperienceResources } from "@/lib/experience-resource-cache";
import { createPortal } from "react-dom";

export function SessionExpiryPrompt({ authenticated }: { authenticated: boolean }) {
  const [expired, setExpired] = useState(false);
  const hadSession = useRef(authenticated);
  const invalidated = useRef(false);
  const sessionGeneration = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (authenticated) hadSession.current = true;
  }, [authenticated]);

  useEffect(() => {
    const originalFetch = window.fetch;
    let disposed = false;
    let pending: Promise<void> | null = null;
    let pendingGeneration = -1;

    function checkSession() {
      if (!hadSession.current || disposed || !navigator.onLine) return Promise.resolve();
      const generation = sessionGeneration.current;
      if (pending && pendingGeneration === generation) return pending;
      const admin = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
      const request = originalFetch(`/api/auth/session${admin ? "?scope=admin" : ""}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) return;
          const result = await response.json();
          if (disposed || generation !== sessionGeneration.current || !hadSession.current) return;
          if (result.authenticated === false || result.adminExpired === true) {
            if (!invalidated.current) {
              invalidated.current = true;
              resetExperienceCaches({ reason: "expired", suspend: true, broadcast: true });
            }
            setExpired(true);
          } else if (result.authenticated === true && invalidated.current) {
            invalidated.current = false;
            setExpired(false);
          }
        })
        .catch(() => { /* A connection failure does not prove the session expired. */ })
        .finally(() => { if (pending === request) pending = null; });
      pending = request;
      pendingGeneration = generation;
      return request;
    }

    const monitoredFetch: typeof fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.origin === window.location.origin && url.pathname === "/api/auth/logout" && response.ok) {
        sessionGeneration.current += 1;
        hadSession.current = false;
        invalidated.current = true;
        resetExperienceCaches({ reason: "logout", suspend: true, broadcast: true });
        setExpired(false);
      }
      if (response.ok && url.origin === window.location.origin && !url.pathname.startsWith("/api/auth/") &&
          (headers.has("Next-Action") || ["POST", "PATCH", "PUT", "DELETE"].includes(method))) {
        invalidateExperienceResources({});
        window.dispatchEvent(new Event("reylumi:experience-mutation"));
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
    let lastAdminActivity = 0;
    const onAdminActivity = (event: Event) => {
      if (!event.isTrusted || !hadSession.current || disposed || !navigator.onLine ||
          document.visibilityState !== "visible" ||
          !(window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) ||
          Date.now() - lastAdminActivity < 60_000) return;
      lastAdminActivity = Date.now();
      void originalFetch("/api/auth/admin-activity", { method: "POST", cache: "no-store" })
        .then(response => { if (response.status === 401) void checkSession(); })
        .catch(() => { /* Activity can be retried after connectivity returns. */ });
    };
    const activityEvents = ["pointerdown", "keydown", "touchstart", "scroll"];
    for (const name of activityEvents) document.addEventListener(name, onAdminActivity, { passive: true });
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    void checkSession();
    return () => {
      disposed = true;
      if (window.fetch === monitoredFetch) window.fetch = originalFetch;
      window.clearInterval(interval);
      for (const name of activityEvents) document.removeEventListener(name, onAdminActivity);
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
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
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
      <h2 id="session-expiry-title" className="text-xl font-bold"><WorkspaceText text="Session expired" /></h2>
      <p id="session-expiry-description" className="mt-2 text-sm text-text-secondary">
        <WorkspaceText text="Your session has expired. Please log in to continue." />
      </p>
      <LoginForm nextPath={nextPath} onAuthenticated={() => {
        sessionGeneration.current += 1;
        hadSession.current = true;
        invalidated.current = false;
        resetExperienceCaches({ reason: "identity", suspend: true, broadcast: true, preserveBookingHandoff: true });
        setExpired(false);
      }} />
    </dialog>, document.body,
  );
}
