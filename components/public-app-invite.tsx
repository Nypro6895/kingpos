"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { PUBLIC_APP_INVITE_DISMISS_KEY, publicAppInviteAction, publicAppInviteDismissed, publicAppInvitePlatform, publicAppInviteTarget, type PublicAppInviteConfig } from "@/lib/public-app-invite";
import styles from "./public-app-invite.module.css";

function subscribe(onChange: () => void) {
  const events = ["hashchange", "popstate", "storage", "pageshow"] as const;
  events.forEach(event => window.addEventListener(event, onChange));
  const mode = window.matchMedia("(display-mode: standalone)");
  mode.addEventListener("change", onChange);
  return () => {
    events.forEach(event => window.removeEventListener(event, onChange));
    mode.removeEventListener("change", onChange);
  };
}

function browserSnapshot() {
  let dismissedAt: string | null = null;
  try { dismissedAt = localStorage.getItem(PUBLIC_APP_INVITE_DISMISS_KEY); } catch { /* Dismissal still works in this document. */ }
  const host = window as Window & { __reylumiAppLocalTransport?: unknown; __reylumiAppLocalContext?: unknown };
  return JSON.stringify({
    href: window.location.href,
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    native: Boolean(host.__reylumiAppLocalTransport && host.__reylumiAppLocalContext),
    standalone: window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    dismissedAt,
  });
}

/** Informational only: never reads account data, claims a card, or redirects automatically. */
export function PublicAppInvite({ config }: { config: PublicAppInviteConfig }) {
  usePathname();
  useSearchParams();
  const snapshot = useSyncExternalStore(subscribe, browserSnapshot, () => "");
  const [closed, setClosed] = useState(false);
  if (!config.enabled || closed || !snapshot) return null;
  const browser = JSON.parse(snapshot) as { href: string; userAgent: string; maxTouchPoints: number; native: boolean; standalone: boolean; dismissedAt: string | null };
  if (publicAppInviteDismissed(browser.dismissedAt)) return null;
  const target = publicAppInviteTarget(browser.href);
  const platform = publicAppInvitePlatform(browser);
  const action = publicAppInviteAction(config, platform, target);
  if (!action || !target) return null;
  // Safari already has the system banner on this dedicated landing page.
  const dedicatedCheckin = new URL(browser.href).pathname.startsWith("/check-in/");
  if (platform === "ios" && dedicatedCheckin && /Safari\//.test(browser.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(browser.userAgent)) return null;
  const dismiss = () => {
    setClosed(true);
    try { localStorage.setItem(PUBLIC_APP_INVITE_DISMISS_KEY, String(Date.now())); } catch { /* No capability or account information is stored. */ }
  };
  return <aside className={styles.banner} aria-label="Reylumi app">
    <div className={styles.inner}>
      <Image src="/brand/reylumi-favicon.png" alt="" width={44} height={44} className={styles.icon} unoptimized />
      <div className={styles.content}>
        <strong className={styles.title}>Reylumi, wherever you go</strong>
        <p className={styles.description}>{target.kind === "gift" ? "Keep your gift cards close with the Reylumi app." : target.kind === "check-in" ? "Check in and choose your services in the Reylumi app." : "Keep your beauty plans together in the Reylumi app."}</p>
        <div className={styles.actions}>
          <a href={action.storeUrl} className={styles.primary} rel="noreferrer" referrerPolicy="no-referrer">{platform === "ios" ? "Get the iPhone app" : "Get the Android app"}</a>
          {action.appUrl && !dedicatedCheckin && <a href={action.appUrl} className={styles.textAction} rel="noreferrer" referrerPolicy="no-referrer">Open app</a>}
          <button type="button" className={styles.textAction} onClick={dismiss}>Continue on web</button>
        </div>
      </div>
      <button type="button" className={styles.close} aria-label="Dismiss app invitation" onClick={dismiss}>×</button>
    </div>
  </aside>;
}
