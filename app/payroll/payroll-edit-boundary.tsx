"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";

type Edits = { blocked: boolean; update: (key: string, blocked: boolean) => void };
const Context = createContext<Edits>({ blocked: false, update: () => {} });
export const usePayrollEdits = () => useContext(Context);

export function PayrollEditBoundary({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState(false);
  const translate = useWorkspaceTranslation();
  const update = useCallback((key: string, blocked: boolean) => setPending(current => {
    if (current.has(key) === blocked) return current;
    const next = new Set(current); if (blocked) next.add(key); else next.delete(key); return next;
  }), []);
  const blocked = pending.size > 0;
  const value = useMemo(() => ({ blocked, update }), [blocked, update]);
  useEffect(() => {
    if (!blocked) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    // Listen above the page so the app's global navigation is protected too.
    const guardNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("a[href]")) return;
      event.preventDefault(); event.stopPropagation(); setNotice(true);
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("click", guardNavigation, true);
    return () => { window.removeEventListener("beforeunload", guard); document.removeEventListener("click", guardNavigation, true); };
  }, [blocked]);
  return <Context.Provider value={value}><div
    onClickCapture={event => {
      if (blocked && event.target instanceof Element && event.target.closest("a[href]")) { event.preventDefault(); event.stopPropagation(); setNotice(true); }
    }}
    onSubmitCapture={event => {
      if (blocked && !(event.target instanceof HTMLFormElement && event.target.dataset.payrollAutosave)) { event.preventDefault(); event.stopPropagation(); setNotice(true); }
    }}>
    {notice && blocked && <p role="alert" className="mx-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{translate("Finish saving your edits before leaving or saving a statement.")}</p>}
    {children}
  </div></Context.Provider>;
}

export function PayrollOutputGuard({ children }: { children: ReactNode }) {
  const { blocked } = usePayrollEdits();
  return <><fieldset disabled={blocked} aria-busy={blocked} className="min-w-0 disabled:opacity-60">{children}</fieldset>{blocked && <p role="status" className="text-sm text-amber-800"><WorkspaceText text="Finish saving your edits before leaving or saving a statement." /></p>}</>;
}
