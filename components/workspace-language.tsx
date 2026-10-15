"use client";
import { createContext, createElement, useContext, useEffect, useState, type ElementType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { translateVietnamese } from "@/lib/vietnamese-dictionary";

const LanguageContext = createContext(false);
export function WorkspaceLanguageProvider({ enabled, portableEnabled, expiresAt, portableSession = false, children }: { enabled: boolean; portableEnabled: boolean; expiresAt: string | null; portableSession?: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!expiresAt) return;
    const check = () => setExpired(Date.now() >= Date.parse(expiresAt));
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const personalRoutes = ["/admin", "/explore", "/book/", "/beauty", "/my-bookings", "/activity"];
  const active = (pathname.startsWith("/pos/portable") ? portableEnabled : enabled) && !expired && !personalRoutes.some(route => pathname.startsWith(route));
  useEffect(() => { if (pathname.startsWith("/pos/portable") && !portableSession) return; document.documentElement.lang = active ? "vi" : "en"; }, [active, pathname, portableSession]);
  return <LanguageContext.Provider value={active}>{children}</LanguageContext.Provider>;
}
export function useWorkspaceTranslation() {
  const enabled = useContext(LanguageContext);
  return <T,>(text: T): T => typeof text === "string" ? translateVietnamese(text, enabled) as T : text;
}
export function workspaceDialogText(text: string) {
  return translateVietnamese(text, typeof document !== "undefined" && document.documentElement.lang === "vi");
}
export function WorkspaceText({ text }: { text: ReactNode }) {
  const t = useWorkspaceTranslation();
  return <>{typeof text === "string" ? t(text) : text}</>;
}

// Transparent host element for server-rendered inputs and accessible attributes.
// Attribute names, submitted values and event handlers are never translated.
export function WorkspaceElement({ as, children, ...props }: { as: ElementType; children?: ReactNode; [key: string]: unknown }) {
  const t = useWorkspaceTranslation();
  const attributes = { ...props };
  for (const key of ["title", "placeholder", "aria-label", "alt"]) if (typeof attributes[key] === "string") attributes[key] = t(attributes[key] as string);
  return createElement(as, attributes, children);
}
