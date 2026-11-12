import { redirect } from "next/navigation";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { loadMyTaxDocuments } from "@/lib/tax-workspace";
import { TaxWorkspace } from "@/app/tax/tax-workspace";
import type { TaxWorkspaceData } from "@/types/tax-workspace";
export default async function MyTaxDocuments() {
  const context = await getCurrentBusinessContext();
  if (!context.user) redirect("/login?next=%2Faccount%2Ftax-documents");
  let documents: Awaited<ReturnType<typeof loadMyTaxDocuments>> | null = null;
  try {
    documents = await loadMyTaxDocuments();
  } catch {
    /* Preserve the established My Pay entry until migration. */
  }
  if (!documents)
    return (
      <main className="tax-auth">
        <h1>My tax documents</h1>
        <p>
          Personal document history requires the latest database update. Your
          existing paystubs remain available in My Pay.
        </p>
      </main>
    );
  const data: TaxWorkspaceData = {
    salon: {
      id: "personal",
      name: "My personal documents",
      phone: null,
      city: null,
      state: null,
      address_line1: null,
    },
    runs: [],
    lines: [],
    documents,
    messages: [],
    receipts: [],
    events: [],
  };
  return (
    <TaxWorkspace
      initialData={data}
      mode="staff"
      profile={null}
      salons={[]}
      workspaces={context.workspaceOptions}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
