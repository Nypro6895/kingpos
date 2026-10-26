"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { confirmBookingDepositCheckoutAction } from "./booking-deposit-purchase-actions";
import styles from "./booking-deposit-product.module.css";

export function BookingDepositPaymentReturn({ salonId }: { salonId: string }) {
  const t = useWorkspaceTranslation(), router = useRouter();
  const [attempt, setAttempt] = useState(0), [message, setMessage] = useState(""), [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let active = true, count = 0, inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const result = await confirmBookingDepositCheckoutAction(salonId);
        if (!active) return;
        if (result.path) {
          window.dispatchEvent(new Event("reylumi:market-changed"));
          router.replace(result.path);
          router.refresh();
          return;
        }
        if (++count < 6) timer = setTimeout(check, 3000);
        else { setWaiting(false); setMessage(result.error || "Payment is still being confirmed. Check again in a moment."); }
      } catch {
        if (active) { setWaiting(false); setMessage("Payment is still being confirmed. Check again in a moment."); }
      } finally { inFlight = false; }
    }
    function foreground() {
      if (document.visibilityState === "hidden" || !active || inFlight) return;
      clearTimeout(timer); count = 0; setWaiting(true); setMessage(""); void check();
    }
    void check();
    window.addEventListener("focus", foreground);
    window.addEventListener("reylumi:foreground", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => { active = false; clearTimeout(timer); window.removeEventListener("focus", foreground); window.removeEventListener("reylumi:foreground", foreground); document.removeEventListener("visibilitychange", foreground); };
  }, [salonId, attempt, router]);
  return <main className={styles.settingsPage}>
    <h1>Booking Deposit</h1>
    <p className={styles.settingsIntro} role="status" aria-live="polite">{t(waiting ? "Confirming your payment…" : message)}</p>
    {!waiting && <button className={styles.primary} type="button" onClick={() => { setWaiting(true); setMessage(""); setAttempt(value => value + 1); }}>{t("Check again")}</button>}
    <Link className={styles.back} href="/market/booking-deposit">← {t("Back to plugin")}</Link>
  </main>;
}
