"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const CampaignPluginContext = createContext(false);
const ConfigurationContext = createContext<{ apply: (scope: string, installed: boolean) => void } | null>(null);

export function CampaignPluginProvider({ installed, scope = "", children }: { installed: boolean; scope?: string; children: ReactNode }) {
  const [configuration, setConfiguration] = useState<{ scope: string; initialInstalled: boolean; installed: boolean } | null>(null);
  const apply = useCallback((nextScope: string, nextInstalled: boolean) => {
    if (nextScope !== scope) return;
    setConfiguration(previous => previous?.scope === scope && previous.initialInstalled === installed && previous.installed === nextInstalled ? previous : { scope, initialInstalled: installed, installed: nextInstalled });
  }, [scope, installed]);
  const update = useMemo(() => ({ apply }), [apply]);
  const enabled = configuration?.scope === scope && configuration.initialInstalled === installed ? configuration.installed : installed;
  return <ConfigurationContext value={update}><CampaignPluginContext value={enabled}>{children}</CampaignPluginContext></ConfigurationContext>;
}

/** A streamed optional wallet updates only the matching, already authorized shell. */
export function CampaignPluginConfiguration({ scope, installed }: { scope: string; installed: boolean }) {
  const configuration = useContext(ConfigurationContext);
  useEffect(() => { configuration?.apply(scope, installed); }, [configuration, scope, installed]);
  return null;
}

export function useCampaignPlugin() { return useContext(CampaignPluginContext); }
