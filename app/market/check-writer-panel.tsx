"use client";
import Link from "next/link";
import { useState } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { manageCheckWriterSubscription } from "./check-writer-actions";
import { openMarketPayment } from "@/lib/open-market-payment";
import { CHECK_WRITER_PRINTING_AVAILABLE, CHECK_WRITER_UNAVAILABLE_MESSAGE } from "@/lib/check-writer-availability";
export function CheckWriterPanel({
  state,
}: {
  state: {
    active: boolean;
    subscribed: boolean;
    installed?: boolean;
    operationalReady?: boolean;
    trialReady?: boolean;
  };
}) {
  const t = useWorkspaceTranslation(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section>
      <p>{t("Created by Reylumi")}</p>
      <p>{t("$4.90 / month · Per salon")}</p>
      {!CHECK_WRITER_PRINTING_AVAILABLE && (
        <p role="status">{t(CHECK_WRITER_UNAVAILABLE_MESSAGE)}</p>
      )}
      {CHECK_WRITER_PRINTING_AVAILABLE && state.operationalReady === false && !state.trialReady && (
        <p>{t("Check Writer is being configured. Please try again later.")}</p>
      )}
      {CHECK_WRITER_PRINTING_AVAILABLE && state.trialReady && state.operationalReady === false && <p>{t("Free trial available. Paid purchases are being prepared.")}</p>}
      <p>
        {t(
          !CHECK_WRITER_PRINTING_AVAILABLE
            ? "Existing check history is still available."
            : state.active
            ? "Check Writer is active for this salon."
            : "Start the free trial or activate paid access to create payroll and standalone checks.",
        )}
      </p>
      {(state.active || state.installed) && (
        <Link
          className="inline-flex min-h-11 items-center rounded-lg bg-teal-700 px-4 text-white"
          href="/check-writer"
        >
          {t(CHECK_WRITER_PRINTING_AVAILABLE ? "Open Check Writer" : "View check history")}
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
