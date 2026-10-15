"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Operational workspaces keep their own freshness and offline behavior.
const OPERATIONAL_PATH = /^\/(?:pos|tax-company|admin|api|auth|login|signup|staff|support|settings|salon-settings|book|booking|bookings|booking-payment|booking-setup|my-bookings|check-in|visit|market|account|account-recovery|forgot-password|reset-password|security-check|customers|payroll|payments|permissions|roles|ownership|accept-invite)(?:\/|$)/;

/** Registers an image-only worker without adding any visible cache UI. */
export default function ExperienceMediaCache({ supabaseUrl }: { supabaseUrl: string }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || OPERATIONAL_PATH.test(pathname) || !window.isSecureContext || !("serviceWorker" in navigator)) return;
    let mediaOrigin: string;
    try {
      const url = new URL(supabaseUrl);
      if (url.protocol !== "https:" || url.username || url.password) return;
      mediaOrigin = url.origin;
    } catch {
      return;
    }
    let cancelled = false;
    const register = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        if (cancelled) return;
        const rootScope = new URL("/", window.location.origin).href;
        const root = registrations.find((registration) => registration.scope === rootScope);
        const current = root?.active ?? root?.waiting ?? root?.installing;
        // A root worker belonging to another feature must never be replaced.
        if (current && new URL(current.scriptURL).pathname !== "/experience-sw.js") return;
        await navigator.serviceWorker.register(`/experience-sw.js?mediaOrigin=${encodeURIComponent(mediaOrigin)}`, {
          scope: "/",
          updateViaCache: "none",
        });
      } catch {
        // Cache availability must never affect the page or its requests.
      }
    };
    const onLoad = () => { void register(); };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
    };
  }, [pathname, supabaseUrl]);

  return null;
}
