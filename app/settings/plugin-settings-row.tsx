"use client";
import { useTransientOverlay } from "@/components/overlay-dismissal";

import { marketTargetHref } from "@/lib/market-target-url";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./booking-deposit-settings.module.css";
import rowStyles from "./plugin-settings-row.module.css";
import { PluginActivationDialog } from "./plugin-activation-dialog";

export function PluginActivationPrompt({ pluginName, label = pluginName, salonId }: { pluginName: string; label?: string; salonId?: string }) {
  return <PluginSettingsRow label={label} pluginName={pluginName} marketHref={marketTargetHref(`/market?q=${encodeURIComponent(pluginName)}`, salonId)} installed={false} enabled={false} onToggle={() => {}} />;
}

export function PluginActivationButton({ pluginName, label, buttonLabel = "Activate", salonId }: { pluginName: string; label: string; buttonLabel?: string; salonId?: string }) {
  const t = useWorkspaceTranslation();
  const [activation, setActivation] = useState(false);
  useTransientOverlay(() => setActivation(false), activation);
  return <section className={styles.panel} aria-label={t(label)}>
    <div className={styles.header}><span className={styles.title}>{t(label)}</span><button type="button" className={styles.save} onClick={() => setActivation(true)}>{t(buttonLabel)}</button></div>
    <PluginActivationDialog open={activation} onClose={() => setActivation(false)} pluginName={pluginName} marketHref={marketTargetHref(`/market?q=${encodeURIComponent(pluginName)}`, salonId)} />
  </section>;
}

export function PluginMarketStatus({ pluginName, label = pluginName, active, settingsHref, children, salonId }: { pluginName: string; label?: string; active: boolean; settingsHref?: string; children?: ReactNode; salonId?: string }) {
  const t = useWorkspaceTranslation();
  if (!active) return pluginName === "Payroll Data Download"
    ? <PluginActivationButton salonId={salonId} pluginName={pluginName} label={label} buttonLabel="Download" />
    : <PluginActivationPrompt salonId={salonId} pluginName={pluginName} label={label} />;
  return <section className={styles.panel} aria-label={pluginName}>
    <div className={styles.header}><span className={styles.title}>{t(label)}</span><span className={rowStyles.active}>{t("Active")}</span>
      <span className={rowStyles.links}>
        {settingsHref && <Link href={marketTargetHref(settingsHref, salonId)} prefetch={false}>{t(pluginName === "Payroll Data Download" ? "Download" : "Open")}</Link>}
      </span>
    </div>
    {children}
  </section>;
}

export function PluginSettingsRow({ label, pluginName, marketHref, installed, enabled, canEnable = true, disabled = false, saving = false, onToggle, onSave, message, children }: {
  label: string; pluginName: string; marketHref: string; installed: boolean; enabled: boolean;
  canEnable?: boolean; disabled?: boolean; saving?: boolean;
  onToggle: (enabled: boolean) => void; onSave?: () => void; message?: string; children?: ReactNode;
}) {
  const t = useWorkspaceTranslation();
  const [activation, setActivation] = useState(false);
  useTransientOverlay(() => setActivation(false), activation);
  return <section className={`${styles.panel} settings-child-action-scope`} aria-label={t(label)} aria-busy={disabled || saving}>
    <div className={styles.header}>
      <span className={styles.title}>{t(label)}</span>
      <button type="button" role="switch" aria-label={t(label)} aria-checked={enabled} className={styles.toggle} disabled={disabled || saving} onClick={() => {
        if (!enabled && (!installed || !canEnable)) { setActivation(true); return; }
        setActivation(false); onToggle(!enabled);
      }}><span className={`${styles.track} settings-switch-track`} aria-hidden="true"><span className={`${styles.thumb} settings-switch-thumb`} /></span><span aria-hidden="true">{t(enabled ? "On" : "Off")}</span></button>
      {installed && onSave && <button type="button" className={`${styles.save} settings-child-shared-action`} disabled={disabled || saving} onClick={onSave}>{t(saving ? "Saving…" : "Save")}</button>}
    </div>
    <PluginActivationDialog open={activation} onClose={() => setActivation(false)} pluginName={pluginName} marketHref={marketHref} />
    {installed && children}
    {message && <p className={`${styles.message} settings-child-shared-action`} role="status">{t(message)}</p>}
  </section>;
}
