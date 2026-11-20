"use client";
import Link from "next/link";
import type {AppLocalPayrollTaxSettingsData} from "@/lib/app-local-payroll-tax-metadata";
import { updateTaxSettings } from "@/app/tax-company/actions";
import { OwnerTaxCredentials } from "@/app/tax-company/owner-credentials";
import styles from "@/app/tax-company/tax-company.module.css";
import { SubmitButton } from "@/components/submit-button";

export function AppLocalPayrollTaxSettings({state,query}:{state:AppLocalPayrollTaxSettingsData;query:{message?:string}}){
  return <main className={`${styles.page} ${styles.settings}`}>
    <header><Link href="/payroll" className={styles.back}>← Payroll</Link><div className={styles.header}><div><p className={styles.eyebrow}>{state.salon_name}</p><h1>Tax Company settings</h1><p className={styles.muted}>Manage who can access your salon’s tax payroll and upload paystubs.</p></div><span className={state.active && state.enabled ? styles.badge : styles.inactive}>{state.active && state.enabled ? "Sharing enabled" : state.active ? "Ready to connect" : "Plugin inactive"}</span></div></header>
    {query.message && <p role="status" className={styles.notice}>{query.message}</p>}
    {!state.active && <p className={styles.notice}>Activate Tax Company in <Link href="/market" className="underline">Market</Link> to set up access for your tax company.</p>}
    <div className={styles.settingsGrid}>
      <div className={styles.stack}>
        <section className={styles.panel}><div className={styles.panelHead}><h2>Salon login</h2><span className={styles.muted}>ID & password</span></div><OwnerTaxCredentials loginId={state.login_id} active={state.active} enabled={state.enabled} /></section>
        <section className={styles.panel}><div className={styles.panelHead}><h2>People with tax access</h2><span className={styles.muted}>{state.connections.length} connected</span></div>
          {state.connections.length ? state.connections.map(connection => {
            const name = connection.display_name || connection.email || connection.phone || "Reylumi account";
            const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
            return <div key={connection.user_id} className={styles.accountRow}><span className={styles.avatar} aria-hidden="true">{initials}</span><div className={styles.accountInfo}><strong>{name}</strong><p>{connection.email || connection.phone || `Account ${connection.user_id}`}</p><p className={styles.muted}>Connected {new Date(connection.connected_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p></div><span className={connection.account_active && state.active && state.enabled ? styles.badge : styles.inactive}>{connection.account_active && state.active && state.enabled ? "Can manage tax" : "Access inactive"}</span></div>;
          }) : <p className={styles.empty}>No tax professional is connected yet. Share your salon login with your tax company to get started.</p>}
          {state.enabled && <div className={styles.foot}><p className={styles.help}>Disconnect to stop tax company access. Your salon and staff keep their uploaded paystubs.</p><form action={updateTaxSettings}><input type="hidden" name="disconnect" value="true" /><SubmitButton className={styles.danger} pendingLabel="Disconnecting…">Disconnect all accounts</SubmitButton></form></div>}
        </section>
      </div>
      <aside className={styles.stack}>
        <section className={styles.panel}><div className={styles.panelHead}><h2>Connect your tax company</h2></div><div className={styles.panelBody}><ol className={styles.appSteps}><li>Create your salon password.</li><li>Share the salon ID, password and app link with your tax company.</li><li>They sign in with their personal account and add your salon.</li></ol><Link href="/tax-company/install" className={styles.button}>Download / install app ↗</Link><Link href="/tax-company" className={styles.button}>Open Tax Company app ↗</Link></div></section>
        <section className={styles.panel}><div className={styles.panelHead}><h2>Payroll & paystubs</h2></div><div className={styles.panelBody}><p className={styles.help}>Review the payroll shared with your tax company and the paystubs they upload.</p><Link href="/payroll/tax-company?report=1" className={styles.button}>View tax report →</Link></div></section>
      </aside>
    </div>
  </main>;
}
