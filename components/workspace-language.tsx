"use client";
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { translateVietnamese } from "@/lib/vietnamese-dictionary";

const LanguageContext = createContext(false);
type LanguageConfiguration = { enabled: boolean; portableEnabled: boolean; expiresAt: string | null };
const ConfigurationContext = createContext<{ apply: (scope: string, value: LanguageConfiguration) => void } | null>(null);

export function WorkspaceLanguageProvider({ enabled, portableEnabled, expiresAt, portableSession = false, scope = "", children }: { enabled: boolean; portableEnabled: boolean; expiresAt: string | null; portableSession?: boolean; scope?: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const initialKey = JSON.stringify([enabled, portableEnabled, expiresAt]);
  const [configuration, setConfiguration] = useState<(LanguageConfiguration & { scope: string; initialKey: string }) | null>(null);
  const apply = useCallback((targetScope: string, value: LanguageConfiguration) => {
    if (!scope || targetScope !== scope) return;
    setConfiguration(previous => previous?.scope === scope && previous.initialKey === initialKey && previous.enabled === value.enabled && previous.portableEnabled === value.portableEnabled && previous.expiresAt === value.expiresAt ? previous : { ...value, scope, initialKey });
  }, [scope, initialKey]);
  const update = useMemo(() => ({ apply }), [apply]);
  const current = configuration?.scope === scope && configuration.initialKey === initialKey ? configuration : { enabled, portableEnabled, expiresAt };
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const check = () => setExpired(Boolean(current.expiresAt && Date.now() >= Date.parse(current.expiresAt)));
    check();
    if (!current.expiresAt) return;
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [current.expiresAt]);
  const personalRoutes = ["/admin", "/explore", "/book/", "/beauty", "/my-bookings", "/activity"];
  const active = (pathname.startsWith("/pos/portable") ? current.portableEnabled : current.enabled) && !expired && !personalRoutes.some(route => pathname.startsWith(route));
  useEffect(() => { if (pathname.startsWith("/pos/portable") && !portableSession) return; document.documentElement.lang = active ? "vi" : "en"; }, [active, pathname, portableSession]);
  return <ConfigurationContext.Provider value={update}><LanguageContext.Provider value={active}>{children}</LanguageContext.Provider></ConfigurationContext.Provider>;
}

/** Optional server configuration updates only its matching authorized shell. */
export function WorkspaceLanguageConfiguration({ scope, enabled, portableEnabled, expiresAt }: LanguageConfiguration & { scope: string }) {
  const configuration = useContext(ConfigurationContext);
  useEffect(() => { configuration?.apply(scope, { enabled, portableEnabled, expiresAt }); }, [configuration, scope, enabled, portableEnabled, expiresAt]);
  return null;
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
