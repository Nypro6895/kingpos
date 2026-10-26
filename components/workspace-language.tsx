"use client";
import { createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ElementType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { loadWorkspaceTranslator, type WorkspaceTranslator } from "@/lib/workspace-translator-client";

const LanguageContext = createContext<WorkspaceTranslator | null>(null);
type LanguageConfiguration = { enabled: boolean; portableEnabled: boolean; expiresAt: string | null };
const ConfigurationContext = createContext<{ apply: (scope: string, value: LanguageConfiguration) => void } | null>(null);
let dialogLanguage: { translator: WorkspaceTranslator; pathname: string; expiresAt: string | null } | null = null;
const serverExpiry = () => false;

function useLanguageExpired(expiresAt: string | null) {
  const snapshot = useCallback(() => Boolean(expiresAt && Date.now() >= Date.parse(expiresAt)), [expiresAt]);
  const subscribe = useCallback((changed: () => void) => {
    if (!expiresAt) return () => {};
    const deadline = Date.parse(expiresAt);
    const timeout = Number.isFinite(deadline) ? setTimeout(changed, Math.max(0, Math.min(30_000, deadline - Date.now() + 1))) : undefined;
    const interval = setInterval(changed, 30_000);
    return () => { if (timeout !== undefined) clearTimeout(timeout); clearInterval(interval); };
  }, [expiresAt]);
  return useSyncExternalStore(subscribe, snapshot, serverExpiry);
}

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
  const expired = useLanguageExpired(current.expiresAt);
  // Match server HTML even when another hydrated view has already loaded copy.
  const [translator, setTranslator] = useState<WorkspaceTranslator | null>(null);
  const personalRoutes = ["/admin", "/explore", "/book/", "/beauty", "/my-bookings", "/activity"];
  const eligible = (pathname.startsWith("/pos/portable") ? current.portableEnabled : current.enabled) && !expired && !personalRoutes.some(route => pathname.startsWith(route));
  useEffect(() => {
    if (!eligible || current.expiresAt && Date.now() >= Date.parse(current.expiresAt)) return;
    let active = true;
    void loadWorkspaceTranslator().then(value => { if (active) setTranslator(() => value); }, () => { /* Copy failure must leave the current draft usable. */ });
    return () => { active = false; };
  }, [eligible, scope, initialKey, current.expiresAt]);
  const activeTranslator = eligible ? translator : null;
  useLayoutEffect(() => {
    if (pathname.startsWith("/pos/portable") && !portableSession) return;
    const language = activeTranslator ? { translator: activeTranslator, pathname, expiresAt: current.expiresAt } : null;
    dialogLanguage = language;
    document.documentElement.lang = language ? "vi" : "en";
    return () => { if (language && dialogLanguage === language) { dialogLanguage = null; document.documentElement.lang = "en"; } };
  }, [activeTranslator, pathname, portableSession, current.expiresAt]);
  return <ConfigurationContext.Provider value={update}><LanguageContext.Provider value={activeTranslator}>{children}</LanguageContext.Provider></ConfigurationContext.Provider>;
}

/** Optional server configuration updates only its matching authorized shell. */
export function WorkspaceLanguageConfiguration({ scope, enabled, portableEnabled, expiresAt }: LanguageConfiguration & { scope: string }) {
  const configuration = useContext(ConfigurationContext);
  useEffect(() => { configuration?.apply(scope, { enabled, portableEnabled, expiresAt }); }, [configuration, scope, enabled, portableEnabled, expiresAt]);
  return null;
}
export function useWorkspaceTranslation() {
  const translator = useContext(LanguageContext);
  return <T,>(text: T): T => typeof text === "string" && translator ? translator(text, true) as T : text;
}
export function workspaceDialogText(text: string) {
  const language = dialogLanguage;
  if (typeof document === "undefined" || !language || document.documentElement.lang !== "vi" || language.pathname !== window.location.pathname
    || language.expiresAt && Date.now() >= Date.parse(language.expiresAt)) return text;
  return language.translator(text, true);
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
