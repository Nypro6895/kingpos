"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";
import "./compact-settings.css";
import {SettingsChildPages} from "./settings-child-pages";

type Item = { id: string; label: string; group: string; danger?: boolean };
const PageContext = createContext<{ selected: string; open: (id: string) => void }>({ selected: "", open: () => {} });

/** Keep the actual server-rendered forms mounted: switching pages never drops drafts. */
export function CompactSettingsWorkspace({ items, children, name, initialPage = "" }: { items: Item[]; children: ReactNode; name: string; initialPage?: string }) {
  const [selected, setSelected] = useState(initialPage);
  const root = useRef<HTMLDivElement>(null);
  function open(id: string) {
    setSelected(items.some(item => item.id === id) ? id : "");
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${id ? `#${id}` : ""}`);
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: "start" }));
  }
  useEffect(() => {
    const restore = () => {
      const id = window.location.hash.slice(1);
      setSelected(items.some(item => item.id === id) ? id : initialPage);
    };
    restore();
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => { window.removeEventListener("popstate", restore); window.removeEventListener("hashchange", restore); };
  }, [items, initialPage]);
  useEffect(() => {
    if (selected) root.current?.querySelector<HTMLElement>(".compact-page-heading")?.focus({ preventScroll: true });
  }, [selected]);
  const item = items.find(item => item.id === selected);
  return <PageContext.Provider value={{ selected, open }}><div ref={root} className="compact-settings salon-compact-workspace" data-page={selected || "home"}
    onClick={event => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      const id = anchor?.getAttribute("href")?.slice(1);
      if (id && items.some(item => item.id === id)) { event.preventDefault(); open(id); }
    }} onInvalidCapture={event => {
      const target = event.target as HTMLElement;
      const pane = target.closest<HTMLElement>("[data-compact-pane]");
      if (pane && pane.hidden) { event.preventDefault(); open(pane.dataset.compactPane!); requestAnimationFrame(() => target.focus()); }
    }}>
    <header className="compact-page-header">
      {selected ? <button type="button" className="compact-back" onClick={() => open("")}>‹ <WorkspaceText text="Salon settings" /></button> : null}
      <div className="compact-title-row"><h1 className="compact-page-heading" tabIndex={-1}><WorkspaceText text={item?.label || "Salon settings"} /></h1><ContextualSupport /></div>
      {!selected ? <p className="compact-context">{name}</p> : null}
    </header>
    <nav hidden={!!selected} aria-label="Salon settings sections" className="compact-menu">
      {[...new Set(items.map(item => item.group))].map(group => <section key={group}><h2><WorkspaceText text={group} /></h2><div className="compact-list">{items.filter(item => item.group === group).map(item => <button key={item.id} type="button" className={item.danger ? "compact-danger" : ""} onClick={() => open(item.id)}><span><WorkspaceText text={item.label} /></span><span aria-hidden="true">›</span></button>)}</div></section>)}
      <a className="compact-all-link" href="/settings"><WorkspaceText text="All settings" /> ›</a>
    </nav>
    <div className="compact-page-content"><SettingsChildPages label={item?.label||"Salon settings"} resetKey={selected}>{children}</SettingsChildPages></div>
  </div></PageContext.Provider>;
}

export function CompactSettingsPane({ id, children }: { id: string; children: ReactNode }) {
  const { selected } = useContext(PageContext);
  return <div data-compact-pane={id} hidden={selected !== id}>{children}</div>;
}

export function CompactSaveBar({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const change = () => setDirty(true);
    const reset = () => setDirty(false);
    form.addEventListener("input", change);
    form.addEventListener("change", change);
    form.addEventListener("reset", reset);
    return () => { form.removeEventListener("input", change); form.removeEventListener("change", change); form.removeEventListener("reset", reset); };
  }, []);
  return <div ref={root} hidden={!dirty} data-settings-dirty={dirty} className="compact-save-bar settings-page-persistent">{children}</div>;
}
