import {TaxRenewal} from "@/app/tax/tax-renewal";
import {redirect} from "next/navigation";
import {getCurrentBusinessContext,isWorkspaceDestinationAllowed} from "@/lib/current-context";
import {taxOwnerReturnPath} from "@/lib/tax-flow";
import {loginHrefForReturnPath} from "@/lib/auth-routing";
import Link from "next/link";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { isOwnerMembership } from "@/lib/current-context";
import { loadTaxWorkspace } from "@/lib/tax-workspace";
import { TaxWorkspace } from "@/app/tax/tax-workspace";
import { taxCompanySettings } from "@/lib/tax-company";
export default async function OwnerTaxWorkspacePage({searchParams}:{searchParams:Promise<{salon?:string;activation?:string}>}) {
  const query=await searchParams;
  if(query.salon){
    const current=await getCurrentBusinessContext();
    const target=taxOwnerReturnPath('/payroll/tax-company/workspace',query.salon);
    const destination=target+(query.activation==='payment'?'&activation=payment':'');
    if(!target)return <main className="tax-auth"><h1>Invalid salon</h1></main>;
    if(!current.user)redirect(loginHrefForReturnPath(destination));
    if(current.currentSalon?.id!==query.salon){
      const workspace=current.workspaceOptions.find(w=>w.salonId===query.salon&&w.salonMode==='manage');
      if(workspace&&isWorkspaceDestinationAllowed(workspace,destination))redirect('/workspace/open?'+new URLSearchParams({workspace_id:workspace.id,destination}));
      return <main className="tax-auth"><h1>Owner access required</h1><Link href="/my-place">Choose workspace</Link></main>;
    }
  }
  const context = await requireSalonManagePageContext(
    "/payroll/tax-company/workspace",
  );
  if (!context.currentSalon || !isOwnerMembership(context.currentMembership))
    return (
      <main className="tax-auth">
        <h1>Owner access required</h1>
      </main>
    );
  let result: Awaited<ReturnType<typeof loadTaxWorkspace>> | null = null,
    connection: Awaited<ReturnType<typeof taxCompanySettings>> | undefined,
    error = "";
  try {
    [result, connection] = await Promise.all([
      loadTaxWorkspace(context.currentSalon.id),
      taxCompanySettings(),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Apply the database update.";
  }
  if (!result)
    return (
      <main className="tax-auth">
        <h1>Tax workspace unavailable</h1>
        <p role="alert">{error}</p>
        <Link href="/payroll">Back to Payroll</Link>
      </main>
    );
  return (
    <>
    <TaxRenewal salonId={context.currentSalon.id} active={connection?.active??false}/>
    <TaxWorkspace
      initialData={result}
      mode="owner"
      profile={null}
      salons={[result.salon]}
      workspaces={context.workspaceOptions}
      today={new Date().toISOString().slice(0, 10)}
      ownerConnection={connection}
    />
    </>
  );
}
