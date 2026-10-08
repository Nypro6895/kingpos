import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { getBusinessWorkspace } from "@/lib/platform-admin/business-workspace";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { BusinessesWorkspace } from "./businesses-workspace";
export default async function AdminLocationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePlatformAdmin(P.locationsRead);
  const params = await searchParams;
  const data = await getBusinessWorkspace(params);
  return (
    <BusinessesWorkspace
      data={data}
      permissions={actor.permissions}
      actorId={actor.userId}
    />
  );
}
