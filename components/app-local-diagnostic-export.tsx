"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { translateHelp, type HelpLanguage } from "@/lib/help-language";
import styles from "@/app/help/help.module.css";

// The native capability is installed before the bundled app starts; no polling.
const subscribe = () => () => {};
const unavailableOnServer = () => false;
const canExport = () => typeof window !== "undefined" && typeof window.__reylumiExportDiagnostics === "function";

export function AppLocalDiagnosticExport({ language }: { language: HelpLanguage }) {
  const supported = useSyncExternalStore(subscribe, canExport, unavailableOnServer);
  const pending = useRef(false);
  const [state, setState] = useState<"idle" | "opening" | "opened" | "error">("idle");
  const t = (text: string) => translateHelp(text, language);
  async function save() {
    if (pending.current) return;
    const exportReport = window.__reylumiExportDiagnostics;
    if (typeof exportReport !== "function") return;
    pending.current = true;
    setState("opening");
    try {
      await exportReport();
      // The current bridge returns void. Saving/cancellation belongs to its
      // native sheet; this UI cannot claim that the user saved a file.
      setState("opened");
    } catch {
      setState("error");
    } finally {
      pending.current = false;
    }
  }
  if (!supported) return null;
  return <section className={styles.section}>
    <button type="button" className={styles.reset} disabled={state === "opening"} aria-busy={state === "opening"} onClick={() => { void save(); }}>
      {t(state === "opening" ? "Opening save options…" : "Save diagnostic report")}
    </button>
    {state === "opened" && <p role="status">{t("Choose where to save the report.")}</p>}
    {state === "error" && <p role="alert">{t("Could not open the diagnostic report. Try again.")}</p>}
  </section>;
}
