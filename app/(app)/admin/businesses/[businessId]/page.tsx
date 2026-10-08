import { loadOptionalAdminSection, SectionError } from "@/app/(app)/admin/_components/optional-section";
import { AdminActionForm } from "@/app/(app)/admin/_components/action-form";
import Link from "next/link";
import {
  createAdminNoteAction,
  updateAdminBusinessProfileAction,
  updateAdminBusinessStatusAction,
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
import { getPlatformAdminBusinessDetail } from "@/lib/platform-admin/businesses";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

type BusinessDetailPageProps = {
  params: Promise<{ businessId: string }>;
};

export default async function AdminBusinessDetailPage({
  params,
}: BusinessDetailPageProps) {
  const context = await requirePlatformAdmin(
    PLATFORM_ADMIN_PERMISSIONS.businessesRead,
  );
  const { businessId } = await params;
  const detail = await getPlatformAdminBusinessDetail(businessId);
  const canUpdate = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.businessesUpdate,
  );
  const canUpdateStatus = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.businessesUpdateStatus,
  );
  const canReadNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesRead,
  );
  const canCreateNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesCreate,
  );
  const notesResult = canReadNotes
    ? await loadOptionalAdminSection(() => listPlatformAdminNotes({ targetId: businessId, targetType: "business" }))
    : null;
  const notes = notesResult?.data;

  return (
    <>
      <AdminPageHeader
        actions={<SecondaryLink href="/admin/businesses">Back to businesses</SecondaryLink>}
        eyebrow="Business"
        title={detail.business.name}
      >
        Business identity, locations, memberships, status workflow and internal
        notes.
      </AdminPageHeader>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-6">
          <AdminSection title="Business Details">
            <FieldGrid>
              <Field label="Business ID" value={detail.business.id} />
              <Field label="Owner" value={detail.owner ? <Link href={`/admin/users/${detail.owner.id}`} className="text-orange-700">{detail.owner.display_name ?? "Unnamed owner"}</Link> : "—"} />
              <Field label="Owner email" value={detail.owner?.email ?? "-"} />
              <Field
                label="Status"
                value={<StatusBadge value={detail.business.status} />}
              />
              <Field
                label="Created"
                value={formatAdminDateTime(detail.business.created_at)}
              />
              <Field
                label="Updated"
                value={formatAdminDateTime(detail.business.updated_at)}
              />
            </FieldGrid>
          </AdminSection>

          {canUpdate ? (
            <AdminSection title="Safe Business Edit">
              <AdminActionForm
                action={updateAdminBusinessProfileAction}
                className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <input name="business_id" type="hidden" value={detail.business.id} />
                <TextInput
                  defaultValue={detail.business.name}
                  label="Business name"
                  name="name"
                  required
                />
                <TextArea label="Reason" name="reason" required rows={3} />
                <SubmitButton>Save business</SubmitButton>
              </AdminActionForm>
            </AdminSection>
          ) : null}

          <AdminSection title="Locations">
            {detail.locations.length === 0 ? (
              <EmptyState title="No locations found" />
            ) : (
              <FieldGrid>
                {detail.locations.map((location) => (
                  <Field
                    key={location.id}
                    label={location.name}
                    value={
                      <Link
                        className="font-bold text-orange-700"
                        href={`/admin/locations/${location.id}`}
                      >
                        {location.city ?? "No city"}, {location.state ?? "--"} -{" "}
                        {location.status}
                      </Link>
                    }
                  />
                ))}
              </FieldGrid>
            )}
          </AdminSection>

          <AdminSection title="Members">
            {detail.members.length === 0 ? (
              <EmptyState title="No members found" />
            ) : (
              <FieldGrid>
                {detail.members.map((member) => (
                  <Field
                    key={member.id}
                    label={<Link href={`/admin/users/${member.user_id}`} className="text-orange-700">{member.display_name ?? "Unnamed user"}</Link>}
                    value={
                      <span>
                        {member.role} - <StatusBadge value={member.status} /> -{" "}
                        {formatAdminDateTime(member.created_at)}
                      </span>
                    }
                  />
                ))}
              </FieldGrid>
            )}
          </AdminSection>

          <AdminSection title="Related Reports">
            {detail.related_reports.length === 0 ? (
              <EmptyState title="No reports tied to this business" />
            ) : (
              <FieldGrid>
                {detail.related_reports.map((report) => (
                  <Field
                    key={report.id}
                    label={report.report_number}
                    value={
                      <Link
                        className="font-bold text-orange-700"
                        href={`/admin/reports/${report.id}`}
                      >
                        {report.summary} - {report.status}
                      </Link>
                    }
                  />
                ))}
              </FieldGrid>
            )}
          </AdminSection>
        </div>

        <aside className="grid content-start gap-6">
          {canUpdateStatus ? (
            <AdminSection title="Status">
              <AdminActionForm
                action={updateAdminBusinessStatusAction}
                className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <input name="business_id" type="hidden" value={detail.business.id} />
                <SelectInput
                  defaultValue={detail.business.status}
                  label="Business status"
                  name="status"
                  options={[
                    { label: "Active", value: "active" },
                    { label: "Inactive", value: "inactive" },
                    { label: "Suspended", value: "suspended" },
                    { label: "Archived", value: "archived" },
                  ]}
                />
                <TextArea label="Reason" name="reason" required rows={3} />
                <SubmitButton>Update status</SubmitButton>
              </AdminActionForm>
            </AdminSection>
          ) : null}

          <AdminSection title="Internal Notes">
            {canCreateNotes ? (
              <AdminActionForm action={createAdminNoteAction} className="mb-4 grid gap-3">
                <input name="target_id" type="hidden" value={detail.business.id} />
                <input name="target_type" type="hidden" value="business" />
                <input
                  name="return_path"
                  type="hidden"
                  value={`/admin/businesses/${detail.business.id}`}
                />
                <TextArea label="New note" name="body" required />
                <SubmitButton>Add note</SubmitButton>
              </AdminActionForm>
            ) : null}
            {notesResult?.error ? <SectionError message={notesResult.error}/> : notes && notes.items.length > 0 ? (
              <div className="grid gap-3">
                {notes.items.map((note) => (
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
