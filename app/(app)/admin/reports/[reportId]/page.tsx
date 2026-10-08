import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { loadOptionalAdminSection, SectionError } from "@/app/(app)/admin/_components/optional-section";
import { AdminActionForm } from "@/app/(app)/admin/_components/action-form";
import Link from "next/link";
import {
  assignAdminReportAction,
  closeAdminReportAction,
  createAdminNoteAction,
  resolveAdminReportAction,
  updateAdminReportAction,
} from "@/app/(app)/admin/actions";
import {
  AdminPageHeader,
  AdminSection,
  EmptyState,
  Field,
  FieldGrid,
  SecondaryLink,
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
import { getPlatformAdminReportDetail } from "@/lib/platform-admin/reports";

type ReportDetailPageProps = {
  params: Promise<{ reportId: string }>;
};

function subjectHref(subject: { id: string; type: string } | null) {
  if (!subject) {
    return null;
  }

  if (subject.type === "user") {
    return `/admin/users/${subject.id}`;
  }

  if (subject.type === "business") {
    return `/admin/businesses/${subject.id}`;
  }

  if (subject.type === "location") {
    return `/admin/locations/${subject.id}`;
  }

  return null;
}

export default async function AdminReportDetailPage({
  params,
}: ReportDetailPageProps) {
  const context = await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.reportsRead);
  const { reportId } = await params;
  const detail = await getPlatformAdminReportDetail(reportId);
  const canAssign = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.reportsAssign,
  );
  const canUpdate = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.reportsUpdate,
  );
  const canResolve = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.reportsResolve,
  );
  const canCreateNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesCreate,
  );
  const href = subjectHref(detail.subject);

  const assignees = canAssign ? await loadOptionalAdminSection(() => callPlatformAdminRpc<Array<{id:string;name:string;role:string}>>("get_platform_admin_case_assignees")) : null;

  return (
    <>
      <AdminPageHeader
        actions={<SecondaryLink href="/admin/reports">Back to reports</SecondaryLink>}
        eyebrow="Report"
        title={`${detail.report.report_number} - ${detail.report.summary}`}
      >
        Report detail, assignment, workflow, notes and audit timeline.
      </AdminPageHeader>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-6">
          <AdminSection title="Report Details">
            <FieldGrid>
              <Field label="Report ID" value={detail.report.id} />
              <Field label="Category" value={detail.report.category} />
              <Field
                label="Priority"
                value={<StatusBadge value={detail.report.priority} />}
              />
              <Field label="Status" value={<StatusBadge value={detail.report.status} />} />
              <Field label="Source" value={detail.report.source} />
              <Field
                label="Subject"
                value={
                  href ? (
                    <Link className="font-bold text-orange-700" href={href}>
                      {detail.subject?.label}
                    </Link>
                  ) : (
                    detail.subject?.label ?? "-"
                  )
                }
              />
              <Field
                label="Assignee"
                value={detail.assignee?.display_name ?? "Unassigned"}
              />
              <Field
                label="Created"
                value={formatAdminDateTime(detail.report.created_at)}
              />
              <Field
                label="Resolved"
                value={formatAdminDateTime(detail.report.resolved_at)}
              />
              <Field label="Description" value={detail.report.description ?? "-"} />
              <Field label="Resolution" value={detail.report.resolution ?? "-"} />
            </FieldGrid>
          </AdminSection>

          {canUpdate ? (
            <AdminSection title="Update Report">
              <AdminActionForm
                action={updateAdminReportAction}
                className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:grid-cols-2"
              >
                <input name="report_id" type="hidden" value={detail.report.id} />
                <SelectInput
                  defaultValue={detail.report.priority}
                  label="Priority"
                  name="priority"
                  options={[
                    { label: "Low", value: "low" },
                    { label: "Normal", value: "normal" },
                    { label: "High", value: "high" },
                    { label: "Urgent", value: "urgent" },
                  ]}
                />
                <SelectInput
                  defaultValue={detail.report.status}
                  label="Status"
                  name="status"
                  options={[
                    { label: "New", value: "new" },
                    { label: "Under review", value: "under_review" },
                    { label: "Action required", value: "action_required" },
                    { label: "Resolved", value: "resolved" },
                    { label: "Closed", value: "closed" },
                  ]}
                />
                <div className="lg:col-span-2">
                  <TextInput
                    defaultValue={detail.report.summary}
                    label="Summary"
                    name="summary"
                    required
                  />
                </div>
                <div className="lg:col-span-2">
                  <TextArea
                    defaultValue={detail.report.description}
                    label="Description"
                    name="description"
                  />
                </div>
                <div className="lg:col-span-2">
                  <TextArea label="Reason" name="reason" required rows={3} />
                </div>
                <div className="lg:col-span-2">
                  <SubmitButton>Update report</SubmitButton>
                </div>
              </AdminActionForm>
            </AdminSection>
          ) : null}

          <AdminSection title="Timeline">
            {detail.timeline.length === 0 ? (
              <EmptyState title="No visible audit timeline" />
            ) : (
              <FieldGrid>
                {detail.timeline.map((item) => (
                  <Field
                    key={item.id}
                    label={formatAdminDateTime(item.created_at)}
                    value={
                      <div>
                        <p className="font-bold">{item.action}</p>
                        <p className="mt-1 text-zinc-600">
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
        </div>

        <aside className="grid content-start gap-6">
          {canAssign ? (
            <AdminSection title="Assign">
              <AdminActionForm
                action={assignAdminReportAction}
                className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <input name="report_id" type="hidden" value={detail.report.id} />
                <SelectInput defaultValue={detail.report.assigned_membership_id} label="Assign to" name="assigned_membership_id" options={[{label:"Unassigned",value:""},...(assignees?.data ?? []).map(member=>({label:`${member.name ?? "Admin"} · ${member.role}`,value:member.id}))]}/>{assignees?.error && <SectionError message={assignees.error}/>}
                <TextArea label="Reason" name="reason" required rows={3} />
                <SubmitButton>Save assignment</SubmitButton>
              </AdminActionForm>
            </AdminSection>
          ) : null}

          {canResolve ? (
            <AdminSection title="Resolve / Close">
              <div className="grid gap-4">
                <AdminActionForm
                  action={resolveAdminReportAction}
                  className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <input name="report_id" type="hidden" value={detail.report.id} />
                  <TextArea label="Resolution" name="resolution" required />
                  <TextArea label="Reason" name="reason" required rows={3} />
                  <SubmitButton>Resolve report</SubmitButton>
                </AdminActionForm>
                <AdminActionForm
                  action={closeAdminReportAction}
                  className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <input name="report_id" type="hidden" value={detail.report.id} />
                  <TextArea label="Close reason" name="reason" required rows={3} />
                  <SubmitButton>Close report</SubmitButton>
                </AdminActionForm>
              </div>
            </AdminSection>
          ) : null}

          <AdminSection title="Internal Notes">
            {canCreateNotes ? (
              <AdminActionForm action={createAdminNoteAction} className="mb-4 grid gap-3">
                <input name="target_id" type="hidden" value={detail.report.id} />
                <input name="target_type" type="hidden" value="report" />
                <input
                  name="return_path"
                  type="hidden"
                  value={`/admin/reports/${detail.report.id}`}
                />
                <TextArea label="New note" name="body" required />
                <SubmitButton>Add note</SubmitButton>
              </AdminActionForm>
            ) : null}
            {detail.notes.length > 0 ? (
              <div className="grid gap-3">
                {detail.notes.map((note) => (
                  <div
                    className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
                    key={note.id}
                  >
                    <p className="whitespace-pre-wrap text-sm text-zinc-800">
                      {note.body}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {note.author?.display_name ?? "Unknown"} -{" "}
                      {formatAdminDateTime(note.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No visible notes" />
            )}
          </AdminSection>
        </aside>
      </div>
    </>
  );
}
