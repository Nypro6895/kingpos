import Link from "next/link";
import {
  AdminPageHeader,
  AdminTable,
  EmptyState,
  Pagination,
  SearchForm,
  SelectInput,
  StatusBadge,
  formatAdminDateTime,
} from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { searchPlatformAdminLocations } from "@/lib/platform-admin/locations";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

type LocationsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminLocationsPage({
  searchParams,
}: LocationsPageProps) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
  const params = await searchParams;
  const locations = await searchPlatformAdminLocations({
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
    status: params.status,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;

  return (
    <>
      <AdminPageHeader eyebrow="Locations" title="Salon Locations">
        Location records across businesses. Map/geocoding internals stay owned
        by the existing location services.
      </AdminPageHeader>

      <SearchForm defaultQuery={query}>
        <SelectInput
          defaultValue={status ?? ""}
          label="Status"
          name="status"
          options={[
            { label: "Any status", value: "" },
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
          ]}
        />
      </SearchForm>

      <div className="mt-6">
        {locations.items.length === 0 ? (
          <EmptyState title="No locations found" />
        ) : (
          <AdminTable
            columns={
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-3">Location</div>
                <div className="col-span-3">Business</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-3">Address</div>
                <div className="col-span-1 text-right">Open</div>
              </div>
            }
          >
            {locations.items.map((location) => (
              <div
                className="grid gap-3 px-4 py-4 md:grid-cols-12 md:items-center"
                key={location.id}
              >
                <div className="md:col-span-3">
                  <p className="font-bold text-zinc-950">{location.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatAdminDateTime(location.created_at)}
                  </p>
                </div>
                <div className="text-sm text-zinc-600 md:col-span-3">
                  {location.organization_name}
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={location.status} />
                </div>
                <div className="text-sm text-zinc-600 md:col-span-3">
                  {[location.city, location.state, location.postal_code]
                    .filter(Boolean)
                    .join(", ") || "-"}
                </div>
                <div className="md:col-span-1 md:text-right">
                  <Link
                    className="text-sm font-bold text-orange-700 hover:text-orange-800"
                    href={`/admin/locations/${location.id}`}
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </AdminTable>
        )}
        <Pagination
          basePath="/admin/locations"
          page={locations.page}
          pageSize={locations.page_size}
          query={{ q: query ?? null, status: status ?? null }}
          total={locations.total}
        />
      </div>
    </>
  );
}
