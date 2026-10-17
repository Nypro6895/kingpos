"use client";

import { useEffect, useState } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { loadPluginMarketStatusAction } from "./plugin-market-status-actions";
import { PluginMarketStatus } from "./plugin-settings-row";

export function PluginMarketSettings({ salonId, group }: { salonId: string; group: "salon" | "pos" | "payroll" }) {
  const t = useWorkspaceTranslation();
  const [result, setResult] = useState<Awaited<ReturnType<typeof loadPluginMarketStatusAction>> | null>(null);
  useEffect(() => {
    let current = true;
    loadPluginMarketStatusAction(salonId, group).then(value => { if (current) setResult(value); }).catch(() => { if (current) setResult({ error: "Plugin settings could not load." }); });
    return () => { current = false; };
  }, [salonId, group]);
  if (!result || result.error) return <p role="status" className="text-sm">{t(result?.error ?? "Loading…")}</p>;
  return <>{result.rows?.map(row => row.error ? <p role="status" key={row.name} className="text-sm">{t(row.label)}: {t(row.error)}</p> : <PluginMarketStatus key={row.name} pluginName={row.name} label={row.label} active={row.active} settingsHref={row.settingsHref} />)}</>;
}
