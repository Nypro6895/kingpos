import Link from "next/link";
import { loadTaxIdentity, loadTaxBusinesses } from "@/lib/tax-workspace";
import { TaxEntry } from "@/app/tax/tax-entry";
import { taxQaRequest } from "@/lib/tax-workspace-qa";
export default async function TaxHome({
  searchParams,
}: {
  searchParams?: Promise<{ setup?: string; paused?: string }>;
}) {
  const qa = await taxQaRequest();
  if (qa) {
    const query = await searchParams;
    return (
      <TaxEntry
        profile={query?.setup === "1" ? null : qa.profile}
        initialName={qa.profile?.display_name ?? "Taylor Nguyen"}
        initialEmail={qa.profile?.contact_email ?? "taylor@example.test"}
        salons={[
          {
            id: qa.data.salon.id,
            name: qa.data.salon.name,
            active: query?.paused !== "1",
            inactive_reason:
              query?.paused === "1"
                ? "Owner needs to renew Tax Company access."
                : null,
            city: "Houston",
            state: "TX",
            pending_count: query?.paused === "1" ? null : 8,
            missing_paystubs: query?.paused === "1" ? null : 9,
          },
        ]}
        workspaces={[]}
        qa
      />
    );
  }
  const { context, profile, error } = await loadTaxIdentity();
  if (!context.user)
    return (
      <main className="tax-auth">
        <span className="tax-brand">
          ReyLUMI <span>Tax</span>
        </span>
        <h1>Work with your connected businesses</h1>
        <p>
          Review shared payroll, manage documents and send results to salon
          owners.
        </p>
        <div className="tax-actions">
          <Link className="tax-primary" href="/tax/login">
            Sign in
          </Link>
          <Link href="/tax/signup">Get started</Link>
        </div>
        <p>Already a Reylumi user? Your existing account works here.</p>
      </main>
    );
  if (error)
    return (
      <main className="tax-auth">
        <h1>Tax workspace unavailable</h1>
        <p role="alert">{error}</p>
        <Link href="/explore">Personal workspace</Link>
      </main>
    );
  const salons = profile ? await loadTaxBusinesses() : [];
  return (
    <TaxEntry
      profile={profile}
      initialName={context.user.display_name ?? ""}
      initialEmail={context.user.email ?? ""}
      salons={salons}
      workspaces={context.workspaceOptions}
    />
  );
}
