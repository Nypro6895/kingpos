import type { Metadata } from "next";
import Link from "next/link";
import { withExperiencePage } from "@/components/experience-page";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { personalSalonEntry } from "@/lib/personal-qr";

function validEntry(entry: string) {
  return personalSalonEntry(`https://reylumi.com/check-in/${entry}`);
}
function installUrl(): string | undefined {
  try {
    const url = new URL(process.env.REYLUMI_CUSTOMER_IOS_INSTALL_URL ?? "");
    if (url.protocol === "https:" && ["apps.apple.com", "testflight.apple.com"].includes(url.hostname) && !url.username && !url.password && !url.port) return url.href;
  } catch { /* No public install channel is configured yet. */ }
}
export async function generateMetadata({ params }: { params: Promise<{ entry: string }> }): Promise<Metadata> {
  const { entry } = await params;
  if (!validEntry(entry)) return {};
  // Invited TestFlight groups do not constitute a public customer install link.
  const install = installUrl();
  return install && new URL(install).hostname === "apps.apple.com" ? { itunes: { appId: "6821394475", appArgument: `https://reylumi.com/check-in/${entry}` } } : {};
}
async function PhoneCheckinPage({ params }: { params: Promise<{ entry: string }> }) {
  const { entry } = await params;
  if (!validEntry(entry)) notFound();
  const result = await createSupabaseServerClient()?.rpc("personal_checkin_destination", { p_entry: entry });
  if (result?.error || !result?.data) return <main className="mx-auto max-w-md p-6"><h1>Check-in unavailable</h1><p>Scan the salon screen again or check in at the front desk.</p></main>;
  const install = installUrl();
  return <main className="mx-auto flex max-w-md flex-col gap-4 p-6">
    <p className="text-sm text-slate-600">Reylumi check-in</p>
    <h1 className="text-2xl font-semibold">Check in at {result.data}</h1>
    <p>Open Reylumi, choose your services, then confirm your check-in.</p>
    <a className="rounded-xl bg-teal-700 px-4 py-3 text-center font-semibold text-white" href={`reylumi://check-in/${entry}`}>Open Reylumi</a>
    {install ? <>
      <a className="rounded-xl border px-4 py-3 text-center font-semibold" href={install}>Get Reylumi for iPhone</a>
      <p className="text-sm text-slate-600">After installing, return to this page and tap Open Reylumi. Sign in to continue at this salon.</p>
    </> : <p className="text-sm text-slate-600">The iPhone app is currently available to invited testers. You can also check in on this website.</p>}
    <Link className="rounded-xl border px-4 py-3 text-center font-semibold" href={`/qr?entry=${encodeURIComponent(entry)}`}>Continue on this website</Link>
    <p className="text-sm text-slate-600">You’ll sign in or create an account before confirming. Scanning this code does not check you in automatically.</p>
  </main>;
}
export default withExperiencePage(PhoneCheckinPage);
