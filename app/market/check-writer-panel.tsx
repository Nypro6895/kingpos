"use client";
import Link from "next/link";
import { useState } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { manageCheckWriterSubscription } from "./check-writer-actions";
import { openMarketPayment } from "@/lib/open-market-payment";
export function CheckWriterPanel({
  state,
}: {
  state: {
    active: boolean;
    subscribed: boolean;
    installed?: boolean;
    operationalReady?: boolean;
  };
}) {
  const t = useWorkspaceTranslation(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section>
      <p>{t("Created by Reylumi")}</p>
      <p>{t("$4.90 / month · Per salon")}</p>
      {state.operationalReady === false && (
        <p>{t("Check Writer is being configured. Please try again later.")}</p>
      )}
      <p>
        {t(
          state.active
            ? "Check Writer is active for this salon."
            : "Activate paid access to create payroll and standalone checks.",
        )}
      </p>
      {(state.active || state.installed) && (
        <Link
          className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-white"
          href="/check-writer"
        >
          {t("Open Check Writer")}
        </Link>
      )}
      {state.subscribed && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await manageCheckWriterSubscription();
              if (result.url) openMarketPayment(result.url);
              else
                setMessage(
                  result.error ?? "Subscription management is unavailable.",
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Manage subscription")}
        </button>
      )}
      <p role="status">{t(message)}</p>
    </section>
  );
}
