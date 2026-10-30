import { withExperiencePage } from "@/components/experience-page";
import { CustomerActivityClient } from "@/app/activity/customer-activity-client";
import { CustomerActivityError } from "@/app/activity/customer-activity-view";
import { getCustomerActivity } from "@/lib/customer-activity";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import { redirect } from "next/navigation";

async function ActivityPage() {
  const [context, result] = await Promise.all([getRequestBusinessContext(), getCustomerActivity({limit:50})]);
  if (!context.user || !result.ok && result.code === "sign_in_required") redirect("/login?next=/activity");
  if (!result.ok) return <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8"><div className="mx-auto grid w-full max-w-5xl gap-5"><CustomerActivityError message={result.message} /></div></main>;
  return <CustomerActivityClient scope={getExperienceContext(context).scope} initialTab="history" initialSnapshot={createLiveResourceSnapshot({ kind: "activity" as const, result: result.data })} />;
}

export default withExperiencePage(ActivityPage);
