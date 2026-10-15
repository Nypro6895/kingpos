"use client";
import { useEffect, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { issueServiceRelayPass } from "./actions";
export function CustomerRelayPass({ token, visitId }: { token: string; visitId: string }) {
  const [pass, setPass] = useState<{ passToken: string; queueNumber: number } | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { let alive = true; void issueServiceRelayPass(token, visitId).then(result => { if (alive && result.data) { setOrigin(location.origin); setPass(result.data); } }).catch(() => {}); return () => { alive = false; }; }, [token, visitId]);
  if (!pass) return null;
  return <section className="mx-auto mt-4 max-w-sm rounded-xl bg-white p-4 text-center text-zinc-950"><h2 className="text-xl font-semibold">Your check-in · #{pass.queueNumber}</h2><p>Scan to keep your check-in on your phone.</p><QrCodeTile valueToEncode={`${origin}/visit/${pass.passToken}`} ariaLabel="Your digital check-in" fallbackMessage="Ask the front desk for your check-in number." className="mx-auto h-36 w-36" /><p>POS will notify your staff automatically.</p></section>;
}
export function CustomerRelayEntry({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let alive = true; void fetch(`/api/service-relay/entry?token=${encodeURIComponent(token)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(result => { if (alive && result?.entry) setUrl(`${location.origin}/check-in/${result.entry}`); }).catch(() => {}); return () => { alive = false; }; }, [token]);
  if (!url) return null;
  return <section className="mx-auto mt-3 max-w-xs rounded-xl bg-white p-3 text-center text-zinc-950"><p>Check in on your phone</p><QrCodeTile valueToEncode={url} ariaLabel="Scan to check in on your phone" fallbackMessage="Use the check-in screen." className="mx-auto h-28 w-28" /></section>;
}
