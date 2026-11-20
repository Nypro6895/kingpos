import { redirect } from "next/navigation";
import { Suspense } from "react";
import { withExperiencePage } from "@/components/experience-page";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { loadStaffScan } from "@/app/staff/scan/actions";
import { StaffScanClient } from "@/app/staff/scan/staff-scan-client";
import { StaffScanLoading } from "@/app/staff/scan/staff-scan-loading";
import { StaffPortalLoadError } from "@/app/staff/my-work/staff-my-work-view";

async function StaffScanContent() {
  const identity = await getStaffPortalIdentity();
  if (!identity.context.user) redirect("/login");
  if (!identity.staff || !identity.context.currentSalon) return <StaffPortalLoadError label="Staff Scan" />;
  const scope = { salonId: identity.context.currentSalon.id, staffId: identity.staff.id };
  const result = await loadStaffScan(scope);
  // eslint-disable-next-line react-hooks/purity -- Timestamp the completed uncached server read, not a client render or authority lease.
  const initialReadAt = result.data ? Date.now() : undefined;
  return <StaffScanClient key={`${scope.salonId}:${scope.staffId}`} {...scope} initial={result.data ?? null} initialError={result.error} initialReadAt={initialReadAt} />;
}
function StaffScanPage() {
  return <Suspense fallback={<StaffScanLoading />}><StaffScanContent /></Suspense>;
}
export default withExperiencePage(StaffScanPage, { pendingFallback: <StaffScanLoading /> });
