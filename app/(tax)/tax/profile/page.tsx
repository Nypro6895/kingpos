import { redirect } from "next/navigation";
import { loadTaxIdentity } from "@/lib/tax-workspace";
import { TaxEntry } from "@/app/tax/tax-entry";
import { taxQaRequest } from "@/lib/tax-workspace-qa";
export default async function TaxProfilePage() {
  const qa = await taxQaRequest();
  if (qa)
    return (
      <TaxEntry
        profile={qa.profile}
        initialName="Taylor Nguyen"
        initialEmail="taylor@example.test"
        salons={[]}
        workspaces={[]}
        editing
        qa
      />
    );
  const { context, profile } = await loadTaxIdentity();
  if (!context.user) redirect("/tax/login");
  return (
    <TaxEntry
      profile={profile}
      initialName={context.user.display_name ?? ""}
      initialEmail={context.user.email ?? ""}
      salons={[]}
      workspaces={context.workspaceOptions}
      editing
    />
  );
}
