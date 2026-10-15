import { withExperiencePage } from "@/components/experience-page";
import { StaffMyWorkClient } from "@/app/staff/my-work/staff-my-work-client";
import { StaffPortalLoadError } from "@/app/staff/my-work/staff-my-work-view";
import { WorkspaceText } from "@/components/workspace-language";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import type { StaffMyWorkSearchParams } from "@/lib/staff-my-work-experience";
import type { StaffMyWorkResource } from "@/lib/staff-my-work-experience";
import { loadStaffMyWorkResource } from "@/lib/staff-my-work-resource-server";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { redirect } from "next/navigation";

async function StaffMyWorkPage({ searchParams }: { searchParams?: Promise<StaffMyWorkSearchParams> }) {
  const params = await searchParams ?? {};
  let identity: Awaited<ReturnType<typeof getStaffPortalIdentity>>;
  try { identity = await getStaffPortalIdentity(); }
  catch (error) { console.error("Staff identity load failed", error); return <StaffPortalLoadError label="Staff Daily" />; }
  if (!identity.context.user) redirect("/login");
  if (!identity.context.currentSalon) return <main className="mx-auto w-full max-w-3xl px-6 py-12"><p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600"><WorkspaceText text="Please select a salon first." /></p></main>;
  if (!identity.staff) return <main className="mx-auto w-full max-w-3xl px-6 py-12"><p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600"><WorkspaceText text="No active staff profile is linked to your account for this salon." /></p></main>;
  let resource: StaffMyWorkResource;
  try { resource = await loadStaffMyWorkResource(identity, params); }
  catch (error) {
    console.error("Staff Daily load failed", error);
    return <StaffPortalLoadError label="Staff Daily" />;
  }
  return <StaffMyWorkClient initialSnapshot={createLiveResourceSnapshot(resource, ["generatedAt"])} scope={getExperienceContext(identity.context).scope} params={params} />;
}

export default withExperiencePage(StaffMyWorkPage);
