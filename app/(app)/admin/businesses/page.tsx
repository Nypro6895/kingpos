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
import { searchPlatformAdminBusinesses } from "@/lib/platform-admin/businesses";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

type BusinessesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminBusinessesPage({
  searchParams,
}: BusinessesPageProps) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.businessesRead);
  const params = await searchParams;
  const businesses = await searchPlatformAdminBusinesses({
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
    status: params.status,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;

  return (
    <>
      <AdminPageHeader eyebrow="Businesses" title="Salon Businesses">
        Platform-wide business records with safe owner context and status
        signals.
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
            { label: "Suspended", value: "suspended" },
            { label: "Archived", value: "archived" },
          ]}
        />
      </SearchForm>

      <div className="mt-6">
        {businesses.items.length === 0 ? (
          <EmptyState title="No businesses found" />
        ) : (
          <AdminTable
            columns={
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">Business</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Owner</div>
                <div className="col-span-2">Locations</div>
                <div className="col-span-1">Created</div>
                <div className="col-span-1 text-right">Open</div>
              </div>
            }
          >
            {businesses.items.map((business) => (
              <div
                className="grid gap-3 px-4 py-4 md:grid-cols-12 md:items-center"
                key={business.id}
              >
                <div className="md:col-span-4">
                  <p className="font-bold text-zinc-950">{business.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {business.id}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={business.status} />
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {business.owner?.display_name ?? "No owner"}
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {business.location_count} locations - {business.member_count} members
                </div>
                <div className="text-sm text-zinc-600 md:col-span-1">
                  {formatAdminDateTime(business.created_at)}
                </div>
                <div className="md:col-span-1 md:text-right">
                  <Link
                    className="text-sm font-bold text-orange-700 hover:text-orange-800"
                    href={`/admin/businesses/${business.id}`}
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </AdminTable>
        )}
        <Pagination
          basePath="/admin/businesses"
          page={businesses.page}
          pageSize={businesses.page_size}
          query={{ q: query ?? null, status: status ?? null }}
          total={businesses.total}
        />
      </div>
    </>
  );
}
