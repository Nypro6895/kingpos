"use client";
import { useState } from "react";
import { updateTaxSettings } from "./actions";
import styles from "./tax-company.module.css";

export function OwnerTaxCredentials({ loginId, active, enabled }: { loginId: string | null; active: boolean; enabled: boolean }) {
  const [editing, setEditing] = useState(!loginId || !enabled);
  const [copied, setCopied] = useState("");
  return <div className={styles.panelBody}>
    <p className={styles.help}>Share this salon ID and password with your tax company so they can connect your salon.</p>
    {loginId && <div className={styles.label}><label htmlFor="tax-salon-id">Salon ID</label><div className={styles.idRow}><input id="tax-salon-id" className={styles.input} readOnly value={loginId} /><button className={styles.button} type="button" onClick={async () => { try { await navigator.clipboard.writeText(loginId); setCopied("Copied"); } catch { setCopied("Select the ID above to copy it."); } }}>Copy</button></div>{copied && <span className={styles.muted} role="status">{copied}</span>}</div>}
    {loginId && !editing && <div className={styles.actions}><span className={styles.muted}>Password is set</span><button className={styles.button} disabled={!active} onClick={() => setEditing(true)}>Change password</button></div>}
    {editing && <form action={updateTaxSettings} className={styles.passwordForm}><label className={styles.label}>{loginId ? "New password" : "Create password"}<input className={styles.input} name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required disabled={!active} placeholder="At least 12 characters" /></label><p className={styles.help}>{loginId ? "Saving a new password signs out everyone currently connected. Share the new password to reconnect." : "Your salon ID is created when you save. Keep a copy of the password to share with your tax company."}</p><div className={styles.actions}><button disabled={!active} className={styles.primary}>{loginId ? "Save new password" : "Create salon credentials"}</button>{loginId && enabled && <button type="button" className={styles.button} onClick={() => setEditing(false)}>Cancel</button>}</div></form>}
  </div>;
}
