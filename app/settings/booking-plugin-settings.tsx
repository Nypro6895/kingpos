"use client";

import { useEffect, useState, useTransition } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { BOOKING_POLICY_TEMPLATE, type BookingPolicyState } from "@/types/booking-policy";
import type { BookSmsState } from "@/types/booksms";
import { PluginSettingsRow } from "./plugin-settings-row";
import { loadBookingRulesSettingsAction, saveBookingRulesSettingsAction, loadBookSmsSettingsAction, saveBookSmsSettingsAction } from "./plugin-settings-actions";
import styles from "./booking-plugin-settings.module.css";

function usePluginSettings<T>(salonId: string, load: (salon: string) => Promise<{ state?: T; error?: string }>) {
  const [state, setState] = useState<T | null>(null);
  const [message, setMessage] = useState("Loading…");
  useEffect(() => {
    let current = true;
    load(salonId).then(result => {
      if (!current) return;
      if (result.state) { setState(result.state); setMessage(""); }
      else setMessage(result.error ?? "Settings could not load.");
    }).catch(() => { if (current) setMessage("Settings could not load."); });
    return () => { current = false; };
  }, [salonId, load]);
  return { state, setState, message, setMessage };
}

export function BookingRulesSettings({ salonId }: { salonId: string }) {
  const t = useWorkspaceTranslation();
  const { state, setState, message, setMessage } = usePluginSettings<BookingPolicyState>(salonId, loadBookingRulesSettingsAction);
  const [busy, start] = useTransition();
  function update(values: Partial<BookingPolicyState>) { if (state) { setState({ ...state, ...values }); setMessage(""); } }
  return <PluginSettingsRow label="Show booking rules" pluginName="Booking Rules" marketHref="/market?q=Booking%20Rules" installed={Boolean(state?.active || state?.subscribed)} enabled={Boolean((state?.active || state?.subscribed) && state.published)} canEnable={Boolean(state?.active)} disabled={!state} saving={busy} onToggle={published => update({ published })} message={message} onSave={() => {
    if (!state) return;
    start(async () => {
      setMessage("");
      const result = await saveBookingRulesSettingsAction(salonId, state.content, state.published);
      if (result.state) setState(result.state);
      setMessage(result.error ?? "Saved.");
    });
  }}>
    <details className={styles.editor}><summary>{t("Edit booking rules")}</summary>
      <label>{t("Booking rules")}<textarea aria-label={t("Booking rules")} value={state?.content ?? ""} maxLength={6000} rows={4} disabled={busy} onChange={event => update({ content: event.target.value })} /></label>
      <button type="button" disabled={busy} onClick={() => update({ content: BOOKING_POLICY_TEMPLATE })}>{t("Use suggested rules")}</button>
    </details>
  </PluginSettingsRow>;
}

export function BookSmsSettings({ salonId }: { salonId: string }) {
  const t = useWorkspaceTranslation();
  const { state, setState, message, setMessage } = usePluginSettings<BookSmsState>(salonId, loadBookSmsSettingsAction);
  const [busy, start] = useTransition();
  function update(values: Partial<BookSmsState>) { if (state) { setState({ ...state, ...values }); setMessage(""); } }
  const ready = Boolean(state?.active && state.tokenConfigured && state.accountSid && (state.messagingServiceSid || state.from));
  return <PluginSettingsRow label="Send booking SMS" pluginName="BookSMS" marketHref="/market?q=BookSMS" installed={Boolean(state?.installed)} enabled={Boolean(state?.installed && state.enabled)} canEnable={ready} disabled={!state} saving={busy} onToggle={enabled => update({ enabled })} message={message} onSave={() => {
    if (!state) return;
    start(async () => {
      setMessage("");
      const result = await saveBookSmsSettingsAction(salonId, { enabled: state.enabled, confirmation: state.confirmation, reminders: state.reminders });
      if (result.state) setState(result.state);
      setMessage(result.error ?? "Saved.");
    });
  }}>
    <div className={styles.options}>
      <label><input type="checkbox" checked={Boolean(state?.confirmation)} disabled={busy || !state?.active} onChange={event => update({ confirmation: event.target.checked })} />{t("Confirmations & updates")}</label>
      <label><input type="checkbox" checked={Boolean(state?.reminders)} disabled={busy || !state?.active} onChange={event => update({ reminders: event.target.checked })} />{t("Reminders")}</label>
    </div>
  </PluginSettingsRow>;
}
