"use client";
import Link from "next/link";
import { LogoutButton } from "@/app/account/logout-button";
import { useState } from "react";
import { acceptTaxInvitation } from "./flow-actions";
import { TaxProfileForm } from "./tax-entry";
import type { TaxProfile } from "@/types/tax-workspace";
export function TaxInvitation({ token, salonName, active, profile, name, email }: {
    token: string;
    salonName: string;
    active: boolean;
    profile: TaxProfile | null;
    name: string;
    email: string;
}) {
    const [ready, setReady] = useState(Boolean(profile)), [busy, setBusy] = useState(false), [error, setError] = useState("");
    async function accept() { setBusy(true); setError(""); let result;
        try { result = await acceptTaxInvitation(token); } catch {setError("Connection could not be checked. Try again.");setBusy(false);return;} if (result.ok)
        window.location.assign(`/tax/${result.salonId}`);
    else {
        setError(result.error);
        setBusy(false);
    } }
    return <main className="tax-auth"><span className="tax-brand">ReyLUMI <span>Tax</span></span><h1>Invitation from {salonName}</h1><p>Signed in as {email || name}. The owner is inviting this account to work with their shared tax information and documents.</p>
 {!active && <p role="status">The salon needs to renew Tax Company access. You can activate your Tax profile now, then return to this link after renewal.</p>}
 {!ready ? <><h2>Activate your Tax profile</h2><TaxProfileForm profile={null} name={name} email={email} onSaved={() => { setReady(true); if (active)
        void accept(); }} submitLabel={active ? `Activate Tax & connect ${salonName}` : "Activate Tax profile"}/></> : <button className="tax-primary" disabled={busy || !active} onClick={accept}>{busy ? "Connecting…" : `Connect ${salonName}`}</button>}
 {error && <p role="alert">{error}</p>}<p><LogoutButton returnHref={`/tax/login?next=${encodeURIComponent(`/tax/invite/${token}`)}`}>Use another account</LogoutButton> · <Link href="/tax">My Tax workspace</Link></p>
 </main>;
}
