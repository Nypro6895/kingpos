import Link from "next/link";
import { createAdminReportAction } from "@/app/(app)/admin/actions";
import {
  AdminPageHeader,
  AdminSection,
  AdminTable,
  EmptyState,
  Pagination,
  SearchForm,
  SelectInput,
  StatusBadge,
  SubmitButton,
  TextArea,
  TextInput,
  formatAdminDateTime,
  hasAdminPermission,
} from "@/app/(app)/admin/_components/admin-ui";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { searchPlatformAdminReports } from "@/lib/platform-admin/reports";

type ReportsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
  const context = await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.reportsRead);
  const params = await searchParams;
  const reports = await searchPlatformAdminReports({
    assigned: params.assigned,
    page: params.page,
    pageSize: params.pageSize,
    priority: params.priority,
    q: params.q,
    status: params.status,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  const priority = Array.isArray(params.priority)
    ? params.priority[0]
    : params.priority;
  const assigned = Array.isArray(params.assigned)
    ? params.assigned[0]
    : params.assigned;
  const canCreate = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.reportsCreate,
  );

  return (
    <>
      <AdminPageHeader eyebrow="Reports" title="Report Queue">
        Trust, support and manual platform reports with server-side workflow
        enforcement.
      </AdminPageHeader>

      <SearchForm defaultQuery={query}>
        <SelectInput
          defaultValue={status ?? ""}
          label="Status"
          name="status"
          options={[
            { label: "Any status", value: "" },
            { label: "New", value: "new" },
            { label: "Under review", value: "under_review" },
            { label: "Action required", value: "action_required" },
            { label: "Resolved", value: "resolved" },
            { label: "Closed", value: "closed" },
          ]}
        />
        <SelectInput
          defaultValue={priority ?? ""}
          label="Priority"
          name="priority"
          options={[
            { label: "Any priority", value: "" },
            { label: "Low", value: "low" },
            { label: "Normal", value: "normal" },
            { label: "High", value: "high" },
            { label: "Urgent", value: "urgent" },
          ]}
        />
        <SelectInput
          defaultValue={assigned ?? ""}
          label="Assignment"
          name="assigned"
          options={[
            { label: "Any assignment", value: "" },
            { label: "Assigned to me", value: "me" },
            { label: "Unassigned", value: "unassigned" },
          ]}
        />
      </SearchForm>

      <AdminSection title="Queue">
        {reports.items.length === 0 ? (
          <EmptyState title="No reports found" />
        ) : (
          <AdminTable
            columns={
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-4">Report</div>
                <div className="col-span-2">Priority</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Subject</div>
                <div className="col-span-1">Created</div>
                <div className="col-span-1 text-right">Open</div>
              </div>
            }
          >
            {reports.items.map((report) => (
              <div
                className="grid gap-3 px-4 py-4 md:grid-cols-12 md:items-center"
                key={report.id}
              >
                <div className="md:col-span-4">
                  <p className="font-bold text-zinc-950">
                    {report.report_number} - {report.summary}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {report.category} - {report.assignee?.display_name ?? "Unassigned"}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={report.priority} />
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={report.status} />
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {report.subject?.label ?? "No subject"}
                </div>
                <div className="text-sm text-zinc-600 md:col-span-1">
                  {formatAdminDateTime(report.created_at)}
                </div>
                <div className="md:col-span-1 md:text-right">
                  <Link
                    className="text-sm font-bold text-orange-700 hover:text-orange-800"
                    href={`/admin/reports/${report.id}`}
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </AdminTable>
        )}
        <Pagination
          basePath="/admin/reports"
          page={reports.page}
          pageSize={reports.page_size}
          query={{
            assigned: assigned ?? null,
            priority: priority ?? null,
            q: query ?? null,
            status: status ?? null,
          }}
          total={reports.total}
        />
      </AdminSection>

      {canCreate ? (
        <AdminSection title="Create Manual Report">
          <form
            action={createAdminReportAction}
            className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:grid-cols-2"
          >
            <TextInput label="Category" name="category" required />
            <SelectInput
              defaultValue="normal"
              label="Priority"
              name="priority"
              options={[
                { label: "Low", value: "low" },
                { label: "Normal", value: "normal" },
                { label: "High", value: "high" },
                { label: "Urgent", value: "urgent" },
              ]}
            />
            <TextInput defaultValue="manual" label="Source" name="source" required />
            <SelectInput
              defaultValue=""
              label="Subject type"
              name="subject_type"
              options={[
                { label: "No subject", value: "" },
                { label: "User", value: "user" },
                { label: "Business", value: "business" },
                { label: "Location", value: "location" },
              ]}
            />
            <TextInput label="Subject ID" name="subject_id" />
            <TextInput label="Reporter user ID" name="reporter_user_id" />
            <TextInput label="Assigned membership ID" name="assigned_membership_id" />
            <div className="lg:col-span-2">
              <TextInput label="Summary" name="summary" required />
            </div>
            <div className="lg:col-span-2">
              <TextArea label="Description" name="description" />
            </div>
            <div className="lg:col-span-2">
              <SubmitButton>Create report</SubmitButton>
            </div>
          </form>
        </AdminSection>
      ) : null}
    </>
  );
}
