import { withExperiencePage } from "@/components/experience-page";
import { CustomerActivityClient } from "@/app/activity/customer-activity-client";
import { CustomerActivityError } from "@/app/activity/customer-activity-view";
import { getCustomerActivity } from "@/lib/customer-activity";
import { customerJourneyTab } from "@/lib/customer-journey";
import { getRequestBusinessContext } from "@/lib/request-business-context";
import { getExperienceContext } from "@/lib/experience-context";
import { createLiveResourceSnapshot } from "@/lib/experience-live-resource-server";
import { redirect } from "next/navigation";
async function MyBookingsPage({searchParams}:{searchParams:Promise<{tab?:string;details?:string;message?:string;error?:string}>}) {
  const [context,result,params]=await Promise.all([getRequestBusinessContext(),getCustomerActivity({limit:50}),searchParams]);
  if(!context.user||!result.ok&&result.code==="sign_in_required")redirect("/login?next=/my-bookings");
  if(!result.ok)return <CustomerActivityError message={result.message}/>;
  return <CustomerActivityClient scope={getExperienceContext(context).scope} initialSnapshot={createLiveResourceSnapshot({kind:"activity" as const,result:result.data})} initialTab={customerJourneyTab(params.tab)} initialStatus={params.tab==="cancelled"?"cancelled":"all"} initialSelectedBookingId={params.details} message={params.message} error={params.error}/>;
}
export default withExperiencePage(MyBookingsPage);
