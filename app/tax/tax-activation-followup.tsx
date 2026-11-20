"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshTaxRenewal } from "./flow-actions";
import { taxOwnerReturnPath } from "@/lib/tax-flow";
import { taxActivationHref } from "@/lib/tax-activation";

export function TaxActivationFollowup({
  active,
  salonId,
  returnPath,
}: {
  active: boolean;
  salonId: string;
  returnPath?: string;
}) {
  const router = useRouter(),
    [attempt, setAttempt] = useState(0),
    [waiting, setWaiting] = useState(!active),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (active) return;
    let cancelled = false,
      count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      try {
        const result = await refreshTaxRenewal(salonId);
        if (cancelled) return;
        if (result.active && result.salonId === salonId) {
          const href = taxOwnerReturnPath(returnPath,salonId) ?? taxActivationHref(salonId);
          if (href) {
            router.replace(href);
            router.refresh();
            return;
          }
        }
        if (++count < 6) timer = setTimeout(check, 3000);
        else {
          setWaiting(false);
          setMessage(
            "Access is not confirmed yet. Check again in a moment; do not start another payment.",
          );
        }
      } catch {
        if (!cancelled) {
          setWaiting(false);
          setMessage(
            "Confirmation could not be checked. Try again; do not pay again.",
          );
        }
      }
    }
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, salonId, attempt, router, returnPath]);
  return (
    <section
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
      aria-label="Tax activation next step"
    >
      <h2 className="font-semibold">
        {active
          ? "Next: connect your tax professional"
          : "Confirming Tax Company access"}
      </h2>
      <p role="status">
        {active
          ? "Access is active for this salon. Create or update the connection ID and password below, then share them with your tax professional. You do not need a Tax professional profile to manage your own salon."
          : waiting
            ? "Checking confirmed payment. Connection setup opens only when access is active."
            : message}
      </p>
      {!active && !waiting && (
        <button
          type="button"
          className="rounded border px-3 py-2"
          onClick={() => {
            setWaiting(true);
            setMessage("");
            setAttempt((value) => value + 1);
          }}
        >
          Check again
        </button>
      )}
    </section>
  );
}
