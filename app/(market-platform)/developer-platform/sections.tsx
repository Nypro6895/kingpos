"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import copy from "@/lib/vietnamese-developer-market.json";
import { developerPanel, developerPanelHref, developerHistoryUrl, readDeveloperLocation, standardDeveloperPanels, type DeveloperLanguage } from "@/lib/market-platform/developer-navigation";

type PortalState = { section: string; language: DeveloperLanguage; saved: boolean; select: (value: string) => void; setLanguage: (value: DeveloperLanguage) => void };
const PortalContext = createContext<PortalState>({ section: "overview", language: "en", saved: false, select: () => {}, setLanguage: () => {} });
export function DeveloperPortal({ children, initialPanel = "overview", initialLanguage = "en", initialSaved = false, availablePanels = standardDeveloperPanels }: {
  children: ReactNode; initialPanel?: string; initialLanguage?: DeveloperLanguage; initialSaved?: boolean; availablePanels?: readonly string[];
}) {
  const [state, setState] = useState({ section: initialPanel, language: initialLanguage, saved: initialSaved });
  const section = developerPanel(state.section, availablePanels);
  useEffect(() => {
    const restore = () => {
      const next = readDeveloperLocation(window.location.search, availablePanels);
      if (new URLSearchParams(window.location.search).has("saved")) window.history.replaceState(window.history.state, "", developerHistoryUrl(window.location.href, next.panel, next.language));
      setState({ section: next.panel, language: next.language, saved: false });
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [availablePanels]);
  const select = (value: string) => {
    const next = developerPanel(value, availablePanels);
    if (new URLSearchParams(window.location.search).has("saved")) window.history.replaceState(window.history.state, "", developerHistoryUrl(window.location.href, section, state.language));
    if (next !== section) window.history.pushState(window.history.state, "", developerHistoryUrl(window.location.href, next, state.language));
    setState(current => ({ ...current, section: next, saved: false }));
  };
  const setLanguage = (language: DeveloperLanguage) => {
    window.history.replaceState(window.history.state, "", developerHistoryUrl(window.location.href, section, language));
    setState(current => ({ ...current, section, language, saved: false }));
  };
  return <PortalContext.Provider value={{ section, language: state.language, saved: state.saved, select, setLanguage }}>{children}</PortalContext.Provider>;
}
export function DeveloperText({ text }: { text: string }) {
  const { language } = useContext(PortalContext);
  return language === "vi" ? (copy as Record<string, string>)[text] ?? text : text;
}
export function DeveloperLanguagePicker() {
  const { language, setLanguage } = useContext(PortalContext);
  return <label><DeveloperText text="Display language" /><select aria-label="Developer display language" value={language} onChange={event => setLanguage(event.target.value === "vi" ? "vi" : "en")}><option value="en">English</option><option value="vi">Tiếng Việt</option></select></label>;
}
export function DeveloperSaveNotice() { return useContext(PortalContext).saved ? <p role="status"><DeveloperText text="Saved. Your workspace has been refreshed." /></p> : null; }
export function useDeveloperLanguage() { return useContext(PortalContext).language; }
export function useDeveloperPanel() { return useContext(PortalContext).section; }
export function PortalNavigation({ reviewer, finance }: { reviewer: boolean; finance: boolean }) {
  const { section, select, language } = useContext(PortalContext);
  const items = [["overview", "Overview"], ["developer", "Apps & connections"], ["account", "Profile & security"], ["testing", "Testing & readiness"], ["commerce", "Payments & payouts"], ...(reviewer ? [["review", "Independent review"]] : []), ...(finance ? [["finance", "Financial administration"]] : [])];
  return <nav aria-label="Developer workspace sections">{items.map(([id, label]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => select(id)}><DeveloperText text={label} /></button>)}{section === "testing" && <button type="button" onClick={() => window.location.assign(developerPanelHref("testing", language))}><DeveloperText text="Refresh evidence" /></button>}</nav>;
}
export function PortalSection({ id, children }: { id: string; children: ReactNode }) { return <section id={id} hidden={useContext(PortalContext).section !== id}>{children}</section>; }
export function PortalJump({ panel, children }: { panel: string; children: ReactNode }) { const { select } = useContext(PortalContext); return <button type="button" onClick={() => select(panel)}>{children}</button>; }
/** Explicit recovery must make a fresh document request. */
export function DeveloperPanelLink({ panel, children }: { panel: string; children: ReactNode }) { return <a href={developerPanelHref(panel, useContext(PortalContext).language)}>{children}</a>; }
