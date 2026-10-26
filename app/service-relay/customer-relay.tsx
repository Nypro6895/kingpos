"use client";
import { useEffect, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { issueServiceRelayPass } from "./actions";
import { browserPublicOrigin } from "@/lib/browser-public-origin";
export function CustomerRelayPass({ token, visitId }: { token: string; visitId: string }) {
  const [pass, setPass] = useState<{ passToken: string; queueNumber: number } | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { let alive = true; void issueServiceRelayPass(token, visitId).then(result => { if (alive && result.data) { setOrigin(browserPublicOrigin()); setPass(result.data); } }).catch(() => {}); return () => { alive = false; }; }, [token, visitId]);
  if (!pass) return null;
  return <section className="mx-auto mt-4 max-w-sm rounded-xl bg-white p-4 text-center text-zinc-950"><h2 className="text-xl font-semibold">Your check-in · #{pass.queueNumber}</h2><p>Scan to keep your check-in on your phone.</p><QrCodeTile valueToEncode={`${origin}/visit/${pass.passToken}`} ariaLabel="Your digital check-in" fallbackMessage="Ask the front desk for your check-in number." className="mx-auto h-36 w-36" /><p>POS will notify your staff automatically.</p></section>;
}
export function CustomerRelayEntry({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true, running = false;
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try { const response = await fetch(`/api/service-relay/entry?token=${encodeURIComponent(token)}`, { cache: "no-store" }); if (!response.ok) throw new Error("Entry unavailable"); const result = await response.json(); if (alive) { setUrl(result?.entry ? `${browserPublicOrigin()}/check-in/${result.entry}` : ""); setUnavailable(!result?.entry); } }
      catch { if (alive) setUnavailable(true); }
      finally { running = false; }
    }
    void refresh(); const timer = setInterval(refresh, 60000); document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [token]);
  return <section className="mx-auto w-full max-w-xs rounded-2xl bg-white p-4 text-center text-zinc-950" data-salon-checkin-qr>
    <p className="text-base font-semibold">Scan to check in on your phone</p>
    {url ? <QrCodeTile valueToEncode={url} ariaLabel="Scan to check in on your phone" fallbackMessage="Use the check-in screen." className="mx-auto mt-3 h-36 w-36" /> : <p role="status" className="mt-3 text-sm">{unavailable ? "Phone check-in is unavailable. Please use this screen." : "Preparing phone check-in…"}</p>}
  </section>;
}
