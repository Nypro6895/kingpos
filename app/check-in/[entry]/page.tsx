import { withExperiencePage } from "@/components/experience-page";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
async function PhoneCheckinPage({ params }: { params: Promise<{ entry: string }> }) {
  const { entry } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(entry)) notFound();
  const client = createSupabaseServerClient();
  const result = await client?.rpc("service_relay_entry_catalog", { p_entry: entry });
  if (!result?.data || result.error) return <main className="mx-auto max-w-md p-6"><h1>Check-in unavailable</h1><p>Scan the salon screen again or check in at the front desk.</p></main>;
  // My QR already preserves this salon entry through login, signup and phone
  // onboarding. Both new and returning customers use the account check-in.
  redirect(`/qr?entry=${encodeURIComponent(entry)}`);
}

export default withExperiencePage(PhoneCheckinPage);
