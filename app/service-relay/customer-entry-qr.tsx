"use client";
import { useEffect, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { customerEntryLink } from "@/lib/customer-entry-link";

export function CustomerRelayEntry({ token }: { token: string }) {
  const t = useWorkspaceTranslation();
  const [entry, setEntry] = useState<{ token: string; url: string; at: number } | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!token) return;
    let alive = true, running = false;
    const controller = new AbortController();
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      const requestedAt = Date.now();
      setNow(requestedAt);
      try {
        const response = await fetch(`/api/service-relay/entry?token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        if (!response.ok) return;
        const result = await response.json();
        const url = customerEntryLink(result?.entry);
        if (alive) setEntry(url ? { token, url, at: requestedAt } : null);
      } catch { /* Preserve only a recently refreshed entry during a brief disconnect. */ }
      finally { running = false; }
    }
    void refresh();
    const timer = setInterval(() => { setNow(Date.now()); void refresh(); }, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [token]);
  const url = entry?.token === token && now - entry.at < 90000 ? entry.url : "";
  return <section className="customer-entry-card" aria-label={t("Check in with your app")}>
    <h2><WorkspaceText text="Check in with your app" /></h2>
    {url && <p><WorkspaceText text="Scan with your phone" /></p>}
    {url ? <QrCodeTile valueToEncode={url} ariaLabel={t("Scan to check in with your app")} fallbackMessage={t("Use the phone keypad to check in.")} className="customer-entry-qr" />
      : <div className="customer-entry-fallback" role="status"><WorkspaceText text="Use the phone keypad to check in." /></div>}
    {url && <p><WorkspaceText text="Or enter your phone number here" /></p>}
  </section>;
}
