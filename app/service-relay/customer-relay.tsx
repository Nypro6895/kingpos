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
  useEffect(() => {
    let alive = true, running = false;
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try { const response = await fetch(`/api/service-relay/entry?token=${encodeURIComponent(token)}`, { cache: "no-store" }); if (!response.ok) return; const result = await response.json(); if (alive) setUrl(result?.entry ? `${browserPublicOrigin()}/check-in/${result.entry}` : ""); }
      catch { /* Existing QR remains server-validated during a transient disconnect. */ }
      finally { running = false; }
    }
    void refresh(); const timer = setInterval(refresh, 60000); document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [token]);
  if (!url) return null;
  return <section className="mx-auto mt-3 max-w-xs rounded-xl bg-white p-3 text-center text-zinc-950"><p>Check in on your phone</p><QrCodeTile valueToEncode={url} ariaLabel="Scan to check in on your phone" fallbackMessage="Use the check-in screen." className="mx-auto h-28 w-28" /></section>;
}
