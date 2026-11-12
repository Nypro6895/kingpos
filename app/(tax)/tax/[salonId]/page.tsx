import Link from "next/link";
import { redirect } from "next/navigation";
import { loadTaxIdentity, loadTaxWorkspace } from "@/lib/tax-workspace";
import { taxCompanySalons } from "@/lib/tax-company";
import { TaxWorkspace } from "@/app/tax/tax-workspace";
import { taxQaRequest } from "@/lib/tax-workspace-qa";
export default async function TaxBusiness({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params,
    qa = await taxQaRequest();
  if (qa)
    return (
      <TaxWorkspace
        key={salonId + qa.mode}
        initialData={qa.data}
        mode={qa.mode}
        profile={qa.profile}
        salons={[{ id: qa.data.salon.id, name: qa.data.salon.name }]}
        workspaces={[]}
        today="2026-11-09"
        qa
      />
    );
  const identity = await loadTaxIdentity();
  if (!identity.context.user) redirect("/tax/login");
  if (!identity.profile) redirect("/tax");
  let result: Awaited<ReturnType<typeof loadTaxWorkspace>> | null = null,
    salons: Awaited<ReturnType<typeof taxCompanySalons>> = [],
    error = "";
  try {
    [result, salons] = await Promise.all([
      loadTaxWorkspace(salonId),
      taxCompanySalons(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Refresh your connection.";
  }
  if (!result)
    return (
      <main className="tax-auth">
        <h1>Business unavailable</h1>
        <p role="alert">{error}</p>
        <Link href="/tax">My businesses</Link>
      </main>
    );
  return (
    <TaxWorkspace
      key={salonId}
      initialData={result}
      mode="tax"
      profile={identity.profile}
      salons={salons.filter((s) => s.active)}
      workspaces={identity.context.workspaceOptions}
      today={new Date().toLocaleDateString("en-CA", {
        timeZone: identity.context.user.timezone || "America/Chicago",
      })}
    />
  );
}
