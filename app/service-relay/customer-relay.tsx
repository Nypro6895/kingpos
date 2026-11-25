"use client";
import { useEffect, useState } from "react";
import { QrCodeTile } from "@/components/qr-code-tile";
import { issueServiceRelayPass } from "./actions";
import { browserPublicOrigin } from "@/lib/browser-public-origin";
import { usePairedCustomerActions } from "@/app/pos/customer-display/paired-customer-actions-context";
export function CustomerRelayPass({ token, visitId }: { token: string; visitId: string }) {
  const paired = usePairedCustomerActions();
  const [pass, setPass] = useState<{ passToken: string; queueNumber: number } | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => { let alive = true; const result = paired ? paired.command<{data?:{passToken:string;queueNumber:number};error?:string}>("relay.pass",{visitId}) : issueServiceRelayPass(token, visitId); void result.then(result => { if (alive && result.data) { setOrigin(browserPublicOrigin()); setPass(result.data); } }).catch(() => {}); return () => { alive = false; }; }, [token, visitId, paired]);
  if (!pass) return null;
  return <section className="mx-auto mt-4 max-w-sm rounded-xl bg-white p-4 text-center text-zinc-950"><h2 className="text-xl font-semibold">Your check-in · #{pass.queueNumber}</h2><p>Scan to keep your check-in on your phone.</p><QrCodeTile valueToEncode={`${origin}/visit/${pass.passToken}`} ariaLabel="Your digital check-in" fallbackMessage="Ask the front desk for your check-in number." className="mx-auto h-36 w-36" /><p>POS will notify your staff automatically.</p></section>;
}
export { CustomerRelayEntry } from "./customer-entry-qr";
