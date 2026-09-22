import {
  AdminPageHeader,
  AdminTable,
  EmptyState,
  Pagination,
  SearchForm,
  StatusBadge,
  TextInput,
  formatAdminDateTime,
} from "@/app/(app)/admin/_components/admin-ui";
import { searchPlatformAdminAuditLogs } from "@/lib/platform-admin/audit";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

type AuditPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminAuditPage({ searchParams }: AuditPageProps) {
  await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.auditRead);
  const params = await searchParams;
  const logs = await searchPlatformAdminAuditLogs({
    action: params.action,
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
    targetType: params.targetType,
  });
  const query = Array.isArray(params.q) ? params.q[0] : params.q;
  const action = Array.isArray(params.action) ? params.action[0] : params.action;
  const targetType = Array.isArray(params.targetType)
    ? params.targetType[0]
    : params.targetType;

  return (
    <>
      <AdminPageHeader eyebrow="Audit" title="Platform Audit Logs">
        Append-only platform admin audit events. This page is read-only.
      </AdminPageHeader>

      <SearchForm defaultQuery={query}>
        <TextInput defaultValue={action ?? ""} label="Action" name="action" />
        <TextInput
          defaultValue={targetType ?? ""}
          label="Target type"
          name="targetType"
        />
      </SearchForm>

      <div className="mt-6">
        {logs.items.length === 0 ? (
          <EmptyState title="No audit logs found" />
        ) : (
          <AdminTable
            columns={
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-3">Time</div>
                <div className="col-span-3">Action</div>
                <div className="col-span-2">Target</div>
                <div className="col-span-2">Actor</div>
                <div className="col-span-2">Reason</div>
              </div>
            }
          >
            {logs.items.map((log) => (
              <div
                className="grid gap-3 px-4 py-4 md:grid-cols-12 md:items-start"
                key={log.id}
              >
                <div className="text-sm text-zinc-600 md:col-span-3">
                  {formatAdminDateTime(log.created_at)}
                </div>
                <div className="md:col-span-3">
                  <p className="font-bold text-zinc-950">{log.action}</p>
                  <p className="mt-1 break-all text-xs text-zinc-500">{log.id}</p>
                </div>
                <div className="md:col-span-2">
                  <StatusBadge value={log.target_type} />
                  <p className="mt-1 break-all text-xs text-zinc-500">
                    {log.target_id ?? "-"}
                  </p>
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {log.actor?.display_name ?? "System"}
                </div>
                <div className="text-sm text-zinc-600 md:col-span-2">
                  {log.reason ?? "-"}
                </div>
              </div>
            ))}
          </AdminTable>
        )}
        <Pagination
          basePath="/admin/audit"
          page={logs.page}
          pageSize={logs.page_size}
          query={{
            action: action ?? null,
            q: query ?? null,
            targetType: targetType ?? null,
          }}
          total={logs.total}
        />
      </div>
    </>
  );
}
