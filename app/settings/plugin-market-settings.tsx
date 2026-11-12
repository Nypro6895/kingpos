"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { loadPluginMarketStatusAction } from "./plugin-market-status-actions";
import { PluginMarketStatus } from "./plugin-settings-row";

export function PluginMarketSettings({
  salonId,
  group,
}: {
  salonId: string;
  group: "salon" | "pos" | "payroll";
}) {
  const t = useWorkspaceTranslation();
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof loadPluginMarketStatusAction>
  > | null>(null);
  useEffect(() => {
    let current = true;
    loadPluginMarketStatusAction(salonId, group)
      .then((value) => {
        if (current) setResult(value);
      })
      .catch(() => {
        if (current) setResult({ error: "Plugin settings could not load." });
      });
    return () => {
      current = false;
    };
  }, [salonId, group]);
  if (!result || result.error)
    return (
      <p role="status" className="text-sm">
        {t(result?.error ?? "Loading…")}
      </p>
    );
  return (
    <>
      {group === "pos" && (
        <p className="text-sm text-zinc-500">
          {t(
            "Scan is available through active Check-in Receipt access or Phone Checkin. Phone Checkin is activated separately.",
          )}
        </p>
      )}
      {result.rows?.map((row) =>
        row.error ? (
          <p role="status" key={row.name} className="text-sm">
            {t(row.label)}: {t(row.error)}
          </p>
        ) : row.name === "Tax Company" && !row.active ? (
          <section
            key={row.name}
            aria-label={row.label}
            className="rounded-lg border p-4"
          >
            <p>
              {t(row.label)} · {t("Paused")}
            </p>
            <Link
              href={
                "/payroll/tax-company/settings?" +
                new URLSearchParams({ salon: salonId, renew: "1" })
              }
            >
              {t("Review price & renew")}
            </Link>
          </section>
        ) : (
          <PluginMarketStatus
            salonId={salonId}
            key={row.name}
            pluginName={row.name}
            label={row.label}
            active={row.active}
            settingsHref={row.settingsHref}
          />
        ),
      )}
    </>
  );
}
