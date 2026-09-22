import Link from "next/link";
import {
  createAdminNoteAction,
  updateAdminLocationProfileAction,
  updateAdminLocationStatusAction,
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
import { getPlatformAdminLocationDetail } from "@/lib/platform-admin/locations";
import { listPlatformAdminNotes } from "@/lib/platform-admin/notes";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";

type LocationDetailPageProps = {
  params: Promise<{ locationId: string }>;
};

export default async function AdminLocationDetailPage({
  params,
}: LocationDetailPageProps) {
  const context = await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.locationsRead);
  const { locationId } = await params;
  const detail = await getPlatformAdminLocationDetail(locationId);
  const canUpdate = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.locationsUpdate,
  );
  const canUpdateStatus = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.locationsUpdateStatus,
  );
  const canReadNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesRead,
  );
  const canCreateNotes = hasAdminPermission(
    context,
    PLATFORM_ADMIN_PERMISSIONS.notesCreate,
  );
  const notes = canReadNotes
    ? await listPlatformAdminNotes({ targetId: locationId, targetType: "location" })
    : null;

  return (
    <>
      <AdminPageHeader
        actions={<SecondaryLink href="/admin/locations">Back to locations</SecondaryLink>}
        eyebrow="Location"
        title={detail.location.name}
      >
        Location identity, address, status and internal notes.
      </AdminPageHeader>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="grid gap-6">
          <AdminSection title="Location Details">
            <FieldGrid>
              <Field label="Location ID" value={detail.location.id} />
              <Field
                label="Business"
                value={
                  detail.business ? (
                    <Link
                      className="font-bold text-orange-700"
                      href={`/admin/businesses/${detail.business.id}`}
                    >
                      {detail.business.name}
                    </Link>
                  ) : (
                    "-"
                  )
                }
              />
              <Field label="Phone" value={detail.location.phone ?? "-"} />
              <Field
                label="Address"
                value={
                  [
                    detail.location.address_line1,
                    detail.location.address_line2,
                    detail.location.city,
                    detail.location.state,
                    detail.location.postal_code,
                    detail.location.country,
                  ]
                    .filter(Boolean)
                    .join(", ") || "-"
                }
              />
              <Field
                label="Coordinates"
                value={
                  detail.location.latitude !== null &&
                  detail.location.longitude !== null
                    ? `${detail.location.latitude}, ${detail.location.longitude}`
                    : "-"
                }
              />
              <Field
                label="Geocoding"
                value={detail.location.geocoding_status ?? "-"}
              />
              <Field
                label="Status"
                value={<StatusBadge value={detail.location.status} />}
              />
              <Field
                label="Created"
                value={formatAdminDateTime(detail.location.created_at)}
              />
            </FieldGrid>
          </AdminSection>

          {canUpdate ? (
            <AdminSection title="Safe Location Edit">
              <form
                action={updateAdminLocationProfileAction}
                className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:grid-cols-2"
              >
                <input name="location_id" type="hidden" value={detail.location.id} />
                <TextInput
                  defaultValue={detail.location.name}
                  label="Location name"
                  name="name"
                  required
                />
                <TextInput
                  defaultValue={detail.location.phone}
                  label="Phone"
                  name="phone"
                />
                <TextInput
                  defaultValue={detail.location.address_line1}
                  label="Address line 1"
                  name="address_line1"
                />
                <TextInput
                  defaultValue={detail.location.address_line2}
                  label="Address line 2"
                  name="address_line2"
                />
                <TextInput defaultValue={detail.location.city} label="City" name="city" />
                <TextInput
                  defaultValue={detail.location.state}
                  label="State"
                  name="state"
                />
                <TextInput
                  defaultValue={detail.location.postal_code}
                  label="Postal code"
                  name="postal_code"
                />
                <TextInput
                  defaultValue={detail.location.country}
                  label="Country"
                  name="country"
                  required
                />
                <div className="sm:col-span-2">
                  <TextArea label="Reason" name="reason" required rows={3} />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton>Save location</SubmitButton>
                </div>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection title="Related Reports">
            {detail.related_reports.length === 0 ? (
              <EmptyState title="No reports tied to this location" />
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
              <form
                action={updateAdminLocationStatusAction}
                className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              >
                <input name="location_id" type="hidden" value={detail.location.id} />
                <SelectInput
                  defaultValue={detail.location.status}
                  label="Location status"
                  name="status"
                  options={[
                    { label: "Active", value: "active" },
                    { label: "Inactive", value: "inactive" },
                  ]}
                />
                <TextArea label="Reason" name="reason" required rows={3} />
                <SubmitButton>Update status</SubmitButton>
              </form>
            </AdminSection>
          ) : null}

          <AdminSection title="Internal Notes">
            {canCreateNotes ? (
              <form action={createAdminNoteAction} className="mb-4 grid gap-3">
                <input name="target_id" type="hidden" value={detail.location.id} />
                <input name="target_type" type="hidden" value="location" />
                <input
                  name="return_path"
                  type="hidden"
                  value={`/admin/locations/${detail.location.id}`}
                />
                <TextArea label="New note" name="body" required />
                <SubmitButton>Add note</SubmitButton>
              </form>
            ) : null}
            {notes && notes.items.length > 0 ? (
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
