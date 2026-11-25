import { PairedCustomerDisplay } from "@/app/pos/customer-display/paired-customer-display";
import { getPortableWorkstationSession } from "@/lib/portable-workstation-server";
import { PortableEntry } from "@/app/pos/portable/portable-entry";

export default async function PortableCustomerDisplayPage() {
  const session = await getPortableWorkstationSession(undefined, "customer").catch(() => null);
  if (session?.role === "customer" && session.current) return <PairedCustomerDisplay session={session} />;
  return <main className="grid min-h-dvh place-items-center bg-zinc-100 px-4 py-8"><PortableEntry initialRole="customer" /></main>;
}
