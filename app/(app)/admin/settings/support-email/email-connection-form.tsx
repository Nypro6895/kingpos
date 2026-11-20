"use client";
import { useState } from "react";
import { AdminActionForm } from "../../_components/action-form";
import { saveSupportEmailSettingsAction } from "./actions";
import type { publicSupportEmailConfig } from "@/lib/support-email";

export function EmailConnectionForm({ email }: { email: ReturnType<typeof publicSupportEmailConfig> }) {
  const [provider, setProvider] = useState(email.provider);
  return <AdminActionForm action={saveSupportEmailSettingsAction} className="system-form" refreshOnSuccess={false}>
    <label className="system-field"><span>Email service</span><select name="provider" value={provider} onChange={event => setProvider(event.target.value as "smtp" | "resend")}><option value="resend">Resend</option><option value="smtp">SMTP / Hostinger</option></select></label>
    <label className="system-field"><span>Sender email</span><input type="email" name="from" defaultValue={email.from} required /></label>
    <label className="system-field"><span>Reply-to email</span><input type="email" name="reply_to" defaultValue={email.replyTo} required /></label>
    {provider === "smtp" ? <>
      <label className="system-field"><span>SMTP server</span><input name="smtp_host" defaultValue={email.smtpHost} required autoCapitalize="none" /></label>
      <label className="system-field"><span>Encrypted SMTP port</span><select name="smtp_port" defaultValue={email.smtpPort}><option value="465">465 · SSL/TLS</option><option value="587">587 · STARTTLS</option></select></label>
      <label className="system-field"><span>SMTP username</span><input name="smtp_username" defaultValue={email.smtpUsername} required autoCapitalize="none" autoComplete="off" /></label>
      <label className="system-field"><span>SMTP password</span><input type="password" name="smtp_password" autoComplete="new-password" placeholder={email.provider === "smtp" && email.keyConfigured ? "Configured — leave blank to keep" : "Mailbox password"} /></label>
      <p className="system-note">For Hostinger, use the same mailbox for Sender email and SMTP username. Replies go to the Reply-to mailbox. SMTP login verification does not confirm inbox delivery.</p>
    </> : <label className="system-field"><span>Resend API key</span><input type="password" name="api_key" autoComplete="new-password" placeholder={email.provider === "resend" && email.keyConfigured ? "Configured — leave blank to keep" : "Resend API key"} /></label>}
    <label className="system-field"><span>Enable direct email</span><input type="checkbox" name="enabled" defaultChecked={email.enabled && email.keyConfigured} /></label>
    <label className="system-field"><span>Also use this connection for staff invitations and booking emails</span><input type="checkbox" name="use_for_notifications" defaultChecked={email.useForNotifications} /></label>
    <p className="system-note">Supabase authentication email is configured separately. Incoming email replies are read in your mailbox; they are not automatically added to support conversations.</p>
    <div className="system-actions"><button className="system-primary" name="intent" value="save">Save email</button><button name="intent" value="test">Check connection</button></div>
  </AdminActionForm>;
}
