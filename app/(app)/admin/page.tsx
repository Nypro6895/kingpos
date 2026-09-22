import {
  AdminMetric,
  AdminPageHeader,
  AdminSection,
  EmptyState,
  Field,
  FieldGrid,
  StatusBadge,
  formatAdminDateTime,
} from "@/app/(app)/admin/_components/admin-ui";
import { getPlatformAdminDashboard } from "@/lib/platform-admin/dashboard";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

function statusSummary(values: Record<string, number>) {
  const entries = Object.entries(values);

  if (entries.length === 0) {
    return "No status data";
  }

  return entries.map(([status, count]) => `${status}: ${count}`).join(" - ");
}

export default async function AdminPage() {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.dashboardRead);
  const dashboard = await getPlatformAdminDashboard();

  return (
    <>
      <AdminPageHeader eyebrow="Platform" title="Admin Dashboard">
        Real platform counts and queues for operations review.
      </AdminPageHeader>

      <dl className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminMetric
          detail={`${dashboard.users.active} active - ${dashboard.users.suspended} suspended`}
          label="Users"
          value={dashboard.users.total}
        />
        <AdminMetric
          detail={statusSummary(dashboard.businesses.by_status)}
          label="Businesses"
          value={dashboard.businesses.total}
        />
        <AdminMetric
          detail={statusSummary(dashboard.locations.by_status)}
          label="Locations"
          value={dashboard.locations.total}
        />
        <AdminMetric
          detail={`${dashboard.reports.urgent_or_high} high or urgent - ${dashboard.reports.assigned_to_me} assigned to me`}
          label="Open Reports"
          value={dashboard.reports.open}
        />
      </dl>

      <AdminSection title="Recent Audit">
        {dashboard.recent_audit.length === 0 ? (
          <EmptyState title="No visible audit events">
            Audit data appears here for roles with `admin.audit.read`.
          </EmptyState>
        ) : (
          <FieldGrid>
            {dashboard.recent_audit.map((item) => (
              <Field
                key={item.id}
                label={formatAdminDateTime(item.created_at)}
                value={
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{item.action}</span>
                      <StatusBadge value={item.target_type} />
                    </div>
                    <p className="text-zinc-600">
                      {item.actor?.display_name ?? "System"} -{" "}
                      {item.reason ?? "No reason stored"}
                    </p>
                  </div>
                }
              />
            ))}
          </FieldGrid>
        )}
      </AdminSection>
    </>
  );
}
