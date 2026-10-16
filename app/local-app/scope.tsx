"use client";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAppLocalHost } from "@/lib/app-local-host";
import type { ExperienceContext } from "@/lib/experience-context";
import { OfflineNetworkFormGuard } from "@/components/offline-network-form-guard";
type Value = { context: ExperienceContext; validate(force?: boolean): Promise<boolean>; checkedAt(): number; validationRevision: number; getValidationRevision(): number; connectionState: "idle"; retryConnection(): Promise<boolean> };
const Context = createContext<Value | null>(null);
export function ExperienceScopeProvider({ context, children, guardForms = true }: { context: ExperienceContext; children: ReactNode; guardForms?: boolean }) {
  const checked = useRef(0), revision = useRef(0), [validationRevision, setValidationRevision] = useState(0);
  const active = useRef({ scope: context.scope, epoch: 0, mounted: false });
  useLayoutEffect(() => {
    active.current = { scope: context.scope, epoch: active.current.epoch + 1, mounted: true }; checked.current = 0;
    return () => { active.current.mounted = false; active.current.epoch++; };
  }, [context.scope]);
  const validate = useCallback(async () => {
    const started = active.current.epoch, path = location.pathname + location.search;
    if (!active.current.mounted || active.current.scope !== context.scope) return false;
    try { const value = await getAppLocalHost().context(path); const valid = active.current.mounted && active.current.epoch === started && active.current.scope === context.scope && location.pathname + location.search === path && !value.offline && value.context.scope === context.scope; if (valid) { checked.current = value.onlineValidatedAt; revision.current++; setValidationRevision(revision.current); } return valid; } catch { return false; }
  }, [context.scope]);
  const value = useMemo<Value>(() => ({ context, validate, checkedAt: () => checked.current, validationRevision, getValidationRevision: () => revision.current, connectionState: "idle", retryConnection: validate }), [context, validate, validationRevision]);
  return <Context.Provider value={value}>{guardForms ? <OfflineNetworkFormGuard key={context.scope}/> : null}{children}</Context.Provider>;
}
export function useExperienceScope() { return useContext(Context); }
