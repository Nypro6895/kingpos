"use client";
import { useState } from "react";
import { createTaxInvitation, revokeTaxInvitation } from "./flow-actions";
import { taxInvitePath } from "@/lib/tax-flow";
import { TAX_SIGN_IN_URL } from "@/lib/tax-activation";

export function TaxAccessLink({ salonId, canInvite = true }: { salonId?: string; canInvite?: boolean } = {}) {
  const [message, setMessage] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  async function copy(value: string, success: string) {
    try { await navigator.clipboard.writeText(value); setMessage(success); }
    catch { setMessage(`Select and copy this link: ${value}`); }
  }
  async function create() {
    setBusy(true); setMessage("");
    try {
      const result = await createTaxInvitation(salonId);
      if (result.ok) {
        setInvite("https://reylumi.com" + taxInvitePath(result.token));
        setMessage("Invitation ready. Expires " + new Date(result.expiresAt).toLocaleDateString() + ". Copy and send it to your tax professional.");
      } else setMessage(result.error);
    } catch { setMessage("Invitation could not be created. Try again."); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setMessage("");
    try {
      const result = await revokeTaxInvitation(salonId);
      if (result.ok) { setInvite(""); setMessage("Unused invitations revoked."); }
      else setMessage(result.error);
    } catch { setMessage("Invitation could not be revoked. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="grid gap-2" aria-label="Tax professional sign-in link">
    <p>Your tax professional uses their own Reylumi account. They can accept your invitation or connect with the salon ID and password.</p>
    <div className="flex flex-wrap items-center gap-3">
      <code>{TAX_SIGN_IN_URL}</code>
      <button type="button" className="rounded border px-3 py-2" onClick={() => copy(TAX_SIGN_IN_URL, "Sign-in link copied. Share it with your tax professional.")}>Copy sign-in link</button>
    </div>
    {salonId && <>
      <p>Create a salon invitation to let your professional register, activate Tax and connect without entering the salon password. A new link replaces any previous unused link.</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy || !canInvite} onClick={create}>Create invitation</button>
        <button disabled={busy} onClick={revoke}>Revoke unused invitation</button>
      </div>
      {!canInvite && <p>Activate salon access and enable sharing before creating an invitation.</p>}
    </>}
    {invite && <label>Invitation link
      <input readOnly value={invite} className="w-full rounded border p-2" />
      <button onClick={() => copy(invite, "Invitation copied.")}>Copy invitation</button>
    </label>}
    <p role="status">{message}</p>
  </section>;
}
