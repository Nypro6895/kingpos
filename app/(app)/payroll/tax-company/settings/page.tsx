import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { taxCompanySettings } from "@/lib/tax-company";
import { updateTaxSettings } from "@/app/tax-company/actions";
import { OwnerTaxCredentials } from "@/app/tax-company/owner-credentials";
import { PluginMarketStatus } from "@/app/settings/plugin-settings-row";
import styles from "@/app/tax-company/tax-company.module.css";
import { SubmitButton } from "@/components/submit-button";

async function TaxSettings({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const query = await searchParams;
  let state: Awaited<ReturnType<typeof taxCompanySettings>>;
  try { state = await taxCompanySettings(); } catch (error) { return <main className={styles.page}><p role="alert" className={styles.notice}>{error instanceof Error ? error.message : "Settings unavailable."}</p><Link href="/market">Open Market</Link></main>; }
  return <main className={`${styles.page} ${styles.settings}`}>
    <header><Link href="/payroll" className={styles.back}>← Payroll</Link><div className={styles.header}><div><p className={styles.eyebrow}>{state.salon_name}</p><h1>Tax Company settings</h1></div><span className={state.active && state.enabled ? styles.badge : styles.inactive}>{state.active && state.enabled ? "Sharing enabled" : state.active ? "Ready to connect" : "Plugin inactive"}</span></div></header>
    {query.message && <p role="status" className={styles.notice}>{query.message}</p>}
    <PluginMarketStatus pluginName="Tax Company" label="Connect your tax company" active={state.active} />
    <div className={styles.stack}>
        {state.active && <details className={styles.panel} open={!state.login_id || !state.enabled}><summary className={styles.panelHead}>Salon login · ID & password</summary><OwnerTaxCredentials loginId={state.login_id} active={state.active} enabled={state.enabled} /></details>}
        {(state.active || state.enabled || state.connections.length > 0) && <details className={styles.panel}><summary className={styles.panelHead}>People with tax access · {state.connections.length}</summary>
          {state.connections.length ? state.connections.map(connection => {
            const name = connection.display_name || connection.email || connection.phone || "Reylumi account";
            const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
            return <div key={connection.user_id} className={styles.accountRow}><span className={styles.avatar} aria-hidden="true">{initials}</span><div className={styles.accountInfo}><strong>{name}</strong><p>{connection.email || connection.phone || `Account ${connection.user_id}`}</p><p className={styles.muted}>Connected {new Date(connection.connected_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</p></div><span className={connection.account_active && state.active && state.enabled ? styles.badge : styles.inactive}>{connection.account_active && state.active && state.enabled ? "Can manage tax" : "Access inactive"}</span></div>;
          }) : <p className={styles.empty}>No connected accounts.</p>}
          {state.enabled && <div className={styles.foot}><p className={styles.help}>Disconnect to stop tax company access. Your salon and staff keep their uploaded paystubs.</p><form action={updateTaxSettings}><input type="hidden" name="disconnect" value="true" /><SubmitButton className={styles.danger} pendingLabel="Disconnecting…">Disconnect all accounts</SubmitButton></form></div>}
        </details>}
      <div className={styles.actions}>{state.active && <Link href="/tax-company" className={styles.button}>Open Tax Company app ↗</Link>}<Link href="/payroll/tax-company?report=1" className={styles.button}>View tax report →</Link></div>
    </div>
  </main>;
}

export default withExperiencePage(TaxSettings);
