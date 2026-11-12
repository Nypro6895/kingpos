import { SalonName } from "@/components/salon-member-badge";
import { withOwnedSalonPage } from "@/components/owned-salon-page";
import { withExperiencePage } from "@/components/experience-page";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getCurrentBusinessContext,
  isWorkspaceDestinationAllowed,
} from "@/lib/current-context";
import { loginHrefForReturnPath } from "@/lib/auth-routing";
import { taxOwnerReturnPath } from "@/lib/tax-flow";
import { taxActivationHref } from "@/lib/tax-activation";
import { TaxActivationFollowup } from "@/app/tax/tax-activation-followup";
import { TaxAccessLink } from "@/app/tax/tax-access-link";
import { taxCompanySettings } from "@/lib/tax-company";
import { updateTaxSettings } from "@/app/market/scoped-market-actions";
import { marketTargetHref } from "@/lib/market-target-url";
import { OwnerTaxCredentials } from "@/app/tax-company/owner-credentials";
import { TaxRenewal } from "@/app/tax/tax-renewal";
import styles from "@/app/tax-company/tax-company.module.css";
import { SubmitButton } from "@/components/submit-button";

async function TaxSettings({
  searchParams,
}: {
  searchParams: Promise<{
    message?: string;
    salon?: string;
    setup?: string;
    activation?: string;
    renew?: string;
  }>;
}) {
  const query = await searchParams;
  const context = await getCurrentBusinessContext();
  if (query.salon) {
    const renewalTarget = taxOwnerReturnPath(
      "/payroll/tax-company/settings",
      query.salon,
    );
    const targetHref =
      query.renew === "1"
        ? renewalTarget
          ? renewalTarget + "&renew=1"
          : undefined
        : taxActivationHref(query.salon, query.activation === "payment");
    if (!context.user)
      redirect(
        loginHrefForReturnPath(targetHref ?? "/payroll/tax-company/settings"),
      );
    if (!targetHref || context.currentSalon?.id !== query.salon) {
      const target = context.workspaceOptions.find(
        (w) => w.salonId === query.salon && w.salonMode === "manage",
      );
      if (
        target &&
        targetHref &&
        isWorkspaceDestinationAllowed(target, targetHref)
      )
        redirect(
          "/workspace/open?" +
            new URLSearchParams({
              workspace_id: target.id,
              destination: targetHref,
            }),
        );
      return (
        <main className={styles.page}>
          <h1>Choose the salon for this activation</h1>
          <p>
            This activation belongs to another salon. Switch to a salon you own
            before continuing.
          </p>
          <Link href="/my-place">Choose workspace</Link>
        </main>
      );
    }
  }
  const salonId = (await getCurrentBusinessContext()).currentSalon!.id;
  let state: Awaited<ReturnType<typeof taxCompanySettings>>;
  try {
    state = await taxCompanySettings();
  } catch (error) {
    return (
      <main className={styles.page}>
        <p role="alert" className={styles.notice}>
          {error instanceof Error ? error.message : "Settings unavailable."}
        </p>
        <Link href={marketTargetHref("/market", salonId)}>Open Market</Link>
      </main>
    );
  }
  return (
    <main className={`${styles.page} ${styles.settings}`}>
      <header>
        <Link
          href={`/settings?section=salon-${salonId}-payroll`}
          className={styles.back}
        >
          ← Payroll
        </Link>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>
              <SalonName name={state.salon_name} currentSalon />
            </p>
            <h1>Tax Company settings</h1>
          </div>
          <span
            className={
              state.active && state.enabled ? styles.badge : styles.inactive
            }
          >
            {state.active && state.enabled
              ? "Sharing enabled"
              : state.active
                ? "Ready to connect"
                : "Plugin inactive"}
          </span>
        </div>
      </header>
      {query.message && (
        <p role="status" className={styles.notice}>
          {query.message}
        </p>
      )}
      {query.setup === "1" && state.active && context.currentSalon && (
        <TaxActivationFollowup
          active={state.active}
          salonId={context.currentSalon.id}
        />
      )}
      {context.currentSalon && (
        <TaxRenewal salonId={context.currentSalon.id} active={state.active} />
      )}
      <section className={styles.panel}>
        <div className={styles.panelBody}>
          <h2>Tax data & documents</h2>
          <p>
            Your business keeps all payroll records, current and archived
            documents, receipts and conversations when your tax professional
            changes.
          </p>
          <Link
            className={styles.primary}
            href="/payroll/tax-company/workspace"
          >
            Open owner Tax workspace →
          </Link>
        </div>
      </section>
      <div className={styles.stack}>
        {state.active && (
          <details
            className={styles.panel}
            open={!state.login_id || !state.enabled}
          >
            <summary className={styles.panelHead}>
              Salon login · ID & password
            </summary>
            <OwnerTaxCredentials
              loginId={state.login_id}
              active={state.active}
              enabled={state.enabled}
            />
          </details>
        )}
        {(state.active || state.enabled || state.connections.length > 0) && (
          <details className={styles.panel}>
            <summary className={styles.panelHead}>
              People with tax access · {state.connections.length}
            </summary>
            {state.connections.length ? (
              state.connections.map((connection) => {
                const name =
                  connection.display_name ||
                  connection.email ||
                  connection.phone ||
                  "Reylumi account";
                const initials = name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase();
                return (
                  <div key={connection.user_id} className={styles.accountRow}>
                    <span className={styles.avatar} aria-hidden="true">
                      {initials}
                    </span>
                    <div className={styles.accountInfo}>
                      <strong>{name}</strong>
                      <p>
                        {connection.email ||
                          connection.phone ||
                          `Account ${connection.user_id}`}
                      </p>
                      <p className={styles.muted}>
                        Connected{" "}
                        {new Date(connection.connected_at).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                          },
                        )}
                      </p>
                    </div>
                    <span
                      className={
                        connection.account_active &&
                        state.active &&
                        state.enabled
                          ? styles.badge
                          : styles.inactive
                      }
                    >
                      {connection.account_active &&
                      state.active &&
                      state.enabled
                        ? "Can manage tax"
                        : "Access inactive"}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className={styles.empty}>No connected accounts.</p>
            )}
            {state.enabled && (
              <div className={styles.foot}>
                <p className={styles.help}>
                  Disconnect to stop tax company access. Your salon and staff
                  keep their uploaded paystubs.
                </p>
                <form action={updateTaxSettings.bind(null, salonId)}>
                  <input type="hidden" name="disconnect" value="true" />
                  <SubmitButton
                    className={styles.danger}
                    pendingLabel="Disconnecting…"
                  >
                    Disconnect all accounts
                  </SubmitButton>
                </form>
              </div>
            )}
          </details>
        )}
        <TaxAccessLink
          salonId={context.currentSalon?.id}
          canInvite={state.active && state.enabled}
        />
        <div className={styles.actions}>
          <Link href="/payroll/tax-company?report=1" className={styles.button}>
            View tax report →
          </Link>
        </div>
      </div>
    </main>
  );
}

export default withExperiencePage(withOwnedSalonPage(TaxSettings));
