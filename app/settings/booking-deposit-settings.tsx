"use client";

import { useEffect, useState, useTransition } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { loadBookingDepositAction, saveBookingDepositAction } from "@/app/market/booking-deposit-actions";
import type { BookingDepositState } from "@/types/booking-deposit";
import styles from "./booking-deposit-settings.module.css";
import { PluginActivationDialog } from "./plugin-activation-dialog";

export function BookingDepositSettings({ salonId }: { salonId: string }) {
  const t = useWorkspaceTranslation();
  const [state, setState] = useState<BookingDepositState | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showActivation, setShowActivation] = useState(false);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    loadBookingDepositAction(salonId).then(result => {
      if (!current) return;
      if (result.state) setState(result.state);
      else setMessage(result.error ?? "Settings could not load.");
      setLoading(false);
    });
    return () => { current = false; };
  }, [salonId]);

  function update(values: Partial<BookingDepositState>) {
    if (!state) return;
    setMessage("");
    setState({ ...state, ...values });
  }

  function toggle() {
    if (!state) return;
    if (!state.enabled && (!state.installed || !state.active || (!state.testMode && !state.connected))) {
      setShowActivation(true);
      setMessage("");
      return;
    }
    setShowActivation(false);
    setMessage("");
    setState({ ...state, enabled: !state.enabled });
  }

  function save() {
    if (!state?.installed) return;
    setMessage("");
    startTransition(async () => {
      const result = await saveBookingDepositAction(state, salonId);
      if (result.state) {
        setState(result.state);
        setMessage("Saved.");
      } else setMessage(result.error ?? "Could not save.");
    });
  }

  return (
    <section className={styles.panel} aria-label={t("Booking deposit settings")} aria-busy={loading || busy}>
      <div className={styles.header}>
        <span className={styles.title}>{t("Require deposit when booking")}</span>
        <button type="button" role="switch" aria-label={t("Require deposit when booking")} aria-checked={Boolean(state?.enabled)} className={styles.toggle} disabled={loading || busy || !state} onClick={toggle}>
          <span className={styles.track} aria-hidden="true"><span className={styles.thumb} /></span>
          <span aria-hidden="true">{t(state?.enabled ? "On" : "Off")}</span>
        </button>
        {state?.installed && <button type="button" className={styles.save} disabled={busy || loading} onClick={save}>{t(busy ? "Saving…" : "Save")}</button>}
      </div>
      <PluginActivationDialog open={showActivation} onClose={() => setShowActivation(false)} pluginName="Booking Deposit" marketHref="/market/booking-deposit" />
      {state?.installed && (
        <div className={`${styles.fields} ${state.mode === "full" ? styles.fullPrice : ""}`}>
          <label>{t("Deposit type")}
            <select value={state.mode} disabled={busy} onChange={event => update({ mode: event.target.value as BookingDepositState["mode"], value: event.target.value === "percent" ? Math.min(state.value, 100) : state.value })}>
              <option value="fixed">{t("Fixed")}</option>
              <option value="percent">{t("Percent")}</option>
              <option value="full">{t("Full service price")}</option>
            </select>
          </label>
          {state.mode !== "full" && <label>{t(state.mode === "percent" ? "Deposit (%)" : "Deposit ($)")}
            <input type="number" inputMode="decimal" min="0.01" max={state.mode === "percent" ? 100 : 999999} step="0.01" value={state.value} disabled={busy} onChange={event => update({ value: Number(event.target.value) })} />
          </label>}
          <label>{t("Checkout method")}
            <select value={state.checkout} disabled={busy} onChange={event => update({ checkout: event.target.value as BookingDepositState["checkout"] })}>
              <option value="both">{t("Customer chooses")}</option>
              <option value="embedded">{t("Card in booking")}</option>
              <option value="hosted">{t("Stripe checkout")}</option>
            </select>
          </label>
        </div>
      )}
      {(loading || message) && <p className={styles.message} role="status">{t(loading ? "Loading…" : message)}</p>}
    </section>
  );
}
