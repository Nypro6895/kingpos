import { withExperiencePage } from "@/components/experience-page";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PhoneRelayCheckin } from "./phone-checkin";
import { getCurrentBusinessContext } from "@/lib/current-context";
async function PhoneCheckinPage({ params }: { params: Promise<{ entry: string }> }) {
  const { entry } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(entry)) notFound();
  const client = createSupabaseServerClient();
  const result = await client?.rpc("service_relay_entry_catalog", { p_entry: entry });
  if (!result?.data || result.error) return <main className="mx-auto max-w-md p-6"><h1>Check-in unavailable</h1><p>Scan the salon screen again or check in at the front desk.</p></main>;
  const context = await getCurrentBusinessContext().catch(() => null);
  return <PhoneRelayCheckin entry={entry} salonName={result.data.salonName} services={result.data.services} initialName={context?.user?.display_name ?? ""} initialPhone={context?.user?.phone ?? ""} />;
}

export default withExperiencePage(PhoneCheckinPage);
