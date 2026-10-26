import { redirect } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { getStaffPortalIdentity } from "@/lib/staff-portal-identity";
import { loadStaffScan } from "@/app/staff/scan/actions";
import { StaffScanClient } from "@/app/staff/scan/staff-scan-client";
import { StaffPortalLoadError } from "@/app/staff/my-work/staff-my-work-view";

async function StaffScanPage() {
  const identity = await getStaffPortalIdentity();
  if (!identity.context.user) redirect("/login");
  if (!identity.staff || !identity.context.currentSalon) return <StaffPortalLoadError label="Staff Scan" />;
  const scope = { salonId: identity.context.currentSalon.id, staffId: identity.staff.id };
  const result = await loadStaffScan(scope);
  return <StaffScanClient key={`${scope.salonId}:${scope.staffId}`} {...scope} initial={result.data ?? null} initialError={result.error} />;
}
export default withExperiencePage(StaffScanPage);
