import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { getCampaigns } from "@/lib/explore-advertising";
import { CampaignForm } from "./campaign-form";
export default async function AdvertisingPage() {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.businessesUpdate);
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [],
    error = "";
  try {
    campaigns = await getCampaigns();
  } catch (e) {
    error = e instanceof Error ? e.message : "Campaigns could not load.";
  }
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <h1 className="text-3xl font-bold">Explore advertising</h1>
      <p className="text-zinc-600">
        Manage popups, desktop sidebar / mobile feed images, and scrolling
        announcements. Active campaigns rotate randomly; with multiple
        placements, the next visit chooses a different image. Popup frequency is
        shared by visitors on the same IP.
      </p>
      {error ? (
        <p role="alert" className="rounded-xl bg-amber-50 p-4 text-amber-900">
          {error}
        </p>
      ) : null}
      <CampaignForm />
      {campaigns.map((campaign) => (
        <CampaignForm key={campaign.id} campaign={campaign} />
      ))}
    </main>
  );
}
